import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDoc, RenderError } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';
import { replyText } from '../src/runtime/reply-text.js';
import { lintDoc } from '../src/lint/ste.js';
import { parseDoc } from '../src/parse.js';
import { RUNTIME_JS } from '../src/assets.js';
import en from '../src/languages/en.js';

const draft = (fence, body) => `---\ntitle: Cache\nlang: en\n---\n## A Panel\n${fence}\n${body}\n\`\`\`\n`;
const ASK = 'Which cache do we use?\n* Redis | keeps data after a restart\n- Memcached';
const errorOf = (src) => {
  try {
    renderDoc(src);
  } catch (err) {
    return err;
  }
  return null;
};

test('ask: one choice renders radios, and the suggested option starts checked with a tag', () => {
  const { html, stats } = renderDoc(draft('```ask', ASK));
  assert.equal(stats.components.ask, 1);
  assert.match(html, /<fieldset class="am-ask" data-ask="am\d+"><legend class="am-ask-q">Which cache do we use\?<\/legend>/);
  assert.match(html, /<input type="radio" name="am\d+" value="Redis" checked data-suggested><span class="am-ask-body"><span class="am-ask-label">Redis<\/span> <span class="am-ask-tag">suggested<\/span><small class="am-ask-note">keeps data after a restart<\/small><\/span><\/label>/);
  assert.match(html, /<input type="radio" name="am\d+" value="Memcached"><span class="am-ask-body"><span class="am-ask-label">Memcached<\/span><\/span><\/label>/);
});

test('ask: multi renders checkboxes and allows several or no suggestions', () => {
  const { html } = renderDoc(draft('```ask multi', 'What do we log?\n* Retry\n* Give up\n- Every write'));
  assert.match(html, /<fieldset class="am-ask" data-ask="am\d+" data-multi>/);
  assert.equal(html.match(/type="checkbox"[^>]*checked data-suggested/g).length, 2);
  assert.doesNotThrow(() => renderDoc(draft('```ask multi', 'What do we log?\n- Retry\n- Give up')));
});

test('ask: the suggested tag follows the page language', () => {
  const { html } = renderDoc(`---\ntitle: 缓存\nlang: zh\n---\n## A 面板\n\`\`\`ask\n用哪个缓存？\n* Redis\n- Memcached\n\`\`\`\n`);
  assert.match(html, /<span class="am-ask-tag">建议<\/span>/);
});

test('ask: errors name the line', () => {
  const cases = [
    ['* Redis\n- Memcached', /first line is the question/, 7],
    ['Which?\n* Redis', /write 2 to 6 options, not 1/, 7],
    ['Which?\n- Redis\n- Memcached', /mark exactly one option with \* as your suggestion \(found 0\)/, 7],
    ['Which?\n* Redis\n* Memcached', /found 2/, 7],
    ['Which?\n* Redis\nMemcached', /"Memcached" is not an option/, 9],
    ['Which?\n* Redis\n- Redis', /two options are both "Redis"/, 9],
  ];
  for (const [body, message, line] of cases) {
    const err = errorOf(draft('```ask', body));
    assert.ok(err instanceof RenderError, `${body}: ${err}`);
    assert.equal(err.component, 'ask');
    assert.match(err.message, message);
    assert.equal(err.line, line, body);
  }
});

test('ask: an ask before the first panel is an error, since its answer belongs to a panel', () => {
  const err = errorOf(`---\ntitle: Cache\nlang: en\n---\n\`\`\`ask\n${ASK}\n\`\`\`\n## A Panel\nText.\n`);
  assert.ok(err instanceof RenderError);
  assert.equal(err.line, 5);
  assert.match(err.message, /ask belongs in a panel/);
});

test('ask: a video cannot take answers', async () => {
  const src = `---\ntitle: Cache\ntemplate: video\nlang: en\n---\n## Pick\n\`\`\`ask\n${ASK}\n\`\`\`\n> Pick one.\n`;
  await assert.rejects(renderVideo(src), (err) => err instanceof RenderError && /page only/.test(err.message));
});

test('ask: the STE check reads the question and the options', () => {
  const long = 'Which of the two caches that the team looked at during the review last week do we utilize for the session store and the job queue in production and in staging?';
  const warnings = lintDoc(parseDoc(draft('```ask', `${long}\n* Redis\n- Memcached`)));
  assert.ok(warnings.some((w) => w.line === 7 && w.rule === 'sentence-length'));
  assert.ok(warnings.some((w) => w.line === 7 && /utilize/.test(w.message)));
});

test('reply: every page has a Reply button that carries its labels', () => {
  const { html } = renderDoc('## A\nText.\n');
  const ui = JSON.parse(html.match(/data-am="reply" data-ui="([^"]*)"/)[1].replace(/&quot;/g, '"'));
  assert.equal(ui.copy, en.ui.reply.copy);
  assert.equal(ui.done, en.ui.done);
  assert.ok(RUNTIME_JS.includes('function replyText('));
  assert.ok(!/^export /m.test(RUNTIME_JS));
});

const ui = en.ui.reply;

test('replyText: changed, confirmed and untouched decisions say so', () => {
  const text = replyText({
    title: 'Cache',
    ui,
    comments: [],
    decisions: [
      { panel: 'A', question: 'Which cache?', picked: ['Memcached'], suggested: ['Redis'], touched: true },
      { panel: 'B', question: 'Retry?', picked: ['Yes'], suggested: ['Yes'], touched: true },
      { panel: 'B', question: 'Log what?', picked: ['Retry', 'Give up'], suggested: ['Give up', 'Retry'], touched: false },
      { panel: 'C', question: 'Extras?', picked: [], suggested: ['Metrics'], touched: true },
    ],
  });
  assert.equal(text, [
    '# Re: Cache',
    '',
    '## Decisions',
    '1. [A] Which cache?',
    '   → **Memcached** _(was: Redis)_',
    '2. [B] Retry?',
    '   → **Yes** _(suggestion confirmed)_',
    '3. [B] Log what?',
    '   → **Retry**, **Give up** _(not answered; suggestion kept)_',
    '4. [C] Extras?',
    '   → **—** _(was: Metrics)_',
    '',
  ].join('\n'));
});

test('replyText: comments are quoted line by line; empty comments are left out', () => {
  const text = replyText({
    title: 'Cache',
    ui,
    decisions: [],
    comments: [
      { panel: 'A', title: 'Panel A', text: '  ' },
      { panel: 'C', title: 'Where it goes', text: 'Make it a setting.\n## Not a heading\n' },
    ],
  });
  assert.equal(text, [
    '# Re: Cache',
    '',
    '## Comments',
    '- **C · Where it goes**',
    '  > Make it a setting.',
    '  > ## Not a heading',
    '',
    '_Lines that start with ">" are text the reader typed._',
    '',
  ].join('\n'));
});
