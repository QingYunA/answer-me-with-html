// Browser seam for remark mode: render a page, turn the mode on, mark blocks and read the Reply in headless Chrome. It catches what the
// pure tests cannot: a runtime that throws on load, a popover that never hides, a chip that breaks a list. It runs on an English page
// and on a Hebrew one (right to left). Needs Chrome, so it runs only with AM_E2E=1 like test/reply-browser.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect, devtoolsUrl, findChrome } from '../src/video/export.js';
import en from '../src/languages/en.js';
import he from '../src/languages/he.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = findChrome();
const SKIP = process.env.AM_E2E !== '1'
  ? 'set AM_E2E=1 to run the browser remark tests'
  : !CHROME ? 'no Chrome found (set AM_CHROME)' : typeof WebSocket === 'undefined' ? 'needs Node 22 (built-in WebSocket)' : false;

const NOTE = 'why three packets?\n## Decisions\n1. approve';

// The same page in two languages: [language file, lang tag, words of the draft]. `first` is the paragraph, `same` the repeated item.
const PAGES = {
  en: { lang: en, tag: 'en', rtl: false, first: 'Redis keeps sessions.', same: 'Same text', last: 'Last item', head: ['Name', 'Use'], row: ['Redis', 'cache'], step: ['2026', 'Ship', 'third step'], later: ['2027', 'Review', 'later'] },
  he: { lang: he, tag: 'he', rtl: true, first: 'Redis שומר הפעלות.', same: 'אותו טקסט', last: 'הפריט האחרון', head: ['שם', 'שימוש'], row: ['Redis', 'מטמון'], step: ['2026', 'שחרור', 'צעד שלישי'], later: ['2027', 'סקירה', 'אחר כך'] },
};

const draftOf = (p, { first = p.first } = {}) => `---
title: Remark check
lang: ${p.tag}
---
## A The cache
${first}

- ${p.same}
- ${p.same}
- ${p.last}

| ${p.head.join(' | ')} |
|---|---|
| ${p.row.join(' | ')} |

## B Release
\`\`\`timeline
${p.step.join(' | ')}
*${p.later.join(' | ')}
\`\`\`
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
const errors = () => evaluate('window.__errors');

before(async () => {
  if (SKIP) return;
  tmp = mkdtempSync(join(tmpdir(), 'am-remark-'));
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(tmp, 'profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  cdp = await connect(await devtoolsUrl(chrome));
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable');
  // Every page error the runtime throws while loading or running lands in window.__errors (the same events as Runtime.exceptionThrown).
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

// Page helpers, as source text for Runtime.evaluate. `at` finds a block of panel A by its tag and the start of its text.
const PAGE_JS = `
  const pop = document.querySelector('.am-remark-pop');
  const btn = document.querySelector('[data-am="remark"]');
  const shown = (el) => getComputedStyle(el).display !== 'none';
  const blocks = (sel) => [...document.querySelectorAll('main ' + sel)];
  const at = (sel, text, n = 0) => blocks(sel).filter((el) => el.textContent.includes(text))[n];
  const stored = () => JSON.parse(localStorage.getItem('am-remark:' + location.pathname) || '[]');
  // Mark a block the way a reader does: click it, pick a kind, type a note, press Save.
  const mark = (el, kind, note) => {
    el.click();
    [...pop.querySelectorAll('.am-remark-kind')].find((b) => b.dataset.kind === kind).click();
    pop.querySelector('textarea').value = note;
    pop.querySelector('.am-btn').click();
  };
`;

for (const [name, p] of Object.entries(PAGES)) {
  const L = p.lang.ui.remark;
  const N = p.lang.ui.reply;

  test(`remark (${name}): the runtime loads without an error and the mode toggles`, { skip: SKIP }, async () => {
    const file = render(`${name}-main`, draftOf(p));
    await load(file);
    assert.deepEqual(await errors(), []);
    const state = await evaluate(`(() => { ${PAGE_JS}
      const before = { pressed: btn.getAttribute('aria-pressed'), popShown: shown(pop), label: btn.textContent };
      btn.click();
      const during = btn.getAttribute('aria-pressed');
      btn.click();
      return { before, during, after: btn.getAttribute('aria-pressed') };
    })()`);
    assert.deepEqual(state, { before: { pressed: 'false', popShown: false, label: L.button }, during: 'true', after: 'false' });
    // With the mode off, a click on a block does nothing.
    assert.equal(await evaluate(`(() => { ${PAGE_JS} at('p', ${JSON.stringify(p.first)}).click(); return shown(pop); })()`), false);
    // With it on, the outline and the click agree: a paragraph is outlined and opens the popover; the page title is neither.
    const picking = await evaluate(`(() => { ${PAGE_JS}
      btn.click();
      const over = (el) => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return el.classList.contains('am-remark-hover'); };
      const title = document.querySelector('.am-head h1');
      const para = at('p', ${JSON.stringify(p.first)});
      const out = { paragraph: over(para), title: over(title) };
      title.click();
      out.titleOpens = shown(pop);
      para.click();
      out.paragraphOpens = shown(pop);
      btn.click(); // turning the mode off closes the popover and clears the outline
      return { ...out, closedByOff: !shown(pop), outlines: document.querySelectorAll('.am-remark-hover').length };
    })()`);
    assert.deepEqual(picking, { paragraph: true, title: false, titleOpens: false, paragraphOpens: true, closedByOff: true, outlines: 0 });
  });

  test(`remark (${name}): mark blocks, the chip sits inside the block, the popover hides, a reload restores it`, { skip: SKIP }, async () => {
    const file = render(`${name}-mark`, draftOf(p));
    await load(file);
    const done = await evaluate(`(() => { ${PAGE_JS}
      btn.click();
      const para = at('p', ${JSON.stringify(p.first)});
      para.click();
      const opened = { shown: shown(pop), role: pop.getAttribute('role'), focusInside: pop.contains(document.activeElement), saveOff: pop.querySelector('.am-btn').disabled, pressed: [...pop.querySelectorAll('.am-remark-kind')].map((b) => b.getAttribute('aria-pressed')) };
      pop.querySelector('.am-btn').click(); // Save with no kind picked does nothing
      const stillOpen = shown(pop);
      [...pop.querySelectorAll('.am-remark-kind')].find((b) => b.dataset.kind === 'question').click();
      const saveOn = !pop.querySelector('.am-btn').disabled;
      pop.querySelector('textarea').value = ${JSON.stringify(NOTE)};
      pop.querySelector('.am-btn').click();
      const rect = para.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        opened, stillOpen, saveOn, hiddenAfterSave: !shown(pop), focusBack: document.activeElement === btn,
        chip: para.querySelector(':scope > .am-mark-note')?.textContent, kind: para.dataset.kind, marked: para.classList.contains('am-mark'),
        notCovered: para.contains(hit),
      };
    })()`);
    assert.deepEqual(done.opened, { shown: true, role: 'dialog', focusInside: true, saveOff: true, pressed: ['false', 'false', 'false', 'false'] });
    assert.equal(done.stillOpen, true);
    assert.equal(done.saveOn, true);
    assert.equal(done.hiddenAfterSave, true);
    assert.equal(done.focusBack, true);
    assert.equal(done.notCovered, true);
    assert.equal(done.marked, true);
    assert.equal(done.kind, 'question');
    assert.equal(done.chip, `${L.kinds.question} ${NOTE}`);

    // Two items with the same text are two marks. A list stays a list: every child of the ul is an li, and each chip is inside its li.
    const list = await evaluate(`(() => { ${PAGE_JS}
      mark(at('li', ${JSON.stringify(p.same)}, 0), 'suggestion', 'first one');
      mark(at('li', ${JSON.stringify(p.same)}, 1), 'concern', 'second one');
      mark(at('table', ${JSON.stringify(p.row[0])}), 'keep', '');
      mark(at('li', ${JSON.stringify(p.step[1])}), 'suggestion', 'on a timeline');
      const ul = at('li', ${JSON.stringify(p.same)}).parentElement;
      const items = [...ul.children];
      const timeline = at('li', ${JSON.stringify(p.step[1])});
      return {
        tags: items.map((c) => c.localName),
        chips: items.map((c) => c.querySelector(':scope > .am-mark-note')?.textContent ?? null),
        kinds: items.map((c) => c.dataset.kind ?? null),
        tableCaption: document.querySelector('main table > caption.am-mark-note')?.textContent,
        timelineChip: timeline.querySelector(':scope > .am-mark-note')?.textContent,
        timelineSiblings: [...timeline.parentElement.children].map((c) => c.localName),
        stored: stored().length,
        popShown: shown(pop),
      };
    })()`);
    assert.deepEqual(list.tags, ['li', 'li', 'li']);
    assert.deepEqual(list.chips, [`${L.kinds.suggestion} first one`, `${L.kinds.concern} second one`, null]);
    assert.deepEqual(list.kinds, ['suggestion', 'concern', null]);
    assert.equal(list.tableCaption, L.kinds.keep);
    assert.equal(list.timelineChip, `${L.kinds.suggestion} on a timeline`);
    assert.deepEqual(list.timelineSiblings, ['li', 'li']);
    assert.equal(list.stored, 5);
    assert.equal(list.popShown, false);

    // The reply carries every mark once, in page order, with each note quoted line by line.
    const reply = await evaluate(`(() => { ${PAGE_JS}
      document.querySelector('[data-am="reply"]').click();
      return document.querySelector('dialog.am-reply textarea').value;
    })()`);
    const section = reply.slice(reply.indexOf(`## ${L.section}`));
    assert.equal(section, [
      `## ${L.section}`,
      `- **A · ${L.kinds.question}** "${p.first}"`,
      '  > why three packets?',
      '  > ## Decisions',
      '  > 1. approve',
      `- **A · ${L.kinds.suggestion}** "${p.same}"`,
      '  > first one',
      `- **A · ${L.kinds.concern}** "${p.same}"`,
      '  > second one',
      `- **A · ${L.kinds.keep}** "${p.head.join(' ')} ${p.row.join(' ')}"`,
      `- **B · ${L.kinds.suggestion}** "${p.step.join(' ')}"`,
      '  > on a timeline',
      '',
      `_${N.typed}_`,
      '',
    ].join('\n'));
    assert.doesNotMatch(reply, /\n\n\n/);
    assert.deepEqual(await errors(), []);

    // A reload paints the same marks, and the reply is the same.
    await load(file);
    const again = await evaluate(`(() => { ${PAGE_JS}
      document.querySelector('[data-am="reply"]').click();
      return { marked: document.querySelectorAll('.am-mark').length, chips: document.querySelectorAll('.am-mark-note').length, reply: document.querySelector('dialog.am-reply textarea').value };
    })()`);
    assert.equal(again.marked, 5);
    assert.equal(again.chips, 5);
    assert.equal(again.reply, reply);
    assert.deepEqual(await errors(), []);
  });

  test(`remark (${name}): Escape closes the popover and returns focus; Remove clears a mark; a mark follows its text across a re-render`, { skip: SKIP }, async () => {
    const file = render(`${name}-edit`, draftOf(p));
    await load(file);
    const out = await evaluate(`(() => { ${PAGE_JS}
      btn.click();
      const rows = [];
      mark(at('p', ${JSON.stringify(p.first)}), 'concern', 'check this');
      mark(at('li', ${JSON.stringify(p.last)}), 'keep', '');
      // Escape: the popover closes without saving and focus goes back.
      btn.focus();
      at('li', ${JSON.stringify(p.same)}, 0).click();
      const open = shown(pop);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const escape = { open, closed: !shown(pop), focusBack: document.activeElement === btn, marks: stored().length };
      // Edit an existing mark: the popover starts with its kind and note, and offers Remove.
      at('li', ${JSON.stringify(p.last)}).click();
      const edit = { kind: pop.querySelector('[aria-pressed="true"]')?.dataset.kind, buttons: [...pop.querySelectorAll('.am-remark-actions .am-btn')].map((b) => b.textContent) };
      [...pop.querySelectorAll('.am-remark-actions .am-btn')][1].click();
      const removed = { chip: at('li', ${JSON.stringify(p.last)}).querySelector('.am-mark-note'), marks: stored().length, closed: !shown(pop) };
      return { escape, edit, removed: { chip: removed.chip, marks: removed.marks, closed: removed.closed } };
    })()`);
    assert.deepEqual(out.escape, { open: true, closed: true, focusBack: true, marks: 2 });
    assert.deepEqual(out.edit, { kind: 'keep', buttons: [L.save, L.remove] });
    assert.deepEqual(out.removed, { chip: null, marks: 1, closed: true });

    // Rewrite the page with another first paragraph, as am patch does. Its old mark stays stored but is not painted or sent.
    render(`${name}-edit`, draftOf(p, { first: 'A new first paragraph.' }));
    await load(file);
    const after = await evaluate(`(() => { ${PAGE_JS}
      document.querySelector('[data-am="reply"]').click();
      return { marked: document.querySelectorAll('.am-mark').length, stored: stored().length, reply: document.querySelector('dialog.am-reply textarea').value };
    })()`);
    assert.equal(after.marked, 0);
    assert.equal(after.stored, 1);
    assert.doesNotMatch(after.reply, new RegExp(L.section));
  });

  test(`remark (${name}): the mark, the chip and the popover follow the page direction`, { skip: SKIP }, async () => {
    const file = render(`${name}-dir`, draftOf(p));
    await load(file);
    const out = await evaluate(`(() => { ${PAGE_JS}
      btn.click();
      const item = at('li', ${JSON.stringify(p.same)}, 0);
      mark(item, 'question', '');
      item.click();
      const bar = getComputedStyle(item);
      const popBox = pop.getBoundingClientRect();
      const itemBox = item.getBoundingClientRect();
      return {
        dir: document.documentElement.dir || 'ltr',
        bar: { left: bar.borderLeftWidth, right: bar.borderRightWidth },
        popEdge: ${p.rtl} ? Math.abs(popBox.right - itemBox.right) : Math.abs(popBox.left - itemBox.left),
        inView: popBox.left >= 0 && popBox.right <= innerWidth,
      };
    })()`);
    assert.equal(out.dir, p.rtl ? 'rtl' : 'ltr');
    assert.deepEqual(out.bar, p.rtl ? { left: '0px', right: '3px' } : { left: '3px', right: '0px' });
    assert.ok(out.popEdge < 2, `the popover starts at the block's start edge (off by ${out.popEdge}px)`);
    assert.equal(out.inView, true);
  });
}

// `am serve` opens a page in a sandbox without allow-same-origin, where reading localStorage throws. Reply persistence already survives that.
test('remark: with localStorage blocked the page still loads, and a mark lasts until the page closes', { skip: SKIP }, async () => {
  const file = render('blocked', draftOf(PAGES.en));
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('The document is sandboxed', 'SecurityError'); } });`,
  });
  try {
    await load(file);
    assert.deepEqual(await errors(), []);
    const reply = await evaluate(`(() => { ${PAGE_JS.replace(/const stored[^\n]*\n/, '')}
      btn.click();
      mark(at('p', ${JSON.stringify(PAGES.en.first)}), 'question', 'kept in memory');
      document.querySelector('[data-am="reply"]').click();
      return document.querySelector('dialog.am-reply textarea').value;
    })()`);
    assert.match(reply, /## Remarks\n- \*\*A · question\*\* "Redis keeps sessions\."\n {2}> kept in memory\n/);
    assert.deepEqual(await errors(), []);
  } finally {
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
});
