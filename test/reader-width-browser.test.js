import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect, devtoolsUrl, findChrome } from '../src/video/export.js';
import { renderDoc } from '../src/render.js';

const chromePath = findChrome();
const skip = process.env.AM_E2E !== '1' ? 'set AM_E2E=1' : !chromePath ? 'Chrome not found' : typeof WebSocket === 'undefined' ? 'Node 22 required' : false;

test('reader width drag, Escape persistence and 900px header', { skip }, async () => {
  const dir = mkdtempSync(join(process.cwd(), '.reader-width-test-'));
  let chrome, cdp;
  try {
    const file = join(dir, 'page.html');
    writeFileSync(file, renderDoc('---\ntitle: Reader width regression header\n---\n\n## Panel\n\nSome content.', {}, {}, { resize: true }).html);
    chrome = spawn(chromePath, ['--headless=new', '--window-size=900,900', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--remote-debugging-port=0', `--user-data-dir=${join(dir, 'profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    cdp = await connect(await devtoolsUrl(chrome, 35000));
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    await cdp.send('Target.activateTarget', { targetId });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => cdp.send(method, params, sessionId);
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
    const open = async ({ reload = false, path = file } = {}) => {
      const loaded = cdp.once('Page.loadEventFired');
      if (reload) await send('Page.reload', {});
      else await send('Page.navigate', { url: pathToFileURL(path).href });
      await loaded;
      await send('Page.bringToFront');
      for (let i = 0; i < 60; i++) {
        if (await evaluate(reload
          ? "document.querySelector('.am-width-handle')?.hasAttribute('aria-valuenow')"
          : "document.querySelector('.am-width-handle')?.getBoundingClientRect().height > 0")) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail('Width handles did not become visible');
    };
    await open();
    const header = await evaluate(`(() => { const r = document.querySelector('.am-head').getBoundingClientRect(); return {left:r.left,right:r.right,width:r.width}; })()`);
    assert.ok(header.width > 0 && header.left >= 0 && header.right <= 900, JSON.stringify(header));
    const handle = await evaluate(`(() => { const r = document.querySelector('.am-width-handle[data-side="right"]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+Math.min(r.height/2,30)}; })()`);
    const width = () => evaluate("document.querySelector('main[data-am-resizable]').getBoundingClientRect().width");
    const before = await width();
    const reservation = () => evaluate("parseFloat(document.documentElement.style.getPropertyValue('--am-bar-w'))");
    const originalReservation = await reservation();
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x, y: handle.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x - 80, y: handle.y, button: 'left', buttons: 1 });
    const key = async (key, code, n) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: n, nativeVirtualKeyCode: n }); };
    const draft = await width();
    assert.ok(draft < before - 50, 'pointer must change the draft width');
    assert.equal(await evaluate("document.body.classList.contains('am-width-drag') && document.activeElement.matches('.am-width-handle')"), true);
    await key('ArrowLeft', 'ArrowLeft', 37);
    await key('End', 'End', 35);
    assert.equal(await width(), draft);
    assert.equal(await evaluate("localStorage.getItem('am:reader-width:v1:' + location.origin + location.pathname)"), null);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x - 80, y: handle.y, button: 'left', buttons: 0, clickCount: 1 });
    const dragged = await width();
    assert.ok(dragged < before - 50, `${before} -> ${dragged}`);
    for (let i = 0; i < 60 && await reservation() === originalReservation; i++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(await reservation() < originalReservation, 'header reservation must track the narrowed content');
    await open({ reload: true });
    assert.ok(Math.abs(await width() - dragged) < 2);
    await evaluate("document.querySelector('.am-width-handle[data-side=right]').focus()");
    await key('ArrowLeft', 'ArrowLeft', 37);
    assert.ok(await width() < dragged - 5);
    await key('Escape', 'Escape', 27);
    assert.ok(Math.abs(await width() - dragged) < 2);
    await open({ reload: true });
    assert.ok(Math.abs(await width() - dragged) < 2);

    // Use a real multi-panel sheet so the card planner runs, and inspect its
    // geometry before pointerup rather than only after the drag completes.
    const sheet = join(dir, 'sheet.html');
    writeFileSync(sheet, renderDoc('---\ntitle: Reflow\ncols: 3\n---\n\n## A First\n\nFirst card content.\n\n## B Second\n\nSecond card content.\n\n## C Third\n\nThird card content.\n\n## D Fourth\n\nFourth card content.', { template: 'sheet' }, {}, { resize: true }).html);
    await open({ path: sheet });
    const geometry = () => evaluate(`(() => {
      const cards = [...document.querySelectorAll('.am-panel')].map(p => { const r = p.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top}; });
      const handles = Object.fromEntries([...document.querySelectorAll('.am-width-handle')].map(h => { const r=h.getBoundingClientRect(); return [h.dataset.side, {x:r.left+r.width/2,y:r.top+Math.min(r.height/2,30)}]; }));
      return {cards,handles,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,drag:document.body.classList.contains('am-width-drag')};
    })()`);
    const columns = measured => new Set(measured.cards.map(c => Math.round(c.left))).size;
    const layout = async predicate => {
      let measured;
      for (let i = 0; i < 60; i++) {
        measured = await geometry();
        if (predicate(measured)) return measured;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.fail(JSON.stringify(measured));
    };
    for (const side of ['right', 'left']) {
      const wide = await layout(g => g.cards.length === 4 && columns(g) > 1 && g.handles.right.x > g.handles.left.x);
      assert.ok(wide.cards.length >= 4);
      const h = wide.handles[side];
      const dx = side === 'right' ? -250 : 250;
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x, y: h.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: h.x, y: h.y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x + dx, y: h.y, button: 'left', buttons: 1 });
      const narrow = await layout(g => g.drag && columns(g) < columns(wide) &&
        Math.abs(g.handles.left.x - Math.min(...g.cards.map(c => c.left))) < 2 &&
        Math.abs(g.handles.right.x - Math.max(...g.cards.map(c => c.right))) < 2);
      assert.equal(narrow.drag, true, 'reflow must happen before pointerup');
      assert.ok(new Set(narrow.cards.map(c => Math.round(c.left))).size < new Set(wide.cards.map(c => Math.round(c.left))).size, JSON.stringify({wide, narrow}));
      assert.ok(narrow.overflow <= 1, JSON.stringify(narrow));
      assert.ok(Math.abs(narrow.handles.left.x - Math.min(...narrow.cards.map(c => c.left))) < 2, JSON.stringify(narrow));
      assert.ok(Math.abs(narrow.handles.right.x - Math.max(...narrow.cards.map(c => c.right))) < 2, JSON.stringify(narrow));
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: h.x + dx, y: h.y, button: 'left', buttons: 0, clickCount: 1 });
      // Restore the full-width starting point for the other handle.
      await evaluate("document.querySelector('[data-width=reset]').click()");
      await geometry();
    }
  } finally {
    cdp?.close();
    if (chrome && chrome.exitCode === null) await new Promise(resolve => { chrome.once('exit', resolve); chrome.kill(); });
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
