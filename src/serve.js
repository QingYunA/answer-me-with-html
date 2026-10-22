// am serve: a foreground HTTP server on 127.0.0.1 that serves rendered pages through per-page capability links.
// Every start makes a new secret and writes it to serve.json (mode 0600, removed on exit). A link is /p/<token>/<file> (pages) or
// /v/<token>/<file> (videos), with token = HMAC-SHA256(secret, "<dir>/<file>"). The server keeps no list of links, a link reveals
// nothing about other pages, and a restart (new secret) revokes every old link. Only .html files directly inside pages/ and videos/ are served.
// A served page also gets a script (src/runtime/live.js) that listens on /e/<token>/<file>, with the page's own token: the stream says
// only that the page file changed, and the page reloads.

import { createServer } from 'node:http';
import { connect, isIP } from 'node:net';
import { spawnSync } from 'node:child_process';
import { networkInterfaces, uptime } from 'node:os';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, rmSync, watch, lstatSync, existsSync, openSync, fstatSync, closeSync, linkSync, constants as fsConstants } from 'node:fs';
import { lstat, realpath, readFile, stat } from 'node:fs/promises';
import { join, resolve, dirname, basename, sep } from 'node:path';
import { ensureHome } from './home.js';
import { withoutUpdateNotice } from './render.js';
import { resolveLanguage } from './language.js';
import { readPage } from './page.js';
import { esc } from './svg/text.js';
import { LIVE_SCRIPT_BODY } from './csp.js';

export const DEFAULT_PORT = 8765;
const HOST = '127.0.0.1';
const LAN_BIND = '0.0.0.0';
const TOKEN_LENGTH = 22;
const PREFIX = Object.freeze({ p: 'pages', v: 'videos' });
const PREFIX_OF = Object.freeze({ pages: 'p', videos: 'v' });
// The event stream of a page in pages/: /e/<token>/<file>, where token is the token of the page link.
const EVENTS = 'e';
// Editors and renders replace a file in several steps (src/cli.js writes a temp file and renames it): wait for them to settle.
const SETTLE_MS = 150;
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

// The Tailscale CLI: on PATH, or the macOS app's bundled binary. TAILSCALE_BE_CLI keeps the app binary from starting its GUI.
const TAILSCALE_APP = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';

// run is a test seam: it takes the command and returns what spawnSync returns.
export function readTailscaleStatus(run = (cmd) => spawnSync(cmd, ['status', '--json'], { encoding: 'utf8', timeout: 5000, env: { ...process.env, TAILSCALE_BE_CLI: '1' } })) {
  let result = run('tailscale');
  if (result.error?.code === 'ENOENT' && process.platform === 'darwin' && existsSync(TAILSCALE_APP)) result = run(TAILSCALE_APP);
  if (result.error?.code === 'ENOENT') {
    throw new ServeError('--tailscale needs the tailscale CLI: install Tailscale (https://tailscale.com/download) and make sure `tailscale` is on PATH');
  }
  if (result.error || result.status !== 0) {
    const why = result.error?.message ?? (result.stderr || '').trim().split('\n')[0] ?? '';
    throw new ServeError(`tailscale status failed${why ? `: ${why}` : ''}`);
  }
  try { return JSON.parse(result.stdout); } catch { throw new ServeError('Cannot parse the output of tailscale status --json'); }
}

// This machine's tailnet address and the host name that links use: the MagicDNS name when it is on, else the address.
export function tailscaleTarget(status) {
  const state = status?.BackendState;
  if (state !== 'Running') {
    throw new ServeError(`Tailscale is not running (state: ${state ?? 'unknown'}); run \`tailscale up\` first`);
  }
  const address = (status.Self?.TailscaleIPs ?? []).find((ip) => isIP(ip) === 4);
  if (!address) throw new ServeError('This machine has no Tailscale IPv4 address; check `tailscale status`');
  const dns = typeof status.Self?.DNSName === 'string' ? status.Self.DNSName.replace(/\.$/, '') : '';
  return { address, host: status.CurrentTailnet?.MagicDNSEnabled === true && dns ? dns : address };
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

const SECRET_PATTERN = /^[0-9a-f]{64}$/;

// A persisted capability secret is deliberately a plain, private regular file. On POSIX,
// reject any group/other permission bits before reading it; invalid files are never replaced.
function loadSecret(secretFile) {
  if (secretFile === undefined) return randomBytes(32).toString('hex');
  try {
    // Windows has no O_NOFOLLOW flag. Check the path before opening there so a link cannot be accepted as a secret file.
    if (fsConstants.O_NOFOLLOW === undefined && lstatSync(secretFile).isSymbolicLink()) {
      throw new ServeError('--secret-file must not be a symbolic link');
    }
    const flags = fsConstants.O_RDONLY
      | (fsConstants.O_NOFOLLOW ?? 0)
      | (fsConstants.O_NONBLOCK ?? 0);
    const fd = openSync(secretFile, flags);
    try {
      const mode = fstatSync(fd);
      if (!mode.isFile()) throw new ServeError('--secret-file must be a regular file');
      if (process.platform !== 'win32' && (mode.mode & 0o044)) throw new ServeError('--secret-file must not be readable by group or others');
      const secret = readFileSync(fd, 'utf8');
      if (!SECRET_PATTERN.test(secret)) throw new ServeError('--secret-file must contain exactly 64 lowercase hex characters');
      return secret;
    } finally {
      closeSync(fd);
    }
  } catch (e) {
    if (e instanceof ServeError) throw e;
    if (e?.code !== 'ENOENT') throw new ServeError(`Cannot read --secret-file: ${e.message}`);
    const secret = randomBytes(32).toString('hex');
    const tmp = `${secretFile}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`;
    try {
      writeFileSync(tmp, secret, { mode: 0o600, flag: 'wx' });
      try {
        linkSync(tmp, secretFile);
      } catch (publishError) {
        if (publishError?.code === 'EEXIST') return loadSecret(secretFile);
        throw publishError;
      }
      return secret;
    } catch (writeError) {
      if (writeError instanceof ServeError) throw writeError;
      throw new ServeError(`Cannot create --secret-file: ${writeError.message}`);
    } finally {
      rmSync(tmp, { force: true });
    }
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

// The event stream of a page in pages/, as a path on the server that serves the page (the page may be opened through a LAN or public
// address, so the stream goes to the same origin). It carries the token of the page link.
export function eventLink({ secret }, file) {
  return `/${EVENTS}/${pageToken(secret, 'pages', file)}/${encodeURIComponent(file)}`;
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
    // host: where the server listens, when that is not loopback (--tailscale); older files have none.
    const host = isIP(info.host) ? info.host : undefined;
    return ok ? { pid: info.pid, port: info.port, secret: info.secret, baseUrl: info.baseUrl, host } : null;
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
function removeInfo(home, secret, port) {
  try {
    const info = JSON.parse(readFileSync(infoPath(home), 'utf8'));
    if (info.secret === secret && info.port === port) rmSync(infoPath(home), { force: true });
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

// The page as served: the reload script goes in before </body>, with the event link and the labels in the page language.
// The file on disk is not changed, and a page opened from file:// has no script.
export function withLiveReload(html, eventPath) {
  const { ui } = resolveLanguage({ declared: readPage(html).lang });
  const script = `<script data-live="${esc(JSON.stringify({ url: eventPath, ui: ui.live }))}">${LIVE_SCRIPT_BODY}</script>\n`;
  const at = html.lastIndexOf('</body>');
  return at === -1 ? html + script : html.slice(0, at) + script + html.slice(at);
}

// The open event streams, by page file. One watcher on pages/ serves all of them. After a burst of file events settles, each page with
// a stream is compared with what it was; a page that changed gets one "changed" event on its own streams, and other pages get nothing.
// The watcher runs only while a stream is open or opening: the last stream to close closes it and the next stream opens a new one, so
// a pages/ folder that was removed and made again is watched again (on Linux the old watcher can go quiet there without an error).
function liveStreams(home) {
  const streams = new Map(); // file -> Set of responses
  const seen = new Map(); // file -> the page's version when it was last compared
  let watcher = null;
  let timer = null;
  let running = false;
  let again = false;
  let opening = 0; // streams between startWatching() and being added to streams
  const stopIfIdle = () => {
    if (streams.size === 0 && opening === 0) stopWatching();
  };
  // null when the page is gone, or in the middle of a replace: the next file event compares it again.
  const version = async (file) => {
    try {
      const s = await stat(await resolvePage(home, 'pages', file));
      return `${s.mtimeMs}:${s.size}:${s.ino}`;
    } catch {
      return null;
    }
  };
  const compare = async () => {
    for (const [file, open] of streams) {
      const now = await version(file);
      if (now === null || now === seen.get(file)) continue;
      seen.set(file, now);
      for (const res of open) if (!res.writableEnded) res.write('event: changed\ndata: changed\n\n');
    }
  };
  const run = async () => {
    timer = null;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await compare();
      } while (again);
    } catch {
      // A page that cannot be read now is compared again on the next event.
    } finally {
      running = false;
    }
  };
  const settle = () => {
    clearTimeout(timer);
    timer = setTimeout(run, SETTLE_MS);
  };
  const startWatching = () => {
    if (watcher) return;
    // The folder, not the file: a page replaced by a rename is a new file, and a watch on the old one would go quiet.
    // Without a watcher (the folder went away) the stream stays open and quiet, and the next stream tries again.
    try {
      watcher = watch(join(home, 'pages'), settle);
    } catch {
      return;
    }
    watcher.on('error', stopWatching);
  };
  function stopWatching() {
    clearTimeout(timer);
    timer = null;
    watcher?.close();
    watcher = null;
  }
  return {
    // The headers go out only after the page's version is recorded, so a change right after the stream opens is not missed.
    async open(file, res, headers) {
      startWatching();
      opening += 1;
      let now;
      try {
        now = await version(file);
      } finally {
        opening -= 1;
      }
      if (res.destroyed) return stopIfIdle();
      if (!streams.has(file)) {
        streams.set(file, new Set());
        seen.set(file, now);
      }
      streams.get(file).add(res);
      res.on('close', () => {
        const open = streams.get(file);
        open?.delete(res);
        if (open?.size === 0) {
          streams.delete(file);
          seen.delete(file);
        }
        stopIfIdle();
      });
      res.writeHead(200, headers);
      res.write(': open\n\n'); // sends the headers now, so the browser sees the stream open
    },
    close() {
      stopWatching();
      for (const open of streams.values()) for (const res of open) res.end();
      streams.clear();
    },
  };
}

// The event stream of one page. The page is sandboxed without allow-same-origin, so its EventSource arrives with Origin: null and
// Sec-Fetch-Dest: empty; any other origin or destination is a 404, like a wrong token. GET only, and the stream carries no page content.
async function openEvents(req, res, home, file, live) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return reply(req, res, 405, 'text/plain; charset=utf-8', 'Method not allowed\n');
  }
  const { origin, 'sec-fetch-dest': dest } = req.headers;
  // A request with neither header (curl, an old browser) passes, as on the page route: whoever holds the token can already fetch the
  // page itself, and the stream carries less than the page.
  if ((origin !== undefined && origin !== 'null') || (dest !== undefined && dest !== 'empty')) return notFound(req, res);
  if (!(await resolvePage(home, 'pages', file))) return notFound(req, res);
  return live.open(file, res, { ...HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Access-Control-Allow-Origin': 'null' });
}

function handler(home, secret, allowedHosts, live) {
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
      const events = prefix === EVENTS;
      const dir = events ? 'pages' : Object.hasOwn(PREFIX, prefix) ? PREFIX[prefix] : undefined;
      if (!dir || !token || !raw) return notFound(req, res);
      let file;
      try {
        file = decodeURIComponent(raw);
      } catch {
        return notFound(req, res);
      }
      if (!validFileName(file) || !tokenMatches(secret, dir, file, token)) return notFound(req, res);
      if (events) return await openEvents(req, res, home, file, live);
      // A page is only opened, never fetched: a browser marks a script's fetch (or a service worker's) with another
      // destination, so a leaked token does not let a script read the page. curl sends no Sec-Fetch-Dest.
      const dest = req.headers['sec-fetch-dest'];
      if (dest !== undefined && dest !== 'document') return notFound(req, res);
      const real = await resolvePage(home, dir, file);
      if (!real) return notFound(req, res);
      // The new-version button is for the person who made the page: a reader through a LAN or public address gets the page without it.
      const html = await readFile(real);
      const page = LOOPBACK_HOST.test(req.headers.host) ? html.toString('utf8') : withoutUpdateNotice(html.toString('utf8'));
      const body = dir === 'pages' ? withLiveReload(page, eventLink({ secret }, file)) : page;
      return reply(req, res, 200, 'text/html; charset=utf-8', body);
    } catch {
      return notFound(req, res);
    }
  };
}

// Whether something accepts connections on the port: a recorded server whose pid was reused by another process does not.
function listening(port, host = HOST, timeout = 500) {
  return new Promise((done) => {
    const socket = connect({ host, port });
    const end = (up) => { socket.destroy(); done(up); };
    socket.setTimeout(timeout, () => end(false));
    socket.once('connect', () => end(true));
    socket.once('error', () => end(false));
  });
}

// Default: loopback only. LAN listening, the Tailscale address and the public link origin are explicit opt-ins.
// tailscaleStatus and bindHost are test seams: the parsed `tailscale status --json`, and the address to listen on instead of the tailnet one.
export async function startServer({ home, port = DEFAULT_PORT, lan = false, publicUrl, lanAddresses, secretFile, tailscale = false, tailscaleStatus, bindHost }) {
  const addresses = lan ? (lanAddresses ?? lanIPv4Addresses()) : [];
  if (lan && (!addresses.length || addresses.some((address) => isIP(address) !== 4
    || address === LAN_BIND || address.startsWith('127.')))) {
    throw new ServeError('--lan needs at least one active non-loopback IPv4 interface');
  }
  const publicOrigin = publicUrl === undefined ? null : publicUrlOrigin(publicUrl);
  if (tailscale && (lan || publicOrigin)) throw new ServeError('--tailscale cannot be combined with --lan or --public-url');
  const tail = tailscale ? tailscaleTarget(tailscaleStatus ? tailscaleStatus() : readTailscaleStatus()) : null;
  const listenHost = tail ? bindHost ?? tail.address : lan ? LAN_BIND : HOST;
  const allowedHosts = [...addresses, ...(publicOrigin ? [new URL(publicOrigin).host] : []), ...(tail ? [tail.address, tail.host] : [])]; // a bare MagicDNS host is what a browser sends on port 80
  const running = readServeInfo(home);
  if (running && await listening(running.port, running.host)) throw new ServeError(`am serve is already running on ${running.baseUrl ?? `http://${HOST}:${running.port}`} (pid ${running.pid}); stop it first`);
  // The tailnet address stays the same, so its links last across restarts unless --secret-file names another file.
  if (tail && !secretFile) ensureHome(home); // the default secret file lives in home, which may not exist yet
  const secret = loadSecret(secretFile ?? (tail ? join(home, 'serve-secret') : undefined));
  const live = liveStreams(home);
  const server = createServer(handler(home, secret, allowedHosts, live));
  await new Promise((done, fail) => {
    server.once('error', (e) => fail(e.code === 'EADDRINUSE'
      ? new ServeError(`Port ${port} is already in use; pick another with am serve --port <n>`)
      : tail && e.code === 'EADDRNOTAVAIL'
        ? new ServeError(`Cannot listen on ${listenHost}: Tailscale in userspace-networking mode has no interface for it. For tailnet devices, run \`tailscale serve --bg ${port}\` and am serve --public-url https://<machine>.<tailnet>.ts.net; --lan reaches only the local network`)
        : e));
    server.listen(port, listenHost, done);
  });
  const actual = server.address().port;
  if (tail) allowedHosts.push(`${tail.host}:${actual}`); // port 0 is known only now; the handler reads the same array
  const baseUrl = publicOrigin ?? (tail ? new URL(`http://${tail.host}:${actual}`).origin : `http://${lan ? addresses[0] : HOST}:${actual}`);
  try {
    writeInfo(home, { pid: process.pid, port: actual, secret, startedAt: Date.now(), baseUrl, ...(tail ? { host: listenHost } : {}) });
  } catch (e) {
    // Do not leave a possibly LAN-exposed listener open if its secret cannot be persisted.
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    throw new ServeError(`Cannot save serve.json; server stopped: ${e.message}`);
  }
  let closed;
  const close = () => {
    closed ??= new Promise((done) => {
      removeInfo(home, secret, actual);
      live.close();
      server.close(() => done());
      server.closeAllConnections();
    });
    return closed;
  };
  return { port: actual, secret, close, baseUrl, addresses, lan, tailscale: !!tail, secretPath: tail && !secretFile ? join(home, 'serve-secret') : secretFile };
}

// am serve: run in the foreground until Ctrl-C / SIGTERM / SIGHUP. Resolves with the exit code.
export async function runServe({ home, port, lan = false, publicUrl, secretFile, tailscale = false, print, fail }) {
  let srv;
  try {
    srv = await startServer({ home, port, lan, publicUrl, secretFile, tailscale });
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
    process.once('exit', () => removeInfo(home, srv.secret, srv.port));
    if (srv.tailscale) {
      print(`Serving pages on ${srv.baseUrl} on your tailnet only (Ctrl-C to stop). am render prints a link for each page.`);
      print(`Links stay valid across restarts. To revoke every link, stop the server, delete ${srv.secretPath} and start it again.`);
    } else if (lan) {
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
