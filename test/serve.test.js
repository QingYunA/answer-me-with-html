import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, statSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { createServer } from 'node:net';
import { uptime } from 'node:os';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { clean } from '../src/housekeeping.js';
import { pageToken, pageLink, validFileName, startServer, serveLink, ServeError } from '../src/serve.js';

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

function get(path, { method = 'GET', host } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: srv.port, path, method, headers: host === undefined ? {} : { Host: host }, setHost: host === undefined }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

const urlOf = (dir, file, secret = srv.secret) => `/${dir === 'pages' ? 'p' : 'v'}/${pageToken(secret, dir, file)}/${encodeURIComponent(file)}`;

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
    assert.equal(r.body, body);
    assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(r.headers['content-security-policy'], "frame-ancestors 'none'");
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
  assert.equal(statSync(file).mode & 0o777, 0o600);
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
    assert.equal(statSync(join(dir, 'serve.json')).mode & 0o777, 0o600);
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
    assert.equal(statSync(join(dir, 'serve.json')).mode & 0o777, 0o600);
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

test('am serve: runs in the foreground, writes serve.json and removes it on SIGINT', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-serve-proc-'));
  const child = spawn(process.execPath, [AM_BIN, 'serve', '--port', '0'], { env: { ...process.env, AM_HOME: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (c) => { out += c; if (out.includes('\n')) resolve(); });
      child.on('error', reject);
      exited.then(() => reject(new Error(`exited early: ${out}`)));
    });
    const port = Number(out.match(/http:\/\/127\.0\.0\.1:(\d+)/)[1]);
    assert.match(out, /Ctrl-C/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'serve.json'), 'utf8')).port, port);
    child.kill('SIGINT');
    assert.equal((await exited).code, 0);
    assert.equal(existsSync(join(dir, 'serve.json')), false);
  } finally {
    child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});
