// The theme catalog client behind `am theme add / list / update / remove`: read the index on the website, download one theme file,
// check it, and keep it in <AM_HOME>/themes/. Only names from the catalog index are accepted, never a URL or a path.
//
// Remote text stays out of the CLI output. An error here (CatalogError) carries a fixed sentence or a status code, never text the
// server sent; the index is read into entries that hold a name, version numbers, a size and a hash, and nothing else (labels and
// descriptions are for the website, and an agent reads the CLI output).
//
// Where a theme came from is kept in state.json under `catalogThemes`: name -> { version, sha256 } of the file as installed.
// The themes folder holds nothing but theme files (user.js loads every *.json in it), and state.json already has atomic writes.
// A theme whose file still hashes to its recorded sha256 is an unchanged catalog install; any other file is the user's.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION } from '../assets.js';
import { ensureHome } from '../home.js';
import { readState, writeState } from '../state.js';
import { newer } from '../version.js';
import { NAME, normalizeTheme, checkColors, themeLinks } from './check.js';
import { BUILTIN_NAMES } from './registry.js';

export const CATALOG = Object.freeze({
  url: 'https://answer-me-with-html.com/themes/index.json',
  timeoutMs: 8000,
  maxIndexBytes: 256 * 1024,
  maxThemeBytes: 16 * 1024, // the catalog limit (CONTRIBUTING.md)
  maxThemes: 200,
  maxNameLength: 40,
  maxRedirects: 3,
});

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];
const XYZ = /^\d+\.\d+\.\d+$/;
const SHA256 = /^[0-9a-f]{64}$/;

export class CatalogError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CatalogError';
  }
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const themesDir = (home) => join(home, 'themes');
export const themeFile = (home, name) => join(themesDir(home), `${name}.json`);

// The index URL: AM_CATALOG_URL (a mirror, or a test server) or the website.
export function catalogUrl(env = process.env) {
  const url = env.AM_CATALOG_URL || CATALOG.url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new CatalogError(`AM_CATALOG_URL is not a URL: ${url}`);
  }
  if (!isSecure(parsed)) throw new CatalogError('AM_CATALOG_URL must be an https URL (http only for localhost)');
  return parsed.href;
}

// Over plain http the index and the theme file can both be swapped in transit, so the sha256 check would prove nothing:
// https only, and http for this machine (tests and local mirrors). Applies to AM_CATALOG_URL and to every redirect.
const isSecure = (url) => url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.includes(url.hostname));

// A short reason for a failed request, from the error and never from the response.
function reasonOf(e, timeoutMs) {
  if (e instanceof CatalogError) return e.message;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `no answer within ${Math.round(timeoutMs / 100) / 10} s`;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{3,30}$/.test(code) ? `network error ${code}` : 'network error';
}

// A redirect is followed here, not by fetch: fetch would send the request to an http address before we could look at it, so each
// Location is checked first (isSecure) and a request is never sent to an address that fails. The target is not printed.
async function get(url, signal, fetchImpl) {
  let current = url;
  for (let hops = 0; ; hops += 1) {
    const res = await fetchImpl(current, { signal, redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 ? res.headers?.get?.('location') : null;
    if (!location) return res;
    await res.body?.cancel?.();
    if (hops >= CATALOG.maxRedirects) throw new CatalogError('too many redirects');
    let next;
    try {
      next = new URL(location, current);
    } catch {
      throw new CatalogError('the server sent a redirect this version cannot follow');
    }
    if (!isSecure(next)) throw new CatalogError('the server redirected to an address that is not https');
    current = next.href;
  }
}

// One GET with a timeout (it covers the body) and a size cap. Returns a Buffer.
async function download(url, maxBytes, { fetchImpl = fetch, timeoutMs = CATALOG.timeoutMs } = {}) {
  try {
    const res = await get(url, AbortSignal.timeout(timeoutMs), fetchImpl);
    if (!res.ok) throw new CatalogError(`HTTP ${Number.isInteger(res.status) ? res.status : '?'}`);
    const declared = Number(res.headers?.get?.('content-length'));
    if (declared > maxBytes) throw new CatalogError(`the file is larger than ${maxBytes} bytes`);
    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > maxBytes) throw new CatalogError(`the file is larger than ${maxBytes} bytes`);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (e) {
    throw new CatalogError(reasonOf(e, timeoutMs));
  }
}

// An index entry reduced to what the CLI uses, or null when it is not usable. A built-in name is never a catalog name.
function entryFrom(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { name, version, requires, size, sha256: hash } = raw;
  if (typeof name !== 'string' || !NAME.test(name) || name.length > CATALOG.maxNameLength || BUILTIN_NAMES.includes(name)) return null;
  if (typeof version !== 'string' || !XYZ.test(version)) return null;
  if (requires !== undefined && (typeof requires !== 'string' || !XYZ.test(requires))) return null;
  if (!Number.isInteger(size) || size <= 0 || size > CATALOG.maxThemeBytes) return null;
  if (typeof hash !== 'string' || !SHA256.test(hash)) return null;
  return { name, version, size, sha256: hash, ...(requires && { requires }) };
}

// Read the catalog index: { url, themes: [{ name, version, requires?, size, sha256 }] }, sorted by name.
export async function fetchIndex(env = process.env, net = {}) {
  const url = catalogUrl(env);
  let text;
  try {
    text = (await download(url, CATALOG.maxIndexBytes, net)).toString('utf8');
  } catch (e) {
    throw new CatalogError(`Cannot read the theme catalog at ${url}: ${e.message}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CatalogError(`The theme catalog at ${url} is not valid JSON`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.schema !== 1 || !Array.isArray(data.themes)) {
    const newerFormat = Number.isInteger(data?.schema) && data.schema > 1;
    throw new CatalogError(newerFormat
      ? `The theme catalog uses format ${data.schema}, which this version cannot read; update Answer me with HTML`
      : `The theme catalog at ${url} is not in a format this version reads`);
  }
  const seen = new Set();
  const themes = data.themes.slice(0, CATALOG.maxThemes).map(entryFrom).filter((e) => e && !seen.has(e.name) && seen.add(e.name));
  return { url, themes: themes.sort((a, b) => (a.name < b.name ? -1 : 1)) };
}

// The address of a theme file: the index address with the file name of the theme. The index's own `url` field is not used.
export const fileUrl = (index, name) => new URL(`${name}.json`, index.url).href;

export const needsNewer = (entry) => Boolean(entry.requires && newer(entry.requires, VERSION));

// Check a downloaded file the way the catalog CI does. Returns the bytes when they pass; the error names the kind of problem and
// how many, not the text of the file.
function vet(name, bytes) {
  let data;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new CatalogError('the file is not valid JSON');
  }
  const { theme, errors } = normalizeTheme(name, data, BUILTIN_NAMES);
  const plural = (n, what) => `${what} (${n} problem${n === 1 ? '' : 's'})`;
  if (errors.length) throw new CatalogError(plural(errors.length, 'the file is not a valid theme'));
  const colors = checkColors(theme).errors;
  if (colors.length) throw new CatalogError(plural(colors.length, 'the colors fail the contrast check'));
  const links = themeLinks(theme);
  if (links.length) throw new CatalogError(plural(links.length, 'the css or a token value loads external resources or uses a backslash escape'));
  return bytes;
}

// Download one theme file and check its size, hash and content against the index. Returns the bytes.
export async function fetchTheme(index, entry, net = {}) {
  let bytes;
  try {
    bytes = await download(fileUrl(index, entry.name), entry.size, net);
  } catch (e) {
    throw new CatalogError(`cannot download it: ${e.message}`);
  }
  if (bytes.length !== entry.size) throw new CatalogError(`the file is ${bytes.length} bytes but the catalog says ${entry.size}`);
  if (sha256(bytes) !== entry.sha256) throw new CatalogError('the file does not match the sha256 in the catalog');
  return vet(entry.name, bytes);
}

// name -> { version, sha256 } for the themes installed from the catalog.
export function readInstalled(home) {
  const raw = readState(home).catalogThemes;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([name, r]) => NAME.test(name) && typeof r?.version === 'string' && typeof r?.sha256 === 'string'));
}

export function record(home, name, entry) {
  writeState(home, { catalogThemes: { ...readInstalled(home), [name]: { version: entry.version, sha256: entry.sha256 } } });
}

export function forget(home, name) {
  const { [name]: _gone, ...rest } = readInstalled(home);
  writeState(home, { catalogThemes: rest });
}

// The installed file's bytes, or null.
export function readInstalledFile(home, name) {
  try {
    return readFileSync(themeFile(home, name));
  } catch {
    return null;
  }
}

// Whether the file in the themes folder is an unchanged catalog install: recorded, and still the recorded bytes.
export function isUnchanged(home, name, installed = readInstalled(home)) {
  const bytes = readInstalledFile(home, name);
  return Boolean(bytes && installed[name] && sha256(bytes) === installed[name].sha256);
}

// Write the file next to its final name and rename it, so an interrupted write never leaves half a theme. The temporary name does
// not end in .json, so it is never read as a theme.
function writeAtomic(home, name, bytes) {
  ensureHome(home);
  mkdirSync(themesDir(home), { recursive: true });
  const tmp = `${themeFile(home, name)}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, bytes);
    renameSync(tmp, themeFile(home, name));
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

// Install a downloaded, checked file. status:
//   installed  no file was there
//   same       the identical file was there (it is recorded as a catalog install)
//   updated    an unchanged catalog install was replaced
//   replaced   a different file was replaced because of force
//   conflict   a different file is there, and it may be the user's own: nothing is changed
export function install(home, entry, bytes, { force = false } = {}) {
  const installed = readInstalled(home);
  const existing = readInstalledFile(home, entry.name);
  let status = 'installed';
  if (existing) {
    if (existing.equals(bytes)) status = 'same';
    else if (isUnchanged(home, entry.name, installed)) status = 'updated';
    else if (force) status = 'replaced';
    else return { status: 'conflict', previous: installed[entry.name]?.version };
  }
  if (status !== 'same') writeAtomic(home, entry.name, bytes);
  record(home, entry.name, entry);
  return { status, previous: installed[entry.name]?.version };
}

export function remove(home, name) {
  rmSync(themeFile(home, name), { force: true });
  if (readInstalled(home)[name]) forget(home, name);
}
