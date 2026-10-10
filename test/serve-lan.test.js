import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lanIPv4Addresses, publicUrlOrigin, pageLink, startServer, readServeInfo, ServeError } from '../src/serve.js';

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
  assert.deepEqual(found, ['192.168.8.20', '10.0.0.9']);
});

test('LAN addresses: 192.168 first, then 10, then 172.16/12, then the rest, each in numeric order', () => {
  const list = (...addresses) => ({ eth0: addresses.map((address) => ({ address, family: 'IPv4', internal: false })) });
  // Docker's bridge must not win over the real LAN address, whatever order the interfaces come in.
  assert.deepEqual(lanIPv4Addresses(list('172.17.0.1', '192.168.1.5')), ['192.168.1.5', '172.17.0.1']);
  assert.deepEqual(lanIPv4Addresses(list('192.168.1.5', '172.17.0.1')), ['192.168.1.5', '172.17.0.1']);
  assert.deepEqual(
    lanIPv4Addresses(list('100.64.0.2', '172.31.0.1', '172.15.0.1', '10.0.0.10', '10.0.0.9', '192.168.10.1', '192.168.9.1', '172.17.0.1')),
    ['192.168.9.1', '192.168.10.1', '10.0.0.9', '10.0.0.10', '172.17.0.1', '172.31.0.1', '100.64.0.2', '172.15.0.1'],
  );
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

test('without --lan or --public-url a LAN IP or public Host is 404; each flag admits only its own name', async () => {
  const home = mkdtempSync(join(tmpdir(), 'am-lan-default-'));
  mkdirSync(join(home, 'pages'));
  writeFileSync(join(home, 'pages', 'test.html'), '<h1>x</h1>');
  const status = async (opts, hosts) => {
    const srv = await startServer({ home, port: 0, ...opts });
    try {
      const path = new URL(pageLink(srv, 'pages', 'test.html')).pathname;
      return await Promise.all(hosts.map((host) => fetch(srv.port, path, host)));
    } finally {
      await srv.close();
    }
  };
  try {
    const hosts = ['127.0.0.1', '192.168.8.20', '192.168.8.20:8765', 'pages.example', 'pages.example:8765'];
    assert.deepEqual(await status({}, hosts), [200, 404, 404, 404, 404]);
    assert.deepEqual(await status({ publicUrl: 'https://pages.example' }, hosts), [200, 404, 404, 200, 404]);
    assert.deepEqual(await status({ lan: true, lanAddresses: ['192.168.8.20'] }, hosts), [200, 200, 200, 404, 404]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a second start names the running server by its link origin', async () => {
  const home = mkdtempSync(join(tmpdir(), 'am-lan-running-'));
  let srv;
  try {
    srv = await startServer({ home, port: 0, lan: true, lanAddresses: ['192.168.8.20'] });
    await assert.rejects(startServer({ home, port: 0 }),
      (e) => e instanceof ServeError && e.message.includes(`http://192.168.8.20:${srv.port} `));
  } finally {
    if (srv) await srv.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('serve.json: a link origin that is not a plain origin is ignored', async () => {
  const home = mkdtempSync(join(tmpdir(), 'am-lan-info-'));
  let srv;
  try {
    srv = await startServer({ home, port: 0, publicUrl: 'https://pages.example' });
    assert.equal(readServeInfo(home).baseUrl, 'https://pages.example');
    const file = join(home, 'serve.json');
    const info = JSON.parse(readFileSync(file, 'utf8'));
    for (const baseUrl of ['https://pages.example/x', 'javascript:alert(1)', 5]) {
      writeFileSync(file, JSON.stringify({ ...info, baseUrl }));
      assert.equal(readServeInfo(home), null, String(baseUrl));
    }
    writeFileSync(file, JSON.stringify({ ...info, baseUrl: undefined }));
    assert.equal(readServeInfo(home).port, srv.port, 'a file without baseUrl still works');
  } finally {
    if (srv) await srv.close();
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
