// Browser stand-ins for node:fs, node:path, node:os and node:url, used by the renderer bundle (site/build.mjs).
// The browser has no file system: every file read fails as "not found", so a code block's src= and a local image
// end in the renderer's usual error message instead of a crash. The path functions are small POSIX versions.

const CWD = '/';

function notFound(path) {
  const err = new Error(`ENOENT: no such file or directory, '${path}' (the browser has no local files)`);
  err.code = 'ENOENT';
  return err;
}

// node:fs
export function readFileSync(path) { throw notFound(path); }
export function statSync(path) { throw notFound(path); }
export function lstatSync(path) { throw notFound(path); }
export function readdirSync(path) { throw notFound(path); }
export function existsSync() { return false; }
export function writeFileSync(path) { throw notFound(path); }
export function mkdirSync(path) { throw notFound(path); }
export function mkdtempSync(path) { throw notFound(path); }
export function renameSync(path) { throw notFound(path); }
export function chmodSync(path) { throw notFound(path); }
export function rmSync() {}

// node:os
export const homedir = () => '/home';
export const tmpdir = () => '/tmp';

// node:path (POSIX)
export const sep = '/';
export const delimiter = ':';

// Resolve . and .. in a list of segments; for a relative path, leading .. segments are kept.
function normalizeSegments(parts, absolute) {
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
    } else {
      out.push(part);
    }
  }
  return out;
}

export function isAbsolute(path) {
  return String(path).startsWith('/');
}

export function normalize(path) {
  const p = String(path);
  if (!p) return '.';
  const absolute = isAbsolute(p);
  const body = normalizeSegments(p.split('/'), absolute).join('/');
  const trailing = p.endsWith('/') && body ? '/' : '';
  return (absolute ? `/${body}` : body || '.') + trailing;
}

export function join(...parts) {
  const joined = parts.filter((p) => p !== '').join('/');
  return joined ? normalize(joined) : '.';
}

export function resolve(...parts) {
  let path = '';
  for (let i = parts.length - 1; i >= 0 && !isAbsolute(path); i--) {
    if (parts[i]) path = path ? `${parts[i]}/${path}` : String(parts[i]);
  }
  if (!isAbsolute(path)) path = path ? `${CWD}/${path}` : CWD;
  return `/${normalizeSegments(path.split('/'), true).join('/')}`;
}

export function relative(from, to) {
  const a = resolve(from).split('/').filter(Boolean);
  const b = resolve(to).split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

export function dirname(path) {
  const p = String(path).replace(/\/+$/, '');
  if (!p) return isAbsolute(path) ? '/' : '.';
  const i = p.lastIndexOf('/');
  if (i === -1) return '.';
  return i === 0 ? '/' : p.slice(0, i);
}

export function basename(path, ext) {
  const p = String(path).replace(/\/+$/, '');
  const base = p.slice(p.lastIndexOf('/') + 1);
  return ext && base !== ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

export function extname(path) {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot);
}

export const posix = { sep, delimiter, isAbsolute, normalize, join, resolve, relative, dirname, basename, extname };

// node:url
export function fileURLToPath(url) {
  const u = new URL(String(url));
  if (u.protocol !== 'file:') throw new TypeError('The URL must be of scheme file');
  return decodeURIComponent(u.pathname);
}

export function pathToFileURL(path) {
  return new URL(`file://${encodeURI(resolve(path))}`);
}
