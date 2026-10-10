// am serve: a foreground HTTP server on 127.0.0.1 that serves rendered pages through per-page capability links.
// Every start makes a new secret and writes it to serve.json (mode 0600, removed on exit). A link is /p/<token>/<file> (pages) or
// /v/<token>/<file> (videos), with token = HMAC-SHA256(secret, "<dir>/<file>"). The server keeps no list of links, a link reveals
// nothing about other pages, and a restart (new secret) revokes every old link. Only .html files directly inside pages/ and videos/ are served.

import { createServer } from 'node:http';
import { connect, isIP } from 'node:net';
import { networkInterfaces, uptime } from 'node:os';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { lstat, realpath, readFile } from 'node:fs/promises';
import { join, resolve, dirname, basename, sep } from 'node:path';
import { ensureHome } from './home.js';

export const DEFAULT_PORT = 8765;
const HOST = '127.0.0.1';
const LAN_BIND = '0.0.0.0';
const TOKEN_LENGTH = 22;
const PREFIX = Object.freeze({ p: 'pages', v: 'videos' });
const PREFIX_OF = Object.freeze({ pages: 'p', videos: 'v' });
// Only loopback names are accepted: an SSH tunnel may map any local port, but a DNS-rebinding page arrives with its own host name.
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i;

// Which private range an address is in, most likely a person's own LAN first. Docker's bridge (172.17.0.1) sits in
// 172.16/12, so it ranks behind a 192.168/16 or 10/8 address.
function lanRank(address) {
  const [a, b] = address.split('.').map(Number);
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 1;
  if (a === 172 && b >= 16 && b <= 31) return 2;
  return 3;
}

// Octet-by-octet comparison: a plain string sort would put 10.0.0.9 after 10.0.0.10.
const compareOctets = (x, y) => {
  const [p, q] = [x, y].map((address) => address.split('.').map(Number));
  const i = p.findIndex((n, k) => n !== q[k]);
  return i === -1 ? 0 : p[i] - q[i];
};

// IPv4 LAN addresses only: IPv6 is not enabled by the IPv4-only 0.0.0.0 listener.
// Ordered by range (192.168, 10, 172.16/12, others), then numerically: the first one becomes the printed link origin,
// and the startup message also lists every candidate.
export function lanIPv4Addresses(interfaces = networkInterfaces()) {
  return [...new Set(Object.values(interfaces).flatMap((entries) => entries ?? [])
    .filter(({ address, family, internal }) => (family === 'IPv4' || family === 4)
      && !internal && isIP(address) === 4 && address !== LAN_BIND
      && !address.startsWith('127.') && !address.startsWith('169.254.'))
    .map(({ address }) => address))].sort((x, y) => lanRank(x) - lanRank(y) || compareOctets(x, y));
}

// A public URL is a pure HTTP(S) origin. Credentials, paths, queries, fragments and
// exotic schemes would make printed capability links misleading or unsafe.
export function publicUrlOrigin(input) {
  const error = () => new ServeError('--public-url must be an http:// or https:// origin without a path, credentials, query or fragment');
  if (typeof input !== 'string' || !/^https?:\/\/[^\s/?#]+\/?$/i.test(input)) throw error();
  let url;
  try { url = new URL(input); } catch { throw error(); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || !url.hostname || url.hostname === LAN_BIND) throw error();
  return url.origin;
}

// A fixed public hostname is matched exactly. LAN IPs may carry a port chosen by
// the client or reverse proxy; unknown DNS names never enter the allowlist.
function hostAllowed(host, additional) {
  if (LOOPBACK_HOST.test(host ?? '')) return true;
  if (typeof host !== 'string') return false;
  const value = host.toLowerCase();
  return additional.some((allowed) => {
    if (value === allowed.toLowerCase()) return true;
    if (isIP(allowed) !== 4 || !value.startsWith(allowed + ':')) return false;
    const port = value.slice(allowed.length + 1);
    return /^[1-9][0-9]{0,4}$/.test(port) && Number(port) <= 65535;
  });
}

// All pages share one origin over HTTP, and a page can hold a script (an ```html block). sandbox without allow-same-origin
// gives every page an opaque origin of its own, so a script can neither fetch another page nor read the localStorage keys
// that name other pages' links. The page keeps its scripts, its outbound links (popups that leave the sandbox) and the
// video export download; Reply answers then last until the page closes, as in a private window.
export const SANDBOX = 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads';
const HEADERS = Object.freeze({
  'Content-Security-Policy': `frame-ancestors 'none'; ${SANDBOX}`,
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

export class ServeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ServeError';
  }
}

const infoPath = (home) => join(home, 'serve.json');

// The token of one page. dir is "pages" or "videos"; the CLI and the server both use this function.
export function pageToken(secret, dir, file) {
  return createHmac('sha256', secret).update(`${dir}/${file}`).digest('base64url').slice(0, TOKEN_LENGTH);
}

export function pageLink({ port, secret, baseUrl }, dir, file) {
  const origin = baseUrl ?? `http://${HOST}:${port}`;
  return `${origin}/${PREFIX_OF[dir]}/${pageToken(secret, dir, file)}/${encodeURIComponent(file)}`;
}

// A servable file name: one path segment, no traversal, .html only.
export function validFileName(name) {
  return typeof name === 'string' && name.length > 0 && name.endsWith('.html') && !/[/\\\0]/.test(name) && !name.includes('..');
}

function tokenMatches(secret, dir, file, token) {
  const expected = Buffer.from(pageToken(secret, dir, file));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Whether the pid is a live process of this user. EPERM means the pid belongs to another user: the server always runs as
// the user who renders (serve.json is 0600), so such a pid was reused, and the link would point at someone else's port.
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// A file written before the machine booted belongs to a server that is gone, and its pid may now be another process.
const BOOT_SLACK_MS = 5000;
const bootedBefore = (startedAt) => startedAt < Date.now() - uptime() * 1000 - BOOT_SLACK_MS;

// The running server's { pid, port, secret }, or null when there is none (no file, a bad file, a dead pid, or a file older than the boot).
export function readServeInfo(home) {
  try {
    const info = JSON.parse(readFileSync(infoPath(home), 'utf8'));
    const validBase = info?.baseUrl === undefined
      || (typeof info.baseUrl === 'string' && publicUrlOrigin(info.baseUrl) === info.baseUrl);
    const ok = info && Number.isInteger(info.port) && typeof info.secret === 'string' && info.secret.length > 0
      && Number.isFinite(info.startedAt) && !bootedBefore(info.startedAt) && alive(info.pid) && validBase;
    return ok ? { pid: info.pid, port: info.port, secret: info.secret, baseUrl: info.baseUrl } : null;
  } catch {
    return null;
  }
}

// The link for a file just written by render / patch / video, or null. It never throws: a link problem must not break a render.
export function serveLink(home, file) {
  try {
    const info = readServeInfo(home);
    if (!info) return null;
    const path = resolve(file);
    const dir = ['pages', 'videos'].find((d) => dirname(path) === resolve(home, d));
    const name = basename(path);
    return dir && validFileName(name) ? pageLink(info, dir, name) : null;
  } catch {
    return null;
  }
}

function writeInfo(home, info) {
  ensureHome(home);
  const tmp = `${infoPath(home)}.${process.pid}.tmp`;
  try {
    rmSync(tmp, { force: true }); // the mode applies only to a file that writeFileSync creates
    // wx: fail rather than write through a file or symlink that appeared after the rmSync.
    writeFileSync(tmp, `${JSON.stringify(info)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(tmp, infoPath(home));
  } finally {
    // A failed rename must not leave a secret-bearing temporary metadata file behind.
    rmSync(tmp, { force: true });
  }
}

// Remove serve.json only when it still describes this server.
function removeInfo(home, secret) {
  try {
    if (JSON.parse(readFileSync(infoPath(home), 'utf8')).secret === secret) rmSync(infoPath(home), { force: true });
  } catch {
    // Already gone or replaced.
  }
}

function reply(req, res, status, type, body = '') {
  res.writeHead(status, { ...HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const notFound = (req, res) => reply(req, res, 404, 'text/plain; charset=utf-8', 'Not found\n');

// The real path of a page that is a regular file directly inside its folder, or null.
async function resolvePage(home, dir, file) {
  try {
    const root = await realpath(join(home, dir));
    const path = join(root, file);
    if (!(await lstat(path)).isFile()) return null; // lstat does not follow links, so a symlink is not a regular file
    const real = await realpath(path);
    return real.startsWith(root + sep) ? real : null;
  } catch {
    return null;
  }
}

function handler(home, secret, allowedHosts) {
  return async (req, res) => {
    try {
      if (!hostAllowed(req.headers.host, allowedHosts)) return notFound(req, res);
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return reply(req, res, 405, 'text/plain; charset=utf-8', 'Method not allowed\n');
      }
      // Split the raw path by hand: URL would resolve dot segments (%2e%2e) before the checks below see them.
      const parts = req.url.split(/[?#]/)[0].split('/');
      if (parts.length !== 4 || parts[0] !== '') return notFound(req, res);
      const [, prefix, token, raw] = parts;
      const dir = Object.hasOwn(PREFIX, prefix) ? PREFIX[prefix] : undefined;
      if (!dir || !token || !raw) return notFound(req, res);
      let file;
      try {
        file = decodeURIComponent(raw);
      } catch {
        return notFound(req, res);
      }
      if (!validFileName(file) || !tokenMatches(secret, dir, file, token)) return notFound(req, res);
      // A page is only opened, never fetched: a browser marks a script's fetch (or a service worker's) with another
      // destination, so a leaked token does not let a script read the page. curl sends no Sec-Fetch-Dest.
      const dest = req.headers['sec-fetch-dest'];
      if (dest !== undefined && dest !== 'document') return notFound(req, res);
      const real = await resolvePage(home, dir, file);
      if (!real) return notFound(req, res);
      return reply(req, res, 200, 'text/html; charset=utf-8', await readFile(real));
    } catch {
      return notFound(req, res);
    }
  };
}

// Whether something accepts connections on the port: a recorded server whose pid was reused by another process does not.
function listening(port, timeout = 500) {
  return new Promise((done) => {
    const socket = connect({ host: HOST, port });
    const end = (up) => { socket.destroy(); done(up); };
    socket.setTimeout(timeout, () => end(false));
    socket.once('connect', () => end(true));
    socket.once('error', () => end(false));
  });
}

// Default: loopback only. LAN listening and the public link origin are explicit opt-ins.
export async function startServer({ home, port = DEFAULT_PORT, lan = false, publicUrl, lanAddresses }) {
  const addresses = lan ? (lanAddresses ?? lanIPv4Addresses()) : [];
  if (lan && (!addresses.length || addresses.some((address) => isIP(address) !== 4
    || address === LAN_BIND || address.startsWith('127.')))) {
    throw new ServeError('--lan needs at least one active non-loopback IPv4 interface');
  }
  const publicOrigin = publicUrl === undefined ? null : publicUrlOrigin(publicUrl);
  const allowedHosts = [...addresses, ...(publicOrigin ? [new URL(publicOrigin).host] : [])];
  const running = readServeInfo(home);
  if (running && await listening(running.port)) throw new ServeError(`am serve is already running on ${running.baseUrl ?? `http://${HOST}:${running.port}`} (pid ${running.pid}); stop it first`);
  const secret = randomBytes(32).toString('hex');
  const server = createServer(handler(home, secret, allowedHosts));
  await new Promise((done, fail) => {
    server.once('error', (e) => fail(e.code === 'EADDRINUSE'
      ? new ServeError(`Port ${port} is already in use; pick another with am serve --port <n>`)
      : e));
    server.listen(port, lan ? LAN_BIND : HOST, done);
  });
  const actual = server.address().port;
  const baseUrl = publicOrigin ?? `http://${lan ? addresses[0] : HOST}:${actual}`;
  try {
    writeInfo(home, { pid: process.pid, port: actual, secret, startedAt: Date.now(), baseUrl });
  } catch (e) {
    // Do not leave a possibly LAN-exposed listener open if its secret cannot be persisted.
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    throw new ServeError(`Cannot save serve.json; server stopped: ${e.message}`);
  }
  let closed;
  const close = () => {
    closed ??= new Promise((done) => {
      removeInfo(home, secret);
      server.close(() => done());
      server.closeAllConnections();
    });
    return closed;
  };
  return { port: actual, secret, close, baseUrl, addresses, lan };
}

// am serve: run in the foreground until Ctrl-C / SIGTERM / SIGHUP. Resolves with the exit code.
export async function runServe({ home, port, lan = false, publicUrl, print, fail }) {
  let srv;
  try {
    srv = await startServer({ home, port, lan, publicUrl });
  } catch (e) {
    if (!(e instanceof ServeError)) throw e;
    fail(`✗ ${e.message}`);
    return 1;
  }
  return new Promise((done) => {
    // Handle signals before printing the address, so a Ctrl-C right after it still removes serve.json.
    const stop = () => srv.close().then(() => done(0));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    process.once('SIGHUP', stop); // the SSH session or terminal that runs the server closed
    process.once('exit', () => removeInfo(home, srv.secret));
    if (lan) {
      print(`Serving pages on ${LAN_BIND}:${srv.port} (Ctrl-C to stop). am render prints a link for each page.`);
      print('WARNING: --lan exposes this port on every IPv4 interface, without built-in TLS. A page link is a secret: use a trusted LAN or an HTTPS reverse proxy.');
      for (const address of srv.addresses) print(`LAN address: http://${address}:${srv.port}`);
    } else {
      print(`Serving pages on http://${HOST}:${srv.port} (Ctrl-C to stop). am render prints a link for each page.`);
      // With --public-url a reverse proxy or tunnel already reaches the server, so the SSH hint would mislead.
      if (!publicUrl) print(`Reaching it from another computer: run ssh -L ${srv.port}:${HOST}:${srv.port} user@host there, then open the links in its browser.`);
    }
    if (publicUrl) {
      print(`Public link origin: ${srv.baseUrl}`);
      if (srv.baseUrl.startsWith('http://')) print('WARNING: --public-url uses HTTP; links and their capability tokens are not encrypted in transit.');
    }
  });
}
