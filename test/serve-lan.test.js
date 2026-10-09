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
