// The page's Content-Security-Policy (src/csp.js): present in the page and the video, pinned to the hash of every inline script,
// and the same hash for the live-reload script that `am serve` adds. The browser seam is test/csp-browser.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderDoc } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';
import { withLiveReload } from '../src/serve.js';
import { pinScript } from '../src/csp.js';
import { remoteImages } from '../src/images.js';
import { LIVE_JS } from '../src/assets.js';
import { sha256Base64 } from '../src/sha256.js';

const DRAFT = `---
title: Policy
lang: en
---
## A Cache
\`\`\`ask
Which cache?
* Redis
- Memcached
\`\`\`

## B Diagram
\`\`\`flow
A -> B
\`\`\`
`;

const VIDEO = `---
title: Policy video
lang: en
---
## Scene one
> Hello there.
`;

const hash = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
const policyOf = (html) => html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)?.[1];
const directive = (policy, name) => policy.split('; ').find((d) => d.startsWith(`${name} `));
// Every inline script the browser would run: not a data block, and with no src.
const executable = (html) => [...html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

test('csp: the page carries a policy right after the charset, with no unsafe-inline for scripts', () => {
  const { html } = renderDoc(DRAFT);
  const policy = policyOf(html);
  assert.ok(policy, 'a meta policy exists');
  assert.ok(html.indexOf('<meta charset="utf-8">') < html.indexOf('http-equiv="Content-Security-Policy"'));
  assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < html.indexOf('<style>'), 'it comes before any content');
  assert.match(policy, /^default-src 'none'; script-src /);
  assert.doesNotMatch(directive(policy, 'script-src'), /unsafe-inline|unsafe-eval/);
  for (const d of ["style-src 'unsafe-inline'", 'img-src data:', 'font-src data:', 'media-src data:', "connect-src 'self'", "form-action 'none'", "base-uri 'none'"]) {
    assert.ok(policy.split('; ').includes(d), `${d} is in the policy`);
  }
});

test('csp: every executable inline script of a page has its hash in the policy', () => {
  for (const options of [{}, { closeAfter: true }, { update: { latest: '9.9.9', current: '0.0.0', command: 'x', highlights: {} } }]) {
    const { html } = renderDoc(DRAFT, {}, {}, options);
    const scripts = executable(html);
    assert.ok(scripts.length >= 1);
    const sources = directive(policyOf(html), 'script-src');
    for (const text of scripts) assert.ok(sources.includes(hash(text)), 'the script hash is pinned');
  }
});

test('csp: the policy also pins the exact live-reload script am serve adds', () => {
  const { html } = renderDoc(DRAFT);
  const served = withLiveReload(html, '/events/live.html');
  const live = [...served.matchAll(/<script data-live="[^"]*">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(live.length, 1);
  assert.equal(live[0], `\n${LIVE_JS}`);
  assert.ok(directive(policyOf(html), 'script-src').includes(hash(live[0])));
  // Nothing else the server adds runs: every executable script of the served page is pinned.
  for (const text of executable(served)) assert.ok(directive(policyOf(served), 'script-src').includes(hash(text)));
});

test('csp: the video carries a policy that pins its three inline scripts and ignores the data block', async () => {
  const { html } = await renderVideo(VIDEO);
  const policy = policyOf(html);
  assert.ok(policy);
  assert.ok(html.indexOf('<meta charset="utf-8">') < html.indexOf('http-equiv="Content-Security-Policy"'));
  const scripts = executable(html);
  assert.equal(scripts.length, 3);
  for (const text of scripts) assert.ok(directive(policy, 'script-src').includes(hash(text)));
  assert.match(html, /<script type="application\/json" id="amv-data">/);
});

test('csp: a remote image gets a warning and the page is still written', () => {
  const draft = `---
title: Remote
lang: en
---
## A Pictures
![chart](https://example.com/chart.png)

\`\`\`html
<img src="//cdn.example.com/a.png">
<img src='http://example.com/b.png'>
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
\`\`\`
`;
  const { html, stats } = renderDoc(draft);
  assert.ok(html.includes('https://example.com/chart.png'));
  const messages = stats.htmlWarnings.map((w) => `L${w.line} ${w.message}`);
  assert.equal(messages.length, 3);
  assert.match(messages[0], /^L6 remote image https:\/\/example\.com\/chart\.png does not load in the page; save the image and use its local path$/);
  assert.match(messages[1], /^L9 remote image \/\/cdn\.example\.com\/a\.png /);
  assert.match(messages[2], /^L10 remote image http:\/\/example\.com\/b\.png /);
});

test('csp: the warning names the src attribute, not data-src before it', () => {
  assert.deepEqual(remoteImages('<img data-src="https://lazy.example.com/a.png" src="//cdn.example.com/b.png">'), ['//cdn.example.com/b.png']);
  assert.deepEqual(remoteImages('<img data-src="https://lazy.example.com/a.png" src="local.png">'), []);
});

test('csp: a remote image written as code is not an image and gets no warning', () => {
  const { stats } = renderDoc('---\ntitle: Code\nlang: en\n---\n## A Code\nWrite `<img src="https://example.com/a.png">` like this.\n');
  assert.deepEqual(stats.htmlWarnings, []);
});

test('csp: sha256Base64 matches node:crypto, for empty, multi-block and non-ASCII text', () => {
  for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'é中🙂'.repeat(100), LIVE_JS]) {
    assert.equal(sha256Base64(text), createHash('sha256').update(text, 'utf8').digest('base64'));
  }
});

test('csp: pinScript allows one more script and leaves the others', () => {
  const { html } = renderDoc(DRAFT);
  const pinned = pinScript(html, 'window.x = 1');
  const sources = directive(policyOf(pinned), 'script-src');
  assert.ok(sources.includes(hash('window.x = 1')));
  for (const text of executable(html)) assert.ok(sources.includes(hash(text)));
});
