import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lanIPv4Addresses, publicUrlOrigin, pageLink, startServer, ServeError } from '../src/serve.js';

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

test('LAN address discovery ignores internal, duplicate and link-local interfaces', () => {
  const found = lanIPv4Addresses({
    one: [{ address: '192.168.8.20', family: 'IPv4', internal: false },
      { address: '127.0.0.1', family: 'IPv4', internal: true }],
    two: [{ address: '192.168.8.20', family: 4, internal: false },
      { address: '169.254.0.3', family: 'IPv4', internal: false },
      { address: '10.0.0.9', family: 'IPv4', internal: false }],
  });
  assert.deepEqual(found, ['10.0.0.9', '192.168.8.20']);
});

test('public URL accepts only HTTP(S) origins', () => {
  assert.equal(publicUrlOrigin('https://Example.COM:443/'), 'https://example.com');
  assert.equal(publicUrlOrigin('http://example.com:8080'), 'http://example.com:8080');
  for (const bad of ['file:///tmp', 'https://example.com/path', 'https://example.com/?x=1',
    'https://u:p@example.com', 'https://example.com/#x', 'http://0.0.0.0']) {
    assert.throws(() => publicUrlOrigin(bad), ServeError, bad);
  }
});

test('LAN mode serves only authorized Host and preserves capability-link origin', async () => {
  const home = mkdtempSync(join(tmpdir(), 'am-lan-test-'));
  mkdirSync(join(home, 'pages'));
  writeFileSync(join(home, 'pages', 'test.html'), '<h1>lan</h1>');
  let srv;
  try {
    srv = await startServer({ home, port: 0, lan: true, lanAddresses: ['192.168.8.20'],
      publicUrl: 'https://render.example:443' });
    assert.equal(srv.baseUrl, 'https://render.example');
    assert.match(pageLink(srv, 'pages', 'test.html'), /^https:\/\/render\.example\/p\//);
    const path = new URL(pageLink(srv, 'pages', 'test.html')).pathname;
    for (const host of ['192.168.8.20:' + srv.port, 'render.example', 'localhost']) {
      assert.equal(await fetch(srv.port, path, host), 200, host);
    }
    for (const host of ['attacker.example', 'render.example.evil.test', '192.168.8.21',
      '192.168.8.20:99999']) {
      assert.equal(await fetch(srv.port, path, host), 404, host);
    }
  } finally {
    if (srv) await srv.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('LAN mode rejects missing usable addresses before opening a listener', async () => {
  const home = mkdtempSync(join(tmpdir(), 'am-lan-invalid-'));
  try {
    await assert.rejects(startServer({ home, port: 0, lan: true, lanAddresses: [] }), ServeError);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('server releases the listening port and temporary metadata if startup persistence fails', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  // A child process prevents a failed implementation from leaving this test runner with an open server handle.
  const probe = String.raw`
    import { createServer } from 'node:net';
    import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { startServer, ServeError } from './src/serve.js';

    const home = mkdtempSync(join(tmpdir(), 'am-serve-startup-'));
    mkdirSync(join(home, 'serve.json')); // renameSync cannot replace a directory with the metadata file.
    const reserve = createServer();
    await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
    const port = reserve.address().port;
    await new Promise((resolve) => reserve.close(resolve));

    let controlledError = false;
    try {
      await startServer({ home, port });
    } catch (e) {
      controlledError = e instanceof ServeError;
    }
    const candidate = createServer();
    let portReleased = false;
    try {
      await new Promise((resolve, reject) => {
        candidate.once('error', reject);
        candidate.listen(port, '127.0.0.1', resolve);
      });
      portReleased = true;
      await new Promise((resolve) => candidate.close(resolve));
    } catch {
      // Previous server leaked its listener.
    }
    const noTempFile = !readdirSync(home).some((name) => name.endsWith('.tmp'));
    rmSync(home, { recursive: true, force: true });
    console.log(JSON.stringify({ controlledError, portReleased, noTempFile }));
    process.exit(controlledError && portReleased && noTempFile ? 0 : 1);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8', timeout: 6000,
  });
  assert.equal(result.status, 0, [result.stdout, result.stderr].join('\n'));
});

test('LAN discovery never advertises a loopback address even if the interface flag is inconsistent', () => {
  assert.deepEqual(lanIPv4Addresses({
    unusual: [
      { address: '127.0.0.2', family: 'IPv4', internal: false },
      { address: '10.2.3.4', family: 'IPv4', internal: false },
    ],
  }), ['10.2.3.4']);
});