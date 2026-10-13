import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, statSync, existsSync, rmSync, readFileSync, renameSync, readdirSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { createServer } from 'node:net';
import { uptime } from 'node:os';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { clean } from '../src/housekeeping.js';
import { pageToken, pageLink, validFileName, startServer, serveLink, ServeError, SANDBOX, withLiveReload, eventLink } from '../src/serve.js';
import { renderDoc } from '../src/render.js';
import { unescapeHtml } from '../src/page.js';

// Windows has no POSIX file modes (Node reports 0o666) and cannot deliver SIGINT to a child process.
const isWin = process.platform === 'win32';
const assertPrivate = (file) => isWin || assert.equal(statSync(file).mode & 0o777, 0o600);

const AM_BIN = fileURLToPath(new URL('../bin/am.js', import.meta.url));

let home;
let outside;
let srv;
before(async () => {
  home = mkdtempSync(join(tmpdir(), 'am-serve-'));
  outside = mkdtempSync(join(tmpdir(), 'am-serve-out-'));
  mkdirSync(join(home, 'pages', 'sub'), { recursive: true });
  mkdirSync(join(home, 'videos'));
  writeFileSync(join(home, 'pages', 'a.html'), '<h1>A</h1>');
  writeFileSync(join(home, 'pages', '中文-1.html'), '<h1>中文</h1>');
  writeFileSync(join(home, 'videos', 'v.html'), '<h1>V</h1>');
  writeFileSync(join(outside, 'secret.html'), 'SECRET');
  symlinkSync(join(outside, 'secret.html'), join(home, 'pages', 'link.html'));
  srv = await startServer({ home, port: 0 });
});
after(async () => {
  await srv.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function get(path, { method = 'GET', host, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: srv.port, path, method, headers: host === undefined ? headers : { ...headers, Host: host }, setHost: host === undefined }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

const urlOf = (dir, file, secret = srv.secret) => `/${dir === 'pages' ? 'p' : 'v'}/${pageToken(secret, dir, file)}/${encodeURIComponent(file)}`;
const eventsOf = (file, secret = srv.secret) => eventLink({ secret }, file);

test('serve token: deterministic, 22 chars, differs by secret, directory and file', () => {
  const t = pageToken('s1', 'pages', 'a.html');
  assert.equal(t, pageToken('s1', 'pages', 'a.html'));
  assert.match(t, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(t, pageToken('s2', 'pages', 'a.html'));
  assert.notEqual(t, pageToken('s1', 'videos', 'a.html'));
  assert.notEqual(t, pageToken('s1', 'pages', 'b.html'));
});

test('serve link: prefix by folder and the file name is percent-encoded', () => {
  const info = { port: 9, secret: 's' };
  assert.equal(pageLink(info, 'pages', '中文.html'), `http://127.0.0.1:9/p/${pageToken('s', 'pages', '中文.html')}/${encodeURIComponent('中文.html')}`);
  assert.match(pageLink(info, 'videos', 'v.html'), /^http:\/\/127\.0\.0\.1:9\/v\//);
});

test('serve file names: only one .html segment is accepted', () => {
  for (const ok of ['a.html', '中文-1.html', 'a b.html']) assert.equal(validFileName(ok), true, ok);
  for (const bad of ['../x.html', 'a/b.html', 'a\\b.html', 'x.txt', 'x.htm', '', '..', 'a\0.html', 'a..b.html']) {
    assert.equal(validFileName(bad), false, JSON.stringify(bad));
  }
  assert.equal(validFileName(decodeURIComponent('%2e%2e%2fx.html')), false, 'decoded traversal');
});

test('serve: a valid link returns the file with all security headers', async () => {
  for (const [dir, file, body] of [['pages', 'a.html', '<h1>A</h1>'], ['pages', '中文-1.html', '<h1>中文</h1>'], ['videos', 'v.html', '<h1>V</h1>']]) {
    const r = await get(urlOf(dir, file));
    assert.equal(r.status, 200, file);
    // A page gets the reload script at serve time; a video does not.
    assert.equal(r.body, dir === 'pages' ? withLiveReload(body, eventsOf(file)) : body);
    assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(r.headers['content-security-policy'], `frame-ancestors 'none'; ${SANDBOX}`);
    assert.doesNotMatch(r.headers['content-security-policy'], /allow-same-origin/);
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin');
  }
  const head = await get(urlOf('pages', 'a.html'), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
});

test('serve: wrong or foreign tokens, other folders and old secrets give a plain 404', async () => {
  const good = urlOf('pages', 'a.html');
  const cases = [
    good.replace(/\/p\/[^/]+\//, '/p/AAAAAAAAAAAAAAAAAAAAAA/'),
    good.replace(/\/p\/[^/]+\//, '/p/short/'),
    `/p/${pageToken(srv.secret, 'pages', '中文-1.html')}/a.html`, // the token of another page
    `/v/${pageToken(srv.secret, 'pages', 'a.html')}/a.html`, // right token, wrong folder
    urlOf('pages', 'a.html', 'old-secret'),
    urlOf('pages', 'missing.html'),
  ];
  for (const path of cases) {
    const r = await get(path);
    assert.equal(r.status, 404, path);
    assert.equal(r.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.doesNotMatch(r.body, /A<\/h1>/);
  }
});

test('serve: a page is opened, not fetched: only a document request or one without Sec-Fetch-Dest gets it', async () => {
  const good = urlOf('pages', 'a.html');
  assert.equal((await get(good, { headers: { 'Sec-Fetch-Dest': 'document' } })).status, 200);
  for (const dest of ['empty', 'script', 'iframe', 'serviceworker', 'worker']) {
    const r = await get(good, { headers: { 'Sec-Fetch-Dest': dest } });
    assert.equal(r.status, 404, dest);
    assert.doesNotMatch(r.body, /A<\/h1>/);
  }
});

test('serve: no listing and no path tricks', async () => {
  const t = (f) => pageToken(srv.secret, 'pages', f);
  const paths = [
    '/', '/p', '/p/', '/p/x', '/p/x/', '/v/', '/p//', `/p/${t('a.html')}/`, `/p/${t('sub')}/sub`, `/p/${t('sub.html')}/sub`,
    `/p/${t('../x.html')}/..%2fx.html`, `/p/${t('..')}/..`, `/p/x/%2e%2e%2fconfig.html`, `/p/${t('a.html')}/a.html/extra`,
    `/p/${t('a.html')}/../pages/a.html`, `/p/${t('a.html')}/a%00.html`, `/p/${t('a.html')}/%E0%A4%A.html`, '/config.json', '/serve.json', '/__proto__/x/y.html',
    `/constructor/${t('a.html')}/a.html`,
  ];
  for (const path of paths) assert.equal((await get(path)).status, 404, path);
});

test('serve: a symlink inside pages/ is never followed, even with a valid token', async () => {
  const r = await get(urlOf('pages', 'link.html'));
  assert.equal(r.status, 404);
  assert.doesNotMatch(r.body, /SECRET/);
});

test('serve: only loopback Host names are accepted, with any port', async () => {
  const path = urlOf('pages', 'a.html');
  assert.equal((await get(path, { host: 'evil.example' })).status, 404);
  assert.equal((await get(path, { host: 'evil.example:8765' })).status, 404);
  assert.equal((await get(path, { host: '127.0.0.1.evil.example' })).status, 404);
  assert.equal((await get(path, { host: '192.168.1.5:8765' })).status, 404);
  assert.equal((await get(path, { host: '' })).status, 404);
  assert.equal((await get(path, { host: 'localhost:9999' })).status, 200);
  assert.equal((await get(path, { host: '127.0.0.1:1' })).status, 200);
  assert.equal((await get(path, { host: '[::1]:8765' })).status, 200);
  assert.equal((await get(path, { host: 'localhost' })).status, 200);
});

test('serve: methods other than GET and HEAD are 405', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const r = await get(urlOf('pages', 'a.html'), { method });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers['content-type'], 'text/plain; charset=utf-8');
  }
});

test('serve.json: mode 0600 while running, a second start is refused, removed after close, am clean keeps it', async () => {
  const file = join(home, 'serve.json');
  assertPrivate(file);
  const info = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(info.pid, process.pid);
  assert.equal(info.port, srv.port);
  assert.match(info.secret, /^[0-9a-f]{64}$/);
  await assert.rejects(startServer({ home, port: 0 }), (e) => e instanceof ServeError && e.message.includes(`${srv.port}`));
  clean(home, { all: true });
  assert.ok(existsSync(file), 'am clean --all keeps serve.json');
  writeFileSync(join(home, 'pages', 'a.html'), '<h1>A</h1>');
  writeFileSync(join(home, 'pages', '中文-1.html'), '<h1>中文</h1>');

  const other = mkdtempSync(join(tmpdir(), 'am-serve-b-'));
  try {
    const second = await startServer({ home: other, port: 0 });
    assert.notEqual(second.secret, info.secret, 'a new secret on every start');
    await second.close();
    assert.equal(existsSync(join(other, 'serve.json')), false);
    const third = await startServer({ home: other, port: 0 });
    await third.close();
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});

test('serve: a stale serve.json (dead pid) is overwritten; a busy port is a clear error', async () => {
  const other = mkdtempSync(join(tmpdir(), 'am-serve-c-'));
  try {
    writeFileSync(join(other, 'serve.json'), JSON.stringify({ pid: 2 ** 22 + 12345, port: 1, secret: 'old' }));
    const fresh = await startServer({ home: other, port: 0 });
    assert.equal(JSON.parse(readFileSync(join(other, 'serve.json'), 'utf8')).pid, process.pid);
    await fresh.close();
    const busy = mkdtempSync(join(tmpdir(), 'am-serve-d-'));
    try {
      await assert.rejects(startServer({ home: busy, port: srv.port }), (e) => e instanceof ServeError && /--port/.test(e.message));
      assert.equal(existsSync(join(busy, 'serve.json')), false);
    } finally {
      rmSync(busy, { recursive: true, force: true });
    }
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});

test('serve.json from before the boot (a reused pid) is stale: no link, and serve starts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-serve-boot-'));
  try {
    const beforeBoot = Date.now() - uptime() * 1000 - 60_000;
    writeFileSync(join(dir, 'serve.json'), JSON.stringify({ pid: 1, port: srv.port, secret: 'abc', startedAt: beforeBoot }));
    assert.doesNotMatch(await render({ AM_HOME: dir }), /link:/);
    const fresh = await startServer({ home: dir, port: 0 });
    assert.equal(JSON.parse(readFileSync(join(dir, 'serve.json'), 'utf8')).pid, process.pid);
    await fresh.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serve.json of a pid that belongs to another user (a reused pid) is stale: no link, and serve starts', { skip: isWin && 'pid 1 is not another user on Windows' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-serve-eperm-'));
  try {
    // pid 1 is init / launchd: alive, but not ours, so process.kill(1, 0) gives EPERM.
    writeFileSync(join(dir, 'serve.json'), JSON.stringify({ pid: 1, port: srv.port, secret: 'abc', startedAt: Date.now() }));
    assert.doesNotMatch(await render({ AM_HOME: dir }), /link:/);
    const fresh = await startServer({ home: dir, port: 0 });
    assert.equal(JSON.parse(readFileSync(join(dir, 'serve.json'), 'utf8')).pid, process.pid);
    await fresh.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serve.json of a live pid with nothing listening on its port is overwritten', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-serve-probe-'));
  try {
    const probe = createServer();
    await new Promise((done) => probe.listen(0, '127.0.0.1', done));
    const { port } = probe.address();
    await new Promise((done) => probe.close(done));
    writeFileSync(join(dir, 'serve.json'), JSON.stringify({ pid: process.pid, port, secret: 'abc', startedAt: Date.now() }));
    const fresh = await startServer({ home: dir, port: 0 });
    const info = JSON.parse(readFileSync(join(dir, 'serve.json'), 'utf8'));
    assert.notEqual(info.secret, 'abc');
    assertPrivate(join(dir, 'serve.json'));
    await fresh.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serve.json: a leftover temp file with a loose mode does not weaken the new file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-serve-tmp-'));
  try {
    const tmp = join(dir, `serve.json.${process.pid}.tmp`);
    writeFileSync(tmp, 'old', { mode: 0o644 });
    const fresh = await startServer({ home: dir, port: 0 });
    assertPrivate(join(dir, 'serve.json'));
    await fresh.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sink() {
  let text = '';
  return { stream: new Writable({ write(chunk, _enc, cb) { text += chunk; cb(); } }), get text() { return text; } };
}

async function render(env, extra = []) {
  const out = sink();
  const code = await main(['render', '-', '--no-open', ...extra], {
    stdout: out.stream, stderr: sink().stream, stdin: Readable.from(['---\ntitle: Serve link\n---\n## A one\nText\n']),
    env: { AM_NO_OPEN: '1', AM_NO_UPDATE_CHECK: '1', ...env }, cwd: env.AM_HOME,
  });
  assert.equal(code, 0);
  return out.text;
}

test('am render: prints a link: line for a page in pages/ when a live server is recorded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-serve-cli-'));
  try {
    const secret = 'cli-secret';
    writeFileSync(join(dir, 'serve.json'), JSON.stringify({ pid: process.pid, port: 4321, secret, startedAt: Date.now() }));
    const text = await render({ AM_HOME: dir });
    const file = text.match(/✓ (.+\.html)/)[1];
    const name = file.slice(join(dir, 'pages').length + 1);
    const link = text.match(/^ {2}link: (\S+)$/m)[1];
    assert.equal(link, `http://127.0.0.1:4321/p/${pageToken(secret, 'pages', name)}/${encodeURIComponent(name)}`);
    assert.ok(text.indexOf('link:') > text.indexOf('✓ '), 'the link follows the ✓ line');
    assert.equal(serveLink(dir, file), link);

    const elsewhere = await render({ AM_HOME: dir }, ['-o', join(outside, 'o.html')]);
    assert.doesNotMatch(elsewhere, /link:/);
    assert.equal(serveLink(dir, join(dir, 'pages', 'sub', 'x.html')), null, 'not directly inside pages/');
    assert.equal(serveLink(dir, join(dir, 'pages', 'x.txt')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('am render: no link: line without a server, with a dead pid, or with a broken serve.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-serve-cli2-'));
  try {
    assert.doesNotMatch(await render({ AM_HOME: dir }), /link:/);
    writeFileSync(join(dir, 'serve.json'), JSON.stringify({ pid: 2 ** 22 + 12345, port: 4321, secret: 's', startedAt: Date.now() }));
    assert.doesNotMatch(await render({ AM_HOME: dir }), /link:/);
    writeFileSync(join(dir, 'serve.json'), JSON.stringify({ pid: process.pid, port: 4321, secret: 's' }));
    assert.doesNotMatch(await render({ AM_HOME: dir }), /link:/, 'no startedAt');
    writeFileSync(join(dir, 'serve.json'), '{ not json');
    assert.doesNotMatch(await render({ AM_HOME: dir }), /link:/);
    writeFileSync(join(dir, 'serve.json'), JSON.stringify({ pid: process.pid, port: 'x' }));
    assert.doesNotMatch(await render({ AM_HOME: dir }), /link:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('am serve: rejects a bad --port', async () => {
  for (const port of ['abc', '70000', '-1', '']) {
    const err = sink();
    const code = await main(['serve', '--port', port], { stdout: sink().stream, stderr: err.stream, env: { AM_HOME: home } });
    assert.equal(code, 2, port);
    assert.match(err.text, /--port/);
  }
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  test(`am serve: runs in the foreground, writes serve.json and removes it on ${signal}`, { skip: isWin && 'Windows cannot send signals to a child' }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-serve-proc-'));
    const child = spawn(process.execPath, [AM_BIN, 'serve', '--port', '0'], { env: { ...process.env, AM_HOME: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const exited = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, signal: sig })));
    try {
      await new Promise((resolve, reject) => {
        child.stdout.on('data', (c) => { out += c; if (out.includes('\n')) resolve(); });
        child.on('error', reject);
        exited.then(() => reject(new Error(`exited early: ${out}`)));
      });
      const port = Number(out.match(/http:\/\/127\.0\.0\.1:(\d+)/)[1]);
      assert.match(out, /Ctrl-C/);
      assert.equal(JSON.parse(readFileSync(join(dir, 'serve.json'), 'utf8')).port, port);
      child.kill(signal);
      assert.equal((await exited).code, 0);
      assert.equal(existsSync(join(dir, 'serve.json')), false);
    } finally {
      child.kill('SIGKILL');
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// Auto-reload (#177): a served page listens on /e/<token>/<file> and the server says when the page file changed.
const SANDBOXED = Object.freeze({ Origin: 'null', 'Sec-Fetch-Dest': 'empty' }); // what a sandboxed page's EventSource sends

// An open event stream: status, headers, the text so far, and whether the server ended it.
function openStream(path, { headers = SANDBOXED, method = 'GET', server = srv } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.port, path, method, headers }, (res) => {
      const s = { status: res.statusCode, headers: res.headers, text: '', ended: false, close: () => req.destroy() };
      res.setEncoding('utf8');
      res.on('data', (c) => { s.text += c; });
      res.on('close', () => { s.ended = true; });
      res.on('error', () => {});
      resolve(s);
    });
    req.on('error', reject);
    req.end();
  });
}
const changes = (s) => (s.text.match(/^event: changed$/gm) ?? []).length;
// Poll instead of sleeping a fixed time.
async function until(check, what, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 20));
  }
}
// Long enough for the server to settle a burst of file events (SETTLE_MS in src/serve.js) and send what it would send.
const quiet = () => new Promise((done) => setTimeout(done, 600));
// How src/cli.js writePage replaces a page: a temp file renamed over it.
const replacePage = (name, html) => {
  const tmp = join(home, 'pages', `.${name}.tmp`);
  writeFileSync(tmp, html);
  renameSync(tmp, join(home, 'pages', name));
};

test('serve events: a wrong token, another page token, another origin or destination, and a missing page are 404', async () => {
  writeFileSync(join(home, 'pages', 'ev.html'), '<h1>E</h1>');
  const good = eventsOf('ev.html');
  const bad = [
    [good.replace(/\/e\/[^/]+\//, '/e/AAAAAAAAAAAAAAAAAAAAAA/')],
    [`/e/${pageToken(srv.secret, 'pages', 'a.html')}/ev.html`], // the token of another page
    [`/e/${pageToken(srv.secret, 'videos', 'v.html')}/v.html`], // a video has no stream
    [eventsOf('ev.html', 'old-secret')],
    [eventsOf('missing.html')],
    [good, { Origin: 'https://evil.example', 'Sec-Fetch-Dest': 'empty' }],
    [good, { Origin: 'null', 'Sec-Fetch-Dest': 'document' }],
    [good, { Origin: 'null', 'Sec-Fetch-Dest': 'script' }], // a sandboxed page's script fetch
    [good, { Origin: 'https://render.example', 'Sec-Fetch-Dest': 'empty' }], // an EventSource from a real origin
  ];
  for (const [path, headers = SANDBOXED] of bad) {
    const r = await get(path, { headers });
    assert.equal(r.status, 404, `${path} ${JSON.stringify(headers)}`);
    assert.equal(r.headers['content-type'], 'text/plain; charset=utf-8');
  }
  assert.equal((await get(good, { headers: SANDBOXED, host: 'evil.example' })).status, 404, 'Host allowlist');
  for (const method of ['HEAD', 'POST']) assert.equal((await get(good, { method, headers: SANDBOXED })).status, 405, method);

  const s = await openStream(good);
  try {
    assert.equal(s.status, 200);
    assert.equal(s.headers['content-type'], 'text/event-stream; charset=utf-8');
    assert.equal(s.headers['access-control-allow-origin'], 'null');
    assert.equal(s.headers['cache-control'], 'no-store');
    assert.doesNotMatch(s.text, /<h1>/, 'the stream never carries the page');
  } finally {
    s.close();
  }
});

test('serve events: a request with neither Origin nor Sec-Fetch-Dest opens the stream, like the page route', async () => {
  writeFileSync(join(home, 'pages', 'ev-plain.html'), '<h1>P</h1>');
  const s = await openStream(eventsOf('ev-plain.html'), { headers: {} });
  try {
    assert.equal(s.status, 200);
    assert.equal(s.headers['content-type'], 'text/event-stream; charset=utf-8');
  } finally {
    s.close();
  }
});

test('serve events: a change sends one event to that page only, and other pages get nothing', async () => {
  writeFileSync(join(home, 'pages', 'live-a.html'), '<h1>A1</h1>');
  writeFileSync(join(home, 'pages', 'live-b.html'), '<h1>B1</h1>');
  const a = await openStream(eventsOf('live-a.html'));
  const a2 = await openStream(eventsOf('live-a.html')); // a second tab of the same page
  const b = await openStream(eventsOf('live-b.html'));
  try {
    assert.deepEqual([a.status, a2.status, b.status], [200, 200, 200]);
    replacePage('live-a.html', '<h1>A2, a longer page</h1>');
    await until(() => changes(a) === 1 && changes(a2) === 1, 'the first event');
    await quiet();
    assert.deepEqual([changes(a), changes(a2), changes(b)], [1, 1, 0], 'one event per change, none for the other page');
    assert.doesNotMatch(a.text, /A2/, 'the event carries no page content');

    writeFileSync(join(home, 'pages', 'live-a.html'), '<h1>A3</h1>'); // an editor saving in place
    await until(() => changes(a) === 2, 'the second event');
    await quiet();
    assert.deepEqual([changes(a), changes(b)], [2, 0]);
    writeFileSync(join(home, 'pages', 'other.html'), '<h1>O</h1>'); // a new page nobody watches
    await quiet();
    assert.deepEqual([changes(a), changes(b)], [2, 0]);
  } finally {
    for (const s of [a, a2, b]) s.close();
  }
});

test('serve events: the reload script is added only to served pages, never to the file, a rendered page or a video', async () => {
  const page = renderDoc('---\nlang: he\n---\n## א\nטקסט', {}, {}, {}).html;
  assert.doesNotMatch(page, /data-live=|EventSource/, 'a rendered page (and its file:// view) has no reload script');
  writeFileSync(join(home, 'pages', 'he.html'), page);
  const r = await get(urlOf('pages', 'he.html'));
  assert.equal(r.status, 200);
  assert.equal(r.body, withLiveReload(page, eventsOf('he.html')));
  assert.equal(r.body.replace(/<script data-live="[^"]*">\n[^]*?<\/script>\n(?=<\/body>)/, ''), page, 'only the script is added');
  const data = JSON.parse(unescapeHtml(r.body.match(/<script data-live="([^"]*)">/)[1]));
  assert.deepEqual(data, { url: eventsOf('he.html'), ui: { updated: 'הדף עודכן', reload: 'רענון' } }, 'labels in the page language');
  assert.equal(readFileSync(join(home, 'pages', 'he.html'), 'utf8'), page, 'the file on disk is unchanged');
  assert.doesNotMatch((await get(urlOf('videos', 'v.html'))).body, /data-live=/);
});

test('serve events: the watcher closes with the last stream, and a pages/ folder made again is watched again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-serve-rewatch-'));
  let server;
  try {
    mkdirSync(join(dir, 'pages'));
    writeFileSync(join(dir, 'pages', 'r.html'), '<h1>R1</h1>');
    server = await startServer({ home: dir, port: 0 });
    const path = eventLink(server, 'r.html');
    const first = await openStream(path, { server });
    assert.equal(first.status, 200);
    first.close();
    await quiet(); // the server sees the close and drops its watcher
    rmSync(join(dir, 'pages'), { recursive: true, force: true });
    mkdirSync(join(dir, 'pages'));
    writeFileSync(join(dir, 'pages', 'r.html'), '<h1>R2</h1>');
    const next = await openStream(path, { server });
    try {
      assert.equal(next.status, 200);
      writeFileSync(join(dir, 'pages', 'r.html'), '<h1>R3, changed</h1>');
      await until(() => changes(next) === 1, 'an event from the new watcher');
    } finally {
      next.close();
    }
  } finally {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('am render: writes the page through a temp file and leaves no temp file behind', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-serve-tmpwrite-'));
  try {
    await render({ AM_HOME: dir });
    await render({ AM_HOME: dir });
    const files = readdirSync(join(dir, 'pages'));
    assert.ok(files.length > 0);
    assert.ok(files.every((f) => f.endsWith('.html') && !f.startsWith('.')), files.join(', '));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('am render -o: a page outside pages/ is written in place, so a hard link to it sees the new page', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-serve-inplace-'));
  const out = mkdtempSync(join(tmpdir(), 'am-serve-inplace-out-'));
  try {
    writeFileSync(join(out, 'o.html'), 'OLD');
    linkSync(join(out, 'o.html'), join(out, 'o-link.html'));
    await render({ AM_HOME: dir }, ['-o', join(out, 'o.html')]);
    const page = readFileSync(join(out, 'o.html'), 'utf8');
    assert.match(page, /A one/);
    assert.equal(readFileSync(join(out, 'o-link.html'), 'utf8'), page, 'a rename would have left the link on the old file');
    assert.deepEqual(readdirSync(out).sort(), ['o-link.html', 'o.html'], 'no temp file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('serve events: shutting the server down ends every open stream', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-serve-events-'));
  try {
    mkdirSync(join(dir, 'pages'));
    writeFileSync(join(dir, 'pages', 'x.html'), '<h1>X</h1>');
    const server = await startServer({ home: dir, port: 0 });
    const path = eventLink(server, 'x.html');
    const streams = [await openStream(path, { server }), await openStream(path, { server })];
    assert.deepEqual(streams.map((s) => s.status), [200, 200]);
    await server.close(); // resolves only when no connection is left open
    await until(() => streams.every((s) => s.ended), 'the streams to end');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
