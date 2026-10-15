// Local images: a file named in the draft is embedded in the page as a data URI, so the page stays one file that opens offline.
// The page keeps the draft's path in data-am-src. `am patch` reads it back, so an image survives a patch after the file has moved.
// Remote URLs and data URIs are left as they are; the page's Content-Security-Policy (src/csp.js) stops a remote image from loading,
// so remoteImages names them for a warning.
// A file is embedded only when it really is the image its extension claims, so a link or a renamed file cannot carry other data into a page.

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECRET_DIR, SECRET_TEXT } from './code.js';

const TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const IMAGE_EXAMPLE = '![What the picture shows](/absolute/path/to/screenshot.png)';

// A scheme of two or more letters (so a Windows drive letter is not one), a protocol-relative URL or a fragment. file: is handled below.
const NOT_LOCAL = /^(?:(?!file:)[a-z][a-z0-9+.-]+:|\/\/|#)/i;
const IMG_SRC = /<img\b([^>]*?)\bsrc="([^"]*)"/g;
const TEXT_IMAGE = /!\[[^\]\n]*\](?:\([^)\n]*\)|\[[^\]\n]*\])/;
const EMBEDDED = /<img\b[^>]*?\bdata-am-src="([^"]*)" src="(data:[^"]*)"/g;

export class ImageError extends Error {
  constructor(message, ref) {
    super(message);
    this.name = 'ImageError';
    this.ref = ref;
  }
}

// marked writes the source as an escaped, percent-encoded attribute value.
function decodeRef(src) {
  const ref = src.replace(/&amp;/g, '&');
  try {
    return decodeURI(ref);
  } catch {
    return ref;
  }
}

function localPath(ref, baseDir) {
  if (ref.startsWith('file:')) return fileURLToPath(ref);
  if (ref.startsWith('~/')) return resolve(homedir(), ref.slice(2));
  return resolve(baseDir, ref);
}

// The first bytes each type starts with. An image is any file, so the name alone proves nothing.
const startsWith = (buf, text, at = 0) => buf.length >= at + text.length && buf.toString('latin1', at, at + text.length) === text;
const SVG_START = /^\uFEFF?(?:\s|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\]\s*)?>)*<svg(?=[\s>/])/;
const MAGIC = {
  'image/png': (buf) => startsWith(buf, '\x89PNG\r\n\x1a\n'),
  'image/jpeg': (buf) => startsWith(buf, '\xff\xd8\xff'),
  'image/gif': (buf) => startsWith(buf, 'GIF87a') || startsWith(buf, 'GIF89a'),
  'image/webp': (buf) => startsWith(buf, 'RIFF') && startsWith(buf, 'WEBP', 8),
  'image/avif': (buf) => startsWith(buf, 'ftypavif', 4) || startsWith(buf, 'ftypavis', 4),
  'image/svg+xml': (buf) => SVG_START.test(buf.toString('utf8')),
};

// True when a folder on the path holds keys or logins (.ssh, .aws, ...); nothing inside it is embedded.
const inSecretDir = (path) => path.split(sep).some((part) => SECRET_DIR.has(part));

// The data URI of the file, or null when the file does not exist.
// Absolute paths outside the project are fine (screenshots live anywhere); what is checked is the real file behind the path.
function readImage(ref, baseDir) {
  const path = localPath(ref, baseDir);
  const ext = extname(path).toLowerCase();
  const type = TYPES[ext];
  if (!type) throw new ImageError(`"${ref}" is not an image file; use ${Object.keys(TYPES).join(' ')}`, ref);
  let real;
  let stat;
  try {
    real = realpathSync(path);
    stat = statSync(real);
  } catch {
    return null;
  }
  if (inSecretDir(path) || inSecretDir(real)) {
    throw new ImageError(`"${ref}" is in a folder that holds keys or logins (${[...SECRET_DIR].join(' ')}); it is not embedded. Copy the image somewhere else first`, ref);
  }
  if (!stat.isFile()) throw new ImageError(`"${ref}" is not a file`, ref);
  const size = stat.size;
  if (size > MAX_IMAGE_BYTES) {
    throw new ImageError(`"${ref}" is ${(size / 1048576).toFixed(1)} MB; the limit is ${MAX_IMAGE_BYTES / 1048576} MB. Shrink or crop the image first`, ref);
  }
  const buf = readFileSync(real);
  if (!MAGIC[type](buf)) throw new ImageError(`"${ref}" is named ${ext} but its content is not ${type === 'image/svg+xml' ? 'SVG' : type.slice(6).toUpperCase()} data; it is not embedded`, ref);
  if (type === 'image/svg+xml' && SECRET_TEXT.test(buf.toString('utf8'))) {
    throw new ImageError(`"${ref}" looks like it holds a key or a token; it is not embedded`, ref);
  }
  return `data:${type};base64,${buf.toString('base64')}`;
}

// An image that marked left as text must not pass as a page that renders: stop at the line that holds it.
function assertNoImageText(html) {
  // Read the visible text only: attributes such as a tree node's data-key hold the raw label.
  const left = html.replace(/<(code|pre)\b[\s\S]*?<\/\1>/g, '').replace(/<[^>]*>/g, '').match(TEXT_IMAGE);
  if (left) throw new ImageError(`"${left[0]}" was not read as an image. Check the path: write a space as %20, or put the path in < and >`, left[0]);
}

// Embed every local <img> in html. The file wins; `known` (draft path → data URI, from readEmbeddedImages) is the fallback.
// Relative paths are read from baseDir.
// checkText: false for raw html / svg and for diagram text, where ![a](b) is literal text and not an image the author meant.
export function inlineImages(html, { baseDir = process.cwd(), known = new Map(), checkText = true } = {}) {
  if (checkText) assertNoImageText(html);
  return html.replace(IMG_SRC, (whole, before, src) => {
    const ref = decodeRef(src);
    if (NOT_LOCAL.test(ref)) return whole;
    const uri = readImage(ref, baseDir) ?? known.get(ref);
    if (!uri) throw new ImageError(`Image not found: "${ref}"${isAbsolute(ref) ? '' : ` (relative paths are read from ${baseDir})`}. Use the absolute path of an existing file`, ref);
    return `<img${before}data-am-src="${src}" src="${uri}"`;
  });
}

// The remote sources (http(s) or protocol-relative) of every <img> in html, as the draft would write them. Quoted or bare, since raw html may use either.
// \s before src, not \b: the - of data-src is a word boundary too.
export function remoteImages(html) {
  return [...html.matchAll(/<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map((m) => decodeRef(m[1] ?? m[2] ?? m[3]))
    .filter((ref) => /^(?:https?:)?\/\//i.test(ref));
}

// The images a page already embeds, for am patch.
export function readEmbeddedImages(html) {
  return new Map([...String(html).matchAll(EMBEDDED)].map(([, src, uri]) => [decodeRef(src), uri]));
}
