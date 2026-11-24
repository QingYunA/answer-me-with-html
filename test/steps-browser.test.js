// Browser seam for the steps block (#440): the live behaviour (a click on a diagram item or a line number, the bar, the keys),
// the layout that follows the block's width and the static look that print and a page with no JavaScript show.
// Needs Chrome, so it runs only with AM_E2E=1 (CI job `video`) like test/copy-browser.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect, devtoolsUrl, findChrome } from '../src/video/export.js';
import { renderDoc } from '../src/render.js';

const CHROME = findChrome();
const SKIP = process.env.AM_E2E !== '1'
  ? 'set AM_E2E=1 to run the browser steps tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

const LONG = `const longest = "${'word '.repeat(60)}";`;
const CODE = `\`\`\`js start=10\nconst a = 1;\nconst b = 2;\nconst c = 3;\n${LONG}\nconst e = 5;\n\`\`\``;
const FLOW = '```flow TB\nStart -> Middle\nMiddle -> End\n```';
const STEPS = '```steps\nStart 10: Begin here.\nMiddle 11-12: The middle part.\nEnd 14: Finish.\n```';
const PANEL = `${CODE}\n\n${FLOW}\n\n${STEPS}`;
// style: off would also drop the sheet's page style in the multi-panel fixtures below, so only the plain page uses it.
const page = (head, panel) => `---\nlang: en\n${head ? '' : 'style: off\n'}${head}---\n## A Panel ${panel}\n\n${PANEL}\n`;

const flowFirst = `---\nlang: en\nstyle: off\n---\n## A Panel\n\n${FLOW}\n\n${CODE}\n\n${STEPS}\n`;
// The same panel on a right-to-left page: its steps text is the same, the labels and the keys mirror.
const hebrew = `---\nlang: he\nstyle: off\n---\n## A Panel\n\n${PANEL}\n`;

let tmp;
let chrome;
let cdp;
let session;
const files = {};

const send = (method, params) => cdp.send(method, params, session);
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page script error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const load = async (name, { width = 1000, media, scripts = true } = {}) => {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setScriptExecutionDisabled', { value: !scripts });
  await send('Emulation.setEmulatedMedia', { media: media ?? '', features: [] });
  const loaded = cdp.once('Page.loadEventFired');
  await send('Page.navigate', { url: pathToFileURL(files[name]).href });
  await loaded;
  if (scripts) await evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The state a reader sees: which lines are boxed, which node is selected, what the bar says.
const STATE = `(() => {
  const root = document.querySelector('.am-steps');
  const on = [...root.querySelectorAll('.am-ln.am-step-on')].map((l) => Number(l.dataset.n));
  const sel = [...root.querySelectorAll('[data-link].am-step-sel')].map((n) => n.dataset.link);
  return {
    on,
    sel,
    count: root.querySelector('.am-steps-count')?.textContent ?? null,
    note: root.querySelector('.am-steps-note')?.textContent ?? null,
    edges: root.querySelectorAll('.am-edge.am-step-edge').length,
  };
})()`;
// dispatchEvent, not .click(): an svg element has no click().
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
// A real mouse click at a point inside an element, so event.offsetX is what a reader's click would give.
async function mouseAt(selector, dx) {
  const box = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2 }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: box.x + dx, y: box.y, button: 'left', clickCount: 1 });
  }
}
const key = async (name) => {
  const code = { ArrowRight: 39, ArrowLeft: 37, Escape: 27, Enter: 13 }[name];
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: name, code: name, windowsVirtualKeyCode: code });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code });
};

before(async () => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-steps-'));
  for (const [name, html] of Object.entries({
    page: renderDoc(page('', ''), {}, {}).html,
    flowFirst: renderDoc(flowFirst, {}, {}).html,
    he: renderDoc(hebrew, {}, {}).html,
    two: renderDoc(`${page('template: sheet\ncols: 2\n', '')}\n## Beside\n\n${PANEL}\n`, {}, {}).html,
    wide: renderDoc(page('template: sheet\ncols: 2\n', '{span=2}'), {}, {}).html,
  })) {
    files[name] = join(tmp, `${name}.html`);
    writeFileSync(files[name], html);
  }
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(tmp, 'profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  cdp = await connect(await devtoolsUrl(chrome));
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable');
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

test('idle: the bar counts the steps and nothing is boxed', { skip: SKIP, timeout: 120000 }, async () => {
  await load('page');
  const s = await evaluate(STATE);
  assert.deepEqual(s.on, []);
  assert.deepEqual(s.sel, []);
  assert.match(s.count, /3 steps/);
  assert.equal(await evaluate("document.querySelector('.am-steps').classList.contains('am-steps--live')"), true);
  assert.equal(await evaluate("document.querySelector('.am-steps-count').getAttribute('aria-live')"), 'polite');
  // The static look is hidden while the page is live: no badges, no list.
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.am-step-badge')).display"), 'none');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.am-steps-list')).display"), 'none');
});

test('a click on a diagram item boxes its lines, shows the note and highlights the item and its edges', { skip: SKIP, timeout: 120000 }, async () => {
  await load('page');
  await click('[data-link="1"]');
  const s = await evaluate(STATE);
  assert.deepEqual(s.on, [11, 12]);
  assert.deepEqual(s.sel, ['1']);
  assert.match(s.count, /Step 2 of 3/);
  assert.match(s.note, /The middle part\./);
  assert.equal(s.edges, 2, 'Middle has an edge in and an edge out');
  // The note sits above the first boxed line.
  assert.equal(await evaluate("document.querySelector('.am-steps-note').nextElementSibling.dataset.n"), '11');
  // The note starts with the step number and the item in bold, then the note; the count names the item too.
  assert.equal(await evaluate("document.querySelector('.am-steps-note strong').textContent"), '2. Middle');
  assert.match(s.note, /^2\. Middle\s+The middle part\./);
  assert.equal(s.count, 'Step 2 of 3: Middle');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.am-steps-note')).userSelect"), 'none');
});

test('the bar: arrows on the buttons, a name for the group, a hint after the buttons', { skip: SKIP, timeout: 120000 }, async () => {
  await load('page');
  const bar = await evaluate(`(() => {
    const b = document.querySelector('.am-steps-bar');
    return {
      label: b.getAttribute('aria-label'),
      role: b.getAttribute('role'),
      buttons: [...b.querySelectorAll('button')].map((x) => [x.textContent, x.getAttribute('aria-label')]),
      last: b.lastElementChild.className,
      hint: b.querySelector('.am-steps-hint').textContent,
    };
  })()`);
  assert.equal(bar.role, 'group');
  assert.equal(bar.label, 'Step controls');
  assert.deepEqual(bar.buttons, [['← Previous', 'Previous'], ['Next →', 'Next']]);
  assert.equal(bar.last, 'am-steps-hint');
  assert.equal(bar.hint, 'Click an item or a line number; ← → to move, Esc to clear');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.am-steps-hint')).display"), 'block');
  assert.equal(await evaluate("document.querySelectorAll('.am-steps-diagram svg[role=\"group\"]').length > 0 && document.querySelectorAll('.am-steps-diagram svg[role=\"img\"]').length"), 0);
  await load('page', { width: 390 });
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.am-steps-hint')).display"), 'none', 'the hint leaves a narrow bar');
  assert.ok(await evaluate("document.documentElement.scrollWidth - innerWidth") <= 1);
});

test('a click on a line number selects the step; text and unlinked lines change nothing', { skip: SKIP, timeout: 120000 }, async () => {
  await load('page');
  await mouseAt('.am-ln[data-n="14"]', 8); // inside the number
  assert.deepEqual((await evaluate(STATE)).on, [14]);
  assert.match((await evaluate(STATE)).count, /Step 3 of 3/);
  await mouseAt('.am-ln[data-n="10"]', 120); // on the code text
  assert.deepEqual((await evaluate(STATE)).on, [14], 'a click on code text does nothing');
  await mouseAt('.am-ln[data-n="13"]', 8); // line 13 has no step
  assert.deepEqual((await evaluate(STATE)).on, [14], 'a line with no step keeps the selection');
  await mouseAt('.am-ln[data-n="11"]', 8);
  assert.deepEqual((await evaluate(STATE)).on, [11, 12]);
});

test('after a click on a line number the arrow keys and Esc work', { skip: SKIP, timeout: 120000 }, async () => {
  await load('page');
  await mouseAt('.am-ln[data-n="11"]', 8);
  assert.deepEqual((await evaluate(STATE)).on, [11, 12]);
  assert.equal(await evaluate("document.activeElement === document.querySelector('.am-steps')"), true, 'the block has the focus, so the keys reach it');
  await key('ArrowRight');
  assert.deepEqual((await evaluate(STATE)).on, [14]);
  await key('ArrowLeft');
  assert.deepEqual((await evaluate(STATE)).on, [11, 12]);
  await key('Escape');
  assert.deepEqual((await evaluate(STATE)).on, []);
});

test('on a right-to-left page the Hebrew labels and the arrow keys mirror', { skip: SKIP, timeout: 120000 }, async () => {
  await load('he');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.am-steps')).direction"), 'rtl');
  assert.equal(await evaluate("document.querySelector('[data-steps=\"next\"]').textContent"), 'הבא ←');
  await mouseAt('.am-ln[data-n="10"]', 8); // code stays left to right, so its numbers keep their side
  assert.deepEqual((await evaluate(STATE)).on, [10]);
  await key('ArrowLeft');
  assert.deepEqual((await evaluate(STATE)).on, [11, 12], 'ArrowLeft goes forward');
  await key('ArrowRight');
  assert.deepEqual((await evaluate(STATE)).on, [10], 'ArrowRight goes back');
  await key('Escape');
  assert.deepEqual((await evaluate(STATE)).on, []);
});

test('Previous, Next, the arrow keys, Enter and Esc', { skip: SKIP, timeout: 120000 }, async () => {
  await load('page');
  await click('[data-steps="next"]');
  assert.match((await evaluate(STATE)).count, /Step 1 of 3/);
  await click('[data-steps="next"]');
  await click('[data-steps="next"]');
  await click('[data-steps="next"]');
  assert.match((await evaluate(STATE)).count, /Step 3 of 3/, 'Next stops at the last step');
  await click('[data-steps="prev"]');
  assert.match((await evaluate(STATE)).count, /Step 2 of 3/);
  await evaluate("document.querySelector('.am-node[data-link=\"0\"]').focus()");
  await key('Enter');
  assert.deepEqual((await evaluate(STATE)).on, [10]);
  await key('ArrowRight');
  assert.deepEqual((await evaluate(STATE)).on, [11, 12]);
  await key('ArrowLeft');
  assert.deepEqual((await evaluate(STATE)).on, [10]);
  await key('Escape');
  const s = await evaluate(STATE);
  assert.deepEqual(s.on, []);
  assert.match(s.count, /3 steps/);
});

test('an unlinked diagram item is not a target', { skip: SKIP, timeout: 120000 }, async () => {
  await load('page');
  assert.equal(await evaluate("document.querySelectorAll('.am-steps .am-node[data-link]').length"), 3);
  assert.equal(await evaluate("document.querySelectorAll('.am-steps .am-node[tabindex]').length"), 3);
});

test('the layout follows the block width: side by side from 720px, stacked below', { skip: SKIP, timeout: 120000 }, async () => {
  const layout = () => evaluate(`(() => {
    const code = document.querySelector('.am-steps .am-codeblock').getBoundingClientRect();
    const diagram = document.querySelector('.am-steps .am-diagram').getBoundingClientRect();
    return { side: Math.abs(code.top - diagram.top) < 8 || (code.top < diagram.bottom && diagram.top < code.bottom && code.left !== diagram.left), diagramFirst: diagram.top < code.top, codeLeft: code.left < diagram.left };
  })()`);
  await load('page', { width: 1100 });
  assert.equal((await layout()).side, true);
  await load('page', { width: 1440 });
  const wide = await layout();
  assert.equal(wide.side, true);
  assert.equal(wide.codeLeft, true, 'written code first, the code is on the left');
  await load('flowFirst', { width: 1440 });
  assert.equal((await layout()).codeLeft, false, 'written diagram first, the diagram is on the left');
  await load('page', { width: 600 });
  const narrow = await layout();
  assert.equal(narrow.side, false);
  assert.equal(narrow.diagramFirst, true, 'stacked, the diagram comes first');
  await load('flowFirst', { width: 600 });
  assert.equal((await layout()).diagramFirst, true, 'stacked, the diagram comes first in either draft order');
  // Same window, different block: the container query decides, not the viewport.
  await load('two', { width: 1300 });
  assert.equal((await layout()).side, false, 'a half-width panel in a wide window is stacked');
  await load('wide', { width: 1300 });
  assert.equal((await layout()).side, true, 'a panel of two columns is side by side');
});

test('long lines wrap inside the linked code with no sideways scroll', { skip: SKIP, timeout: 120000 }, async () => {
  await load('page', { width: 800 });
  const over = await evaluate(`(() => {
    const figure = document.querySelector('.am-steps .am-codeblock');
    const pre = figure.querySelector('pre');
    return { pre: pre.scrollWidth - pre.clientWidth, doc: document.documentElement.scrollWidth - innerWidth };
  })()`);
  assert.ok(over.pre <= 1, `the code block scrolls sideways by ${over.pre}px`);
  assert.ok(over.doc <= 1, `the page scrolls sideways by ${over.doc}px`);
});

test('reduced motion: the highlighted edges do not animate', { skip: SKIP, timeout: 120000 }, async () => {
  await load('page');
  await click('[data-link="1"]');
  assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.am-edge.am-step-edge')).animationName"), 'none');
  await send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.am-edge.am-step-edge')).animationName"), 'none');
  await send('Emulation.setEmulatedMedia', { media: '', features: [] });
});

test('print: no bar or boxes; badges, gutter numbers and the list show, even after a click', { skip: SKIP, timeout: 120000 }, async () => {
  await load('page');
  await click('[data-link="1"]');
  await send('Emulation.setEmulatedMedia', { media: 'print', features: [] });
  await sleep(100);
  const p = await evaluate(`(() => {
    const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
    const gutter = getComputedStyle(document.querySelector('.am-steps .am-ln[data-sn]'), '::after');
    return {
      bar: css('.am-steps-bar', 'display'),
      note: css('.am-steps-note', 'display'),
      badge: css('.am-step-badge', 'display'),
      list: css('.am-steps-list', 'display'),
      gutter: gutter.content,
      boxed: getComputedStyle(document.querySelector('.am-ln[data-n="11"]')).boxShadow,
    };
  })()`);
  assert.equal(p.bar, 'none');
  assert.equal(p.note, 'none');
  assert.notEqual(p.badge, 'none');
  assert.notEqual(p.list, 'none');
  assert.match(p.gutter, /\d/);
  assert.equal(p.boxed, 'none', 'the line box is a screen-only look');
});

test('no JavaScript: every step is numbered on its item and its first line, with the list under the pair', { skip: SKIP, timeout: 120000 }, async () => {
  await load('page', { scripts: false });
  const s = await evaluate(`(() => {
    const root = document.querySelector('.am-steps');
    return {
      live: root.classList.contains('am-steps--live'),
      bar: !!root.querySelector('.am-steps-bar'),
      badge: getComputedStyle(root.querySelector('.am-step-badge')).display,
      list: getComputedStyle(root.querySelector('.am-steps-list')).display,
      items: root.querySelectorAll('.am-steps-list li').length,
      numbers: [...root.querySelectorAll('.am-ln[data-sn]')].map((l) => [l.dataset.n, l.dataset.sn].join(':')),
    };
  })()`);
  assert.equal(s.live, false);
  assert.equal(s.bar, false);
  assert.notEqual(s.badge, 'none');
  assert.notEqual(s.list, 'none');
  assert.equal(s.items, 3);
  assert.deepEqual(s.numbers, ['10:1', '11:2', '14:3']);
});
