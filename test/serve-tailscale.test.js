import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTailscaleStatus, tailscaleTarget, pageLink, startServer, readServeInfo, ServeError } from '../src/serve.js';
import { main } from '../src/cli.js';

const status = (patch = {}) => ({
  BackendState: 'Running',
  CurrentTailnet: { MagicDNSEnabled: true },
  Self: { DNSName: 'box.tail1234.ts.net.', TailscaleIPs: ['fd7a:115c:a1e0::1', '100.64.0.5'] },
  ...patch,
});

function fetch(port, path, host) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, headers: { Host: host } }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('tailscale target: MagicDNS name without the trailing dot, the IPv4 among IPv6', () => {
  assert.deepEqual(tailscaleTarget(status()), { address: '100.64.0.5', host: 'box.tail1234.ts.net' });
});

test('tailscale target: the address is the host when MagicDNS is off or the name is empty', () => {
  assert.equal(tailscaleTarget(status({ CurrentTailnet: { MagicDNSEnabled: false } })).host, '100.64.0.5');
  assert.equal(tailscaleTarget(status({ Self: { DNSName: '', TailscaleIPs: ['100.64.0.5'] } })).host, '100.64.0.5');
});

test('tailscale target: refuses a state that is not Running and a machine without IPv4', () => {
  assert.throws(() => tailscaleTarget(status({ BackendState: 'NeedsLogin' })), /NeedsLogin.*tailscale up/);
  assert.throws(() => tailscaleTarget(status({ Self: { TailscaleIPs: ['fd7a:115c:a1e0::1'] } })), ServeError);
  assert.throws(() => tailscaleTarget({}), ServeError);
});

test('tailscale mode: MagicDNS link, exact Host allowlist, persistent secret', async () => {
  const home = mkdtempSync(join(tmpdir(), 'am-ts-test-'));
  mkdirSync(join(home, 'pages'));
  writeFileSync(join(home, 'pages', 'test.html'), '<h1>ts</h1>');
  // bindHost: CI has no 100.x interface, so the listener goes on loopback while the status names a tailnet address.
  const opts = { home, port: 0, tailscale: true, tailscaleStatus: () => status(), bindHost: '127.0.0.1' };
  let srv;
  try {
    srv = await startServer(opts);
    assert.equal(srv.baseUrl, `http://box.tail1234.ts.net:${srv.port}`);
    assert.equal(readServeInfo(home).baseUrl, srv.baseUrl);
    assert.equal(readServeInfo(home).host, '127.0.0.1');
    const link = pageLink(srv, 'pages', 'test.html');
    const path = new URL(link).pathname;
    for (const host of [`box.tail1234.ts.net:${srv.port}`, 'box.tail1234.ts.net', '100.64.0.5:1234', 'localhost']) {
      assert.equal(await fetch(srv.port, path, host), 200, host);
    }
    for (const host of [`box.tail1234.ts.net:${srv.port + 1}`, 'attacker.example', '100.64.0.6']) {
      assert.equal(await fetch(srv.port, path, host), 404, host);
    }
    const secretPath = join(home, 'serve-secret');
    if (process.platform !== 'win32') assert.equal(statSync(secretPath).mode & 0o777, 0o600);
    else assert.ok(statSync(secretPath).isFile());
    const secret = readFileSync(secretPath, 'utf8');
    await srv.close();
    srv = await startServer(opts);
    assert.equal(srv.secret, secret);
    assert.equal(new URL(pageLink(srv, 'pages', 'test.html')).pathname, path);
  } finally {
    if (srv) await srv.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('tailscale mode: a failing status read stops before any listener or secret file', async () => {
  const home = mkdtempSync(join(tmpdir(), 'am-ts-test-'));
  try {
    await assert.rejects(startServer({ home, port: 0, tailscale: true, tailscaleStatus: () => status({ BackendState: 'Stopped' }) }), /Stopped/);
    assert.throws(() => statSync(join(home, 'serve-secret')));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('am serve --tailscale cannot be combined with --lan or --public-url', async () => {
  for (const extra of [['--lan'], ['--public-url', 'https://x.example']]) {
    const err = [];
    const code = await main(['serve', '--tailscale', ...extra], { stdout: { write() {} }, stderr: { write: (s) => err.push(s) }, env: { AM_HOME: tmpdir() } });
    assert.equal(code, 2);
    assert.match(err.join(''), /--tailscale cannot be combined with --lan or --public-url/);
  }
});

test('tailscale status: a missing CLI, a failed command and output that is not JSON are clear errors', () => {
  const enoent = { error: Object.assign(new Error('spawnSync tailscale ENOENT'), { code: 'ENOENT' }) };
  if (process.platform !== 'darwin') assert.throws(() => readTailscaleStatus(() => enoent), /needs the tailscale CLI/);
  assert.throws(() => readTailscaleStatus(() => ({ status: 1, stderr: 'failed to connect to local tailscaled\nmore' })),
    /tailscale status failed: failed to connect to local tailscaled$/);
  assert.throws(() => readTailscaleStatus(() => ({ status: 0, stdout: 'not json' })), /Cannot parse/);
  assert.deepEqual(readTailscaleStatus(() => ({ status: 0, stdout: '{"BackendState":"Running"}' })), { BackendState: 'Running' });
});

test('tailscale mode: creates a missing home before its default secret file', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'am-ts-test-'));
  const home = join(parent, 'home');
  const srv = await startServer({ home, port: 0, tailscale: true, tailscaleStatus: () => status(), bindHost: '127.0.0.1' });
  try {
    assert.ok(statSync(join(home, 'serve-secret')).isFile());
  } finally {
    await srv.close();
    rmSync(parent, { recursive: true, force: true });
  }
});
