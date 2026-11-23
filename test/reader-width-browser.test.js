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
    cdp = await connect(await devtoolsUrl(chrome));
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
    const open = async ({ reload = false } = {}) => {
      const loaded = cdp.once('Page.loadEventFired');
      if (reload) await send('Page.reload', {});
      else await send('Page.navigate', { url: pathToFileURL(file).href });
      await loaded;
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
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x, y: handle.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x - 80, y: handle.y, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x - 80, y: handle.y, button: 'left', buttons: 0, clickCount: 1 });
    const dragged = await width();
    assert.ok(dragged < before - 50, `${before} -> ${dragged}`);
    await open({ reload: true });
    assert.ok(Math.abs(await width() - dragged) < 2);
    await evaluate("document.querySelector('.am-width-handle[data-side=right]').focus()");
    const key = async (key, code, n) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: n, nativeVirtualKeyCode: n }); };
    await key('ArrowLeft', 'ArrowLeft', 37);
    assert.ok(await width() < dragged - 5);
    await key('Escape', 'Escape', 27);
    assert.ok(Math.abs(await width() - dragged) < 2);
    await open({ reload: true });
    assert.ok(Math.abs(await width() - dragged) < 2);
  } finally {
    cdp?.close();
    if (chrome && chrome.exitCode === null) await new Promise(resolve => { chrome.once('exit', resolve); chrome.kill(); });
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
