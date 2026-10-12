// Browser seam for math: render a page with formulas and read its layout in headless Chrome. A formula that renders to MathML but has no
// box (a missing font rule, a wrapper with no size), a long formula that widens its panel, and a remark on a paragraph with a formula all
// show only here. Needs Chrome, so it runs only with AM_E2E=1 like test/remark-browser.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect, devtoolsUrl, findChrome } from '../src/video/export.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = findChrome();
const SKIP = process.env.AM_E2E !== '1'
  ? 'set AM_E2E=1 to run the browser math tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

const LONG = 'L(\\theta)=\\mathbb E_{(s,a)\\sim\\pi}\\left[\\sum_{t=0}^{T}\\gamma^t r(s_t,a_t)-\\beta\\,\\mathrm{KL}(\\pi_\\theta\\|\\pi_{\\mathrm{ref}})\\right]+\\lambda\\|\\theta\\|_2^2';
const WIDE = Array.from({ length: 30 }, (_, i) => `a_{${i}} x_{${i}}`).join(' + ');

const draftOf = (theme, mode) => `---
title: Math check
theme: ${theme}
mode: ${mode}
---
## A Inline
Energy $E=mc^2$ holds for $x$, costs $5 and $10.

Long: $${LONG}$

## B Display
$$
${WIDE}
$$

$$
\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}
$$
`;

let tmp;
let chrome;
let cdp;
let session;

const send = (method, params) => cdp.send(method, params, session);
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const render = (name, source) => {
  const draft = join(tmp, `${name}.md`);
  const file = join(tmp, `${name}.html`);
  writeFileSync(draft, source);
  execFileSync(process.execPath, [join(ROOT, 'bin/am.js'), 'render', draft, '-o', file, '--no-open'], {
    env: { ...process.env, AM_NO_UPDATE_CHECK: '1', AM_HOME: join(tmp, 'home') }, stdio: 'pipe',
  });
  return file;
};
const load = async (file) => {
  const loaded = cdp.once('Page.loadEventFired');
  await send('Page.navigate', { url: pathToFileURL(file).href });
  await loaded;
};

before(async () => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-math-'));
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(tmp, 'profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  cdp = await connect(await devtoolsUrl(chrome));
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__errors = [];
      addEventListener('error', (e) => window.__errors.push(String(e.message)));
      addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason)));`,
  });
});

after(async () => {
  cdp?.close();
  if (chrome && chrome.exitCode === null) {
    await new Promise((r) => {
      const timer = setTimeout(r, 3000);
      chrome.once('exit', () => { clearTimeout(timer); r(); });
      chrome.kill();
    });
  }
  try {
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (e) {
    console.warn(`Could not remove ${tmp}: ${e.message}`);
  }
});

for (const [theme, mode] of [['paper', 'light'], ['blueprint', 'dark']]) {
  test(`math (${theme} ${mode}): every formula has a layout box and takes the text colour`, { skip: SKIP }, async () => {
    await load(render(`${theme}-boxes`, draftOf(theme, mode)));
    const r = await evaluate(`(() => {
      const maths = [...document.querySelectorAll('math')];
      const body = getComputedStyle(document.querySelector('.am-md p')).color;
      return {
        count: maths.length,
        boxes: maths.map((m) => { const b = m.getBoundingClientRect(); return b.width > 0 && b.height > 0; }),
        colours: maths.map((m) => getComputedStyle(m).color === body),
        display: document.querySelectorAll('math[display="block"]').length,
        errors: window.__errors,
      };
    })()`);
    assert.equal(r.count, 5);
    assert.ok(r.boxes.every(Boolean), JSON.stringify(r.boxes));
    assert.ok(r.colours.every(Boolean), 'MathML inherits the text colour, so a dark theme needs no rule');
    assert.equal(r.display, 2);
    assert.deepEqual(r.errors, []);
  });
}

test('math: a long inline formula and a wide display formula never widen a 260 px panel', { skip: SKIP }, async () => {
  await load(render('narrow', draftOf('blueprint', 'light')));
  const r = await evaluate(`(() => {
    document.querySelectorAll('.am-panel').forEach((p) => { p.style.width = '260px'; p.style.maxWidth = '260px'; });
    const out = [...document.querySelectorAll('.am-panel')].map((p) => {
      const box = p.getBoundingClientRect();
      const inside = [...p.querySelectorAll('math, .am-math-block')].every((m) => m.getBoundingClientRect().right <= box.right + 1);
      return { width: Math.round(box.width), inside };
    });
    const wide = document.querySelector('.am-math-block');
    return { panels: out, scrolls: wide.scrollWidth > wide.clientWidth, overflowX: getComputedStyle(wide).overflowX, page: document.documentElement.scrollWidth <= innerWidth };
  })()`);
  assert.deepEqual(r.panels, [{ width: 260, inside: true }, { width: 260, inside: true }]);
  assert.equal(r.scrolls, true, 'the display formula scrolls inside its box');
  assert.equal(r.overflowX, 'auto');
  assert.equal(r.page, true);
});

test('math: remark mode and the Reply copy work on a paragraph with a formula', { skip: SKIP }, async () => {
  await load(render('remark', draftOf('paper', 'light')));
  const reply = await evaluate(`(() => {
    const pop = document.querySelector('.am-remark-pop');
    document.querySelector('[data-am="remark"]').click();
    const para = [...document.querySelectorAll('main p')].find((p) => p.textContent.includes('Energy'));
    para.click();
    [...pop.querySelectorAll('.am-remark-kind')].find((b) => b.dataset.kind === 'question').click();
    pop.querySelector('textarea').value = 'is this right?';
    pop.querySelector('.am-btn').click();
    document.querySelector('[data-am="reply"]').click();
    return document.querySelector('dialog.am-reply textarea').value;
  })()`);
  // MathML has no plain text, so the quote is the TeX the draft wrote (src/runtime/math-text.js).
  assert.match(reply, /"Energy \$E=mc\^2\$ holds for \$x\$, costs \$5 and \$10\./);
  assert.match(reply, /> is this right\?/);
  assert.deepEqual(await evaluate('window.__errors'), []);
});

test('math: a Reply quotes a formula as its TeX, inline and display, and a formula Temml cannot read once', { skip: SKIP }, async () => {
  const draft = `---
title: Quote check
---
## A Energy
Energy $E = mc^2$ holds.

Then $$a+b$$ shows.

$$
\\int_0^1 x\\,dx
$$

$$ x^2 $$

- bad $\\frac{$ end

\`\`\`ask
Is $n$ big?
* yes
- no
\`\`\`
`;
  await load(render('quote', draft));
  const reply = await evaluate(`(() => {
    const pop = document.querySelector('.am-remark-pop');
    document.querySelector('[data-am="remark"]').click();
    // The blocks remark mode marks: the page header (title, colophon) is not one of them.
    for (const el of document.querySelectorAll('main p:not(.am-head *), main li, main div.am-math-block')) {
      el.click();
      [...pop.querySelectorAll('.am-remark-kind')].find((b) => b.dataset.kind === 'question').click();
      pop.querySelector('.am-btn').click();
    }
    document.querySelector('[data-am="reply"]').click();
    return document.querySelector('dialog.am-reply textarea').value;
  })()`);
  const quotes = [...reply.matchAll(/^- \*\*A · [^*]+\*\* "(.*)"$/gm)].map((m) => m[1]);
  assert.deepEqual(quotes, ['Energy $E = mc^2$ holds.', 'Then $$a+b$$ shows.', '$$ \\int_0^1 x\\,dx $$', '$$ x^2 $$', 'bad $\\frac{$ end']);
  // A $$ block on its own is a block to mark: the bar and the note chip sit in it, and the chip has a box.
  const chips = await evaluate(`[...document.querySelectorAll('div.am-math-block.am-mark')].map((b) => {
    const chip = b.querySelector(':scope > .am-mark-note')?.getBoundingClientRect();
    return Boolean(chip && chip.width > 0 && chip.height > 0);
  })`);
  assert.deepEqual(chips, [true, true]);
  assert.match(reply, /^1\. \[A\] Is \$n\$ big\?$/m, 'a question with a formula reads it as TeX too');
  assert.deepEqual(await evaluate('window.__errors'), []);
});
