// Local images: a file named in the draft is embedded in the page as a data URI, so the page stays one file that opens offline.
// The page keeps the draft's path in data-am-src. `am patch` reads it back, so an image survives a patch after the file has moved.
// Remote URLs and data URIs are left as they are.

import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// The data URI of the file, or null when the file does not exist.
function readImage(ref, baseDir) {
  const path = localPath(ref, baseDir);
  const type = TYPES[extname(path).toLowerCase()];
  if (!type) throw new ImageError(`"${ref}" is not an image file; use ${Object.keys(TYPES).join(' ')}`, ref);
  let size;
  try {
    size = statSync(path).size;
  } catch {
    return null;
  }
  if (size > MAX_IMAGE_BYTES) {
    throw new ImageError(`"${ref}" is ${(size / 1048576).toFixed(1)} MB; the limit is ${MAX_IMAGE_BYTES / 1048576} MB. Shrink or crop the image first`, ref);
  }
  return `data:${type};base64,${readFileSync(path).toString('base64')}`;
}

// An image that marked left as text must not pass as a page that renders: stop at the line that holds it.
function assertNoImageText(html) {
  const left = html.replace(/<(code|pre)\b[\s\S]*?<\/\1>/g, '').match(TEXT_IMAGE);
  if (left) throw new ImageError(`"${left[0]}" was not read as an image. Check the path: write a space as %20, or put the path in < and >`, left[0]);
}

// Embed every local <img> in html. The file wins; `known` (draft path → data URI, from readEmbeddedImages) is the fallback.
// Relative paths are read from baseDir.
export function inlineImages(html, { baseDir = process.cwd(), known = new Map() } = {}) {
  assertNoImageText(html);
  return html.replace(IMG_SRC, (whole, before, src) => {
    const ref = decodeRef(src);
    if (NOT_LOCAL.test(ref)) return whole;
    const uri = readImage(ref, baseDir) ?? known.get(ref);
    if (!uri) throw new ImageError(`Image not found: "${ref}"${isAbsolute(ref) ? '' : ` (relative paths are read from ${baseDir})`}. Use the absolute path of an existing file`, ref);
    return `<img${before}data-am-src="${src}" src="${uri}"`;
  });
}

// The images a page already embeds, for am patch.
export function readEmbeddedImages(html) {
  return new Map([...String(html).matchAll(EMBEDDED)].map(([, src, uri]) => [decodeRef(src), uri]));
}
