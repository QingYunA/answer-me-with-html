// Right-to-left pages (Hebrew, Arabic, Persian, Urdu, Yiddish): the root says dir="rtl", the layout mirrors, diagrams read from the right,
// code stays left to right, and a left-to-right page is not touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDoc } from '../src/render.js';
import { renderVideo } from '../src/video/render.js';
import { COMPONENTS } from '../src/components/index.js';
import { replyText } from '../src/runtime/reply-text.js';
import { readFileSync } from 'node:fs';
import { RTL_CSS, RTL_JS, VIDEO_JS } from '../src/assets.js';
import { isolateLtrRuns, svgLine } from '../src/bidi.js';
import { RTL_LETTER } from '../src/runtime/rtl-letter.js';

const draft = (lang, body) => `---\nlang: ${lang}\n---\n${body}`;
const FLOW = '## A זרימה\n```flow LR\nטיוטה -> הכלי am: קורא\nהכלי am -> דף HTML\n```\n';

const flow = (text, args, dir) => COMPONENTS.get('flow').render(text, { args, uid: () => 'u1', ui: {}, dir });
const sequence = (text, dir) => COMPONENTS.get('sequence').render(text, { args: '', uid: () => 'u1', ui: {}, dir });

// The centre x of each node, by name, read from the node's text.
function nodeCentres(svg) {
  const out = {};
  for (const m of svg.matchAll(/<g class="am-node[^"]*" data-key="([^"]+)"[^>]*>[\s\S]*?<text x="([\d.]+)"/g)) out[m[1]] = Number(m[2]);
  return out;
}
const svgWidth = (svg) => Number(svg.match(/<svg viewBox="0 0 (\d+)/)[1]);

test('rtl: a Hebrew page writes dir="rtl" on the root and on the toolbar copy of the root settings', () => {
  const { html, language } = renderDoc(draft('he', FLOW));
  assert.equal(language.dir, 'rtl');
  assert.match(html, /<html lang="he" dir="rtl" data-theme=/);
  assert.match(html, /data-am-root-lang="he" data-am-root-dir="rtl"/);
});

test('rtl: Arabic, Persian, Urdu and Yiddish pages are right to left too, without a label file of their own', () => {
  for (const tag of ['ar', 'fa', 'ur', 'yi']) assert.match(renderDoc(draft(tag, '## A x\ny\n')).html, /<html lang="[^"]+" dir="rtl"/, tag);
});

test('rtl: an undeclared Hebrew draft is detected as he and is right to left', () => {
  assert.match(renderDoc('## A סקירה\nזהו תיאור קצר בעברית.\n').html, /<html lang="he" dir="rtl"/);
});

test('rtl: a Hebrew page uses Hebrew labels and a Hebrew font stack', () => {
  const { html } = renderDoc(draft('he', FLOW));
  assert.match(html, />תגובה<\/button>/);
  assert.match(html, /html:lang\(he\)\[data-theme\]\[data-mode\] \{\n {2}--font-sans: [^;]*"Noto Sans Hebrew"/);
});

test('rtl: a right-to-left page carries the rtl styles, a left-to-right page does not', () => {
  assert.ok(renderDoc(draft('he', FLOW)).html.includes(RTL_CSS));
  for (const lang of ['en', 'zh', 'ja']) assert.ok(!renderDoc(draft(lang, '## A x\ny\n')).html.includes(RTL_CSS), lang);
});

test('rtl: code blocks, diffs and inline code stay left to right', () => {
  assert.match(RTL_CSS, /html\[dir="rtl"\] \.am-codeblock, html\[dir="rtl"\] \.am-code, html\[dir="rtl"\] pre \{ direction: ltr; text-align: left; \}/);
  assert.match(RTL_CSS, /html\[dir="rtl"\] :not\(pre\) > code \{ direction: ltr; unicode-bidi: isolate; \}/);
  // The diff block uses the same .am-codeblock / .am-code classes.
  const { html } = renderDoc(draft('he', '## A קוד\n```diff\n- a\n+ b\n```\n'));
  assert.match(html, /class="am-codeblock am-codeblock--diff"/);
});

test('rtl: table headers and other small labels use the sans font, with no letter spacing or capitals', () => {
  const rule = RTL_CSS.match(/html\[dir="rtl"\] \.am-md th,[^{]*\{([^}]*)\}/);
  assert.ok(rule, 'a rule for table headers');
  assert.match(rule[1], /font-family: var\(--font-sans\)/);
  assert.match(rule[1], /letter-spacing: normal/);
  assert.match(rule[1], /text-transform: none/);
});

test('rtl: flow LR is mirrored, the first node on the right and arrows pointing left', () => {
  const text = 'Start -> Middle: go\nMiddle -> End';
  const ltr = flow(text, 'LR', 'ltr');
  const rtl = flow(text, 'LR', 'rtl');
  const [a, b] = [nodeCentres(ltr), nodeCentres(rtl)];
  assert.ok(a.Start < a.Middle && a.Middle < a.End, 'left to right by default');
  assert.ok(b.Start > b.Middle && b.Middle > b.End, 'right to left on an rtl page');
  const w = svgWidth(rtl);
  // The viewBox rounds the drawing width up, so the mirror image is within one pixel.
  for (const name of ['Start', 'Middle', 'End']) assert.ok(Math.abs(b[name] - (w - a[name])) <= 1, `${name} is the mirror image`);
  // Edges run from a larger x to a smaller one.
  const [x1, x2] = rtl.match(/class="am-edge" d="M([\d.]+),[\d.]+ L([\d.]+)/).slice(1).map(Number);
  assert.ok(x1 > x2);
  assert.match(rtl, /<svg [^>]*direction="rtl"/);
  assert.doesNotMatch(ltr, /direction=/);
});

test('rtl: the label of a group box sits in its top right corner on an rtl page', () => {
  const text = 'A -> B\ngroup G: A, B';
  const rect = (svg) => svg.match(/<rect class="am-cluster" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/).slice(1).map(Number);
  const labelX = (svg) => Number(svg.match(/<text class="am-cluster-label" x="([\d.]+)"/)[1]);
  const [lx, lw] = rect(flow(text, 'LR', 'ltr'));
  assert.equal(labelX(flow(text, 'LR', 'ltr')), lx + 8);
  const rtl = flow(text, 'LR', 'rtl');
  const [rx, rw] = rect(rtl);
  assert.ok(Math.abs(labelX(rtl) - (rx + rw - 8)) < 0.2);
  assert.ok(Math.abs(rw - lw) < 0.2);
});

test('rtl: a sequence diagram puts the first participant on the right', () => {
  const text = 'Client -> Server: hello\nServer -> Server: think';
  const actorX = (svg, name) => Number(svg.match(new RegExp(`<g data-key="${name}"><rect class="am-actor" x="([\\d.]+)"`))[1]);
  const ltr = sequence(text, 'ltr');
  const rtl = sequence(text, 'rtl');
  assert.ok(actorX(ltr, 'Client') < actorX(ltr, 'Server'));
  assert.ok(actorX(rtl, 'Client') > actorX(rtl, 'Server'));
  assert.match(rtl, /<svg [^>]*direction="rtl"/);
  // The self call loops out to the left of the lifeline.
  const loop = rtl.match(/d="M([\d.]+),[\d.]+ H([\d.]+) V/).slice(1).map(Number);
  assert.ok(loop[1] < loop[0]);
});

test('rtl: a sequence or flow without a page direction renders exactly as before (left to right)', () => {
  const text = 'A -> B: x\nB --> A';
  assert.equal(sequence(text, undefined), sequence(text, 'ltr'));
  assert.equal(flow(text, 'LR', undefined), flow(text, 'LR', 'ltr'));
});

test('rtl: the limits scale starts from the right on an rtl page', () => {
  const render = (dir) => COMPONENTS.get('limits').render('Size | 4 / 10 | KB', { args: '', dir });
  assert.match(render('rtl'), /class="am-lim-mark" style="right: /);
  assert.match(render('ltr'), /class="am-lim-mark" style="left: /);
  assert.doesNotMatch(render('rtl'), /style="left: /);
});

test('rtl: the reply arrow points the way the text runs', () => {
  const ui = { decisions: 'D', comments: 'C', confirmed: 'ok', untouched: 'kept', was: 'was', typed: 'typed' };
  const decisions = [{ panel: 'A', question: 'Q', picked: ['x'], suggested: ['x'], touched: true }];
  assert.match(replyText({ title: 'T', decisions, comments: [], ui }), / {3}→ \*\*x\*\*/);
  assert.match(replyText({ title: 'T', decisions, comments: [], ui, rtl: true }), / {3}← \*\*x\*\*/);
});

test('rtl: a left-to-right page has no dir attribute and no mirrored diagram', () => {
  const { html } = renderDoc(draft('en', '## A Flow\n```flow LR\nA -> B\n```\n'));
  assert.doesNotMatch(html, /<html[^>]*\sdir=/);
  assert.doesNotMatch(html, /data-am-root-dir="/);
  assert.doesNotMatch(html, /direction="rtl"/);
});

// The bidi marks written around a left-to-right line of svg text (LRI ... PDI).
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);
const WJ = String.fromCharCode(0x2060);
const hebrewPage = (body, front = '') => renderDoc(`---
lang: he
${front}---
${body}`).html;

test('rtl: a path in a tree keeps its slash at the end (src/, not /src)', () => {
  const html = hebrewPage(`## A מבנה
\`\`\`tree list
src/ | כל הקוד
  cache/ | שכבת הקאש
\`\`\`
`);
  assert.match(html, /<div class="am-tree-box am-tree-box--root"[^>]*><bdi dir="ltr">src\/<\/bdi><small>כל הקוד<\/small>/);
  assert.match(html, /<span class="am-tree-label"><bdi dir="ltr">cache\/<\/bdi><\/span><span class="am-tree-sub">שכבת הקאש<\/span>/);
});

test('rtl: an English term with a colon before Hebrew words keeps the page direction, so the colon is read right after the term', () => {
  const html = hebrewPage(`## A צינור
\`\`\`tree
ci/
  lint: בדיקת כתיבה
  test: בדיקות יחידה
\`\`\`
`);
  // No isolate: in a right-to-left line the colon shows on the left of "lint", which is where a Hebrew reader meets it, after the term.
  // Isolating "lint:" as left to right put the colon on the right, read before the term.
  assert.match(html, />lint: בדיקת כתיבה<\/div>/);
  assert.match(html, />test: בדיקות יחידה<\/div>/);
  assert.doesNotMatch(html, /<bdi dir="ltr">(lint|test):/);
  assert.equal(isolateLtrRuns('<h2>ALE-Bench: מה נמדד</h2>'), '<h2>ALE-Bench: מה נמדד</h2>');
  assert.equal(isolateLtrRuns('<h1>NEXUS: האם תהליך מנצח?</h1>'), '<h1>NEXUS: האם תהליך מנצח?</h1>');
  // A Hebrew sentence that has a colon is not touched.
  assert.equal(isolateLtrRuns('<p>בקצרה: Redis טוב יותר.</p>'), '<p>בקצרה: Redis טוב יותר.</p>');
});

test('rtl: a wrapped svg label line with no Hebrew is isolated left to right, a mixed line keeps the page direction', () => {
  assert.equal(svgLine('lint:', 'rtl'), `${LRI}lint:${PDI}`);
  assert.equal(svgLine('src/', 'rtl'), `${LRI}src/${PDI}`);
  assert.equal(svgLine('lint: בדיקת כתיבה', 'rtl'), 'lint: בדיקת כתיבה');
  assert.equal(svgLine('3 שלבים', 'rtl'), '3 שלבים');
  assert.equal(svgLine('src/', 'ltr'), 'src/');
  // A wrapped node label: the line that opens with the English term and goes on in Hebrew is drawn without marks.
  const svg = flow('(lint: בדיקת כתיבה לפני כל merge ו-push לענף הראשי) -> B', 'TB', 'rtl');
  assert.ok(svg.includes('>lint: בדיקת כתיבה לפני<'), 'the mixed line keeps the page direction');
  assert.ok(svg.includes(`${LRI}B${PDI}`), 'an English-only node is isolated');
  // A left-to-right page draws the same text with no marks.
  assert.ok(!flow('(lint: check) -> src/', 'TB', 'ltr').includes(LRI));
  assert.ok(sequence('A -> B: src/', 'rtl').includes(`${LRI}src/${PDI}`));
});

test('rtl: a kv value made of a domain with a leading number is not split by the page direction', () => {
  const html = hebrewPage(`## A הגדרות
\`\`\`kv
Client ID: 1234-abcd.apps.example.com
תוקף: שעה אחת
\`\`\`
`);
  assert.match(html, /<dd><bdi dir="ltr">1234-abcd\.apps\.example\.com<\/bdi><\/dd>/);
  assert.match(html, /<dd>שעה אחת<\/dd>/);
});

test('rtl: the meta row under the title uses Hebrew key names and keeps each value apart from its key', () => {
  const html = hebrewPage('## A x\nטקסט\n', 'author: נתנאל\ndate: 7.10.2026\nsource: RFC 9293\ncustom: ערך\n');
  assert.match(html, /<span><b>מאת<\/b><bdi dir="rtl">נתנאל<\/bdi><\/span>/);
  assert.match(html, /<span><b>תאריך<\/b><bdi>7\.10\.2026<\/bdi><\/span>/);
  assert.match(html, /<span><b>מקור<\/b><bdi>RFC 9293<\/bdi><\/span>/);
  assert.match(html, /<span><b>custom<\/b><bdi dir="rtl">ערך<\/bdi><\/span>/);
  // An English page shows the keys as written, in the markup it always had.
  const en = renderDoc('---\nlang: en\nauthor: Ann\n---\n## A x\ny\n').html;
  assert.match(en, /<span><b>author<\/b>Ann<\/span>/);
});

test('rtl: the footer is in Hebrew with the date written day.month.year and an isolated English star link', () => {
  const html = hebrewPage('## A x\nטקסט\n');
  assert.match(html, /<footer class="am-colophon">נוצר באמצעות <bdi><a href="https:\/\/github\.com\/QingYunA\/answer-me-with-html" target="_blank" rel="noopener">Answer me with HTML<\/a> \d+\.\d+\.\d+<\/bdi> · <bdi>\d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}<\/bdi> · <bdi><a href="https:\/\/github\.com\/QingYunA\/answer-me-with-html" target="_blank" rel="noopener">★ Star on GitHub<\/a><\/bdi><\/footer>/);
  assert.doesNotMatch(html, /Generated by/);
  assert.match(RTL_CSS, /\.am-colophon/);
});

test('rtl: the limits value is written in Hebrew and reads right to left; English keeps "/ max"', () => {
  const html = hebrewPage(`## A זיכרון
\`\`\`limits
זיכרון Redis | 1.4 / 2 | GB | 70% מהמכסה
חיבורים | max 1000 | חיבורים
\`\`\`
`);
  assert.match(html, /<span class="am-lim-val">1\.4 מתוך 2 GB<\/span>/);
  assert.match(html, /<span class="am-lim-val">עד 1000 חיבורים<\/span>/);
  assert.match(RTL_CSS, /\.am-lim-note[^{]*\{ unicode-bidi: isolate; \}/);
  assert.doesNotMatch(RTL_CSS, /\.am-lim-val \{ direction: ltr/);
  const en = COMPONENTS.get('limits').render('Size | 4 / 10 | KB\nCap | max 5 | MB', { args: '', dir: 'ltr' });
  assert.match(en, /<span class="am-lim-val">4 \/ max 10 KB<\/span>/);
  assert.match(en, /<span class="am-lim-val">max 5 MB<\/span>/);
});

test('rtl: a signed number keeps its sign on the left, and a Hebrew prefix stays with the word after its hyphen', () => {
  assert.equal(isolateLtrRuns('<span>−1 הוסר</span>'), '<span><bdi dir="ltr">−1</bdi> הוסר</span>');
  assert.equal(isolateLtrRuns('<p>ירידה של -5% בעומס</p>'), '<p>ירידה של <bdi dir="ltr">-5%</bdi> בעומס</p>');
  // A range and a date are not signed numbers.
  assert.equal(isolateLtrRuns('<p>בין 10-20 ב-7.10.2026</p>'), `<p>בין 10-20 ב-${WJ}7.10.2026</p>`);
  assert.equal(isolateLtrRuns('<p>העלאה ל-staging</p>'), `<p>העלאה ל-${WJ}staging</p>`);
});

test('rtl: drawings, code and plain words are left as they are', () => {
  const html = '<svg><text>src/</text></svg><pre><code>a/b: c</code></pre><td>Redis</td><span>A</span>';
  assert.equal(isolateLtrRuns(html), html);
  // A whole run of inline code and text with no Hebrew is one piece.
  assert.equal(isolateLtrRuns('<li><code>redis.ts</code> / retry</li>'), '<li><bdi dir="ltr"><code>redis.ts</code> / retry</bdi></li>');
});

test('rtl: a horizontal timeline shrinks a long date to fit its column instead of running into the next one', () => {
  // cqi is the width of the timeline's container (.am-tl-wrap in base.css); rtl.css declares none of its own.
  assert.doesNotMatch(RTL_CSS, /container-type/);
  assert.match(RTL_CSS, /\.am-tl-when \{ font-size: min\(15px, calc\(100cqi \/ var\(--n, 1\) \/ 6\.2\)\)/);
});

test('rtl: left-to-right pages get no bdi isolates and keep the English footer', () => {
  const { html } = renderDoc('---\nlang: en\n---\n## A Tree\n```tree list\nsrc/\n  lint: check\n```\n');
  assert.doesNotMatch(html, /<bdi/);
  assert.match(html, /<footer class="am-colophon">Generated by <a /);
});

test('rtl: a meta value that opens with an English word but holds Hebrew reads right to left', () => {
  const html = hebrewPage('## A x\nטקסט\n', 'ref: d8df1b0 (4 קומיטים מעל main)\n');
  assert.match(html, /<span><b>הפניה<\/b><bdi dir="rtl">d8df1b0 \(4 קומיטים מעל main\)<\/bdi><\/span>/);
});

test('rtl: a frontmatter key written in Hebrew (or with spaces) is accepted and shown as written', () => {
  const html = hebrewPage('## A x\nטקסט\n', 'עודכן: 25.9.2026\nתאריך עדכון: 28.9.2026\n');
  assert.match(html, /<span><b>עודכן<\/b><bdi>25\.9\.2026<\/bdi><\/span>/);
  assert.match(html, /<span><b>תאריך עדכון<\/b><bdi>28\.9\.2026<\/bdi><\/span>/);
  assert.match(renderDoc('---\nlang: zh\n作者: 张三\n---\n## A x\n内容\n').html, /<b>作者<\/b>张三/);
});

test('rtl: the change count row agrees with the number in Hebrew and keeps every sign on the left', () => {
  const html = hebrewPage(`## A קבצים
\`\`\`tree list
src/
  + a.js
  + b.js
  ~ c.js
  - d.js
\`\`\`
`);
  assert.match(html, /<bdi dir="ltr">\+2<\/bdi> נוספו/);
  assert.match(html, /<bdi dir="ltr">~1<\/bdi> שונה</);
  assert.match(html, /<bdi dir="ltr">−1<\/bdi> הוסר</);
  assert.equal(isolateLtrRuns('<span>~11 שונו</span>'), '<span><bdi dir="ltr">~11</bdi> שונו</span>');
  // English counts keep one word for any number.
  const en = renderDoc('---\nlang: en\n---\n## A T\n```tree list\nsrc/\n  + a.js\n  + b.js\n```\n').html;
  assert.match(en, />\+2 added</);
});

// The Reply sheet on a right-to-left page shows the reply drawn, each line in its own direction; Copy still copies the Markdown.
test('rtl: the reply view draws each line of the reply in its own direction, without the Markdown markup', async () => {
  const { replyViewHtml } = await import('../src/runtime/reply-view.js');
  const ui = { decisions: 'החלטות', comments: 'הערות', confirmed: 'אושר', untouched: 'לא נענה', was: 'היה', typed: 'שורות שמתחילות ב-">" הוקלדו.' };
  const text = replyText({
    title: 'סקירת הענף hebrew-rtl',
    decisions: [{ panel: 'E', question: 'איזה מטמון?', picked: ['Redis'], suggested: ['Memcached'], touched: true }],
    comments: [{ panel: 'A', title: 'מה השתנה', text: 'נראה טוב\nAlso check **bold** <b>' }],
    ui,
    rtl: true,
  });
  const html = replyViewHtml(text);
  const rows = [...html.matchAll(/<div class="([^"]*)"(?: dir="(\w+)")?>(.*?)<\/div>/g)].map(([, cls, dir, inner]) => ({ cls, dir, inner }));
  const row = (cls) => rows.find((r) => r.cls === cls);
  assert.equal(row('am-rv-h1').dir, 'rtl');
  assert.match(row('am-rv-h1').inner, /^Re: סקירת הענף hebrew-rtl$/);
  // "1. [E] question": the number and the panel letter are isolated, so they stay at the start of the right-to-left line.
  assert.equal(row('am-rv-q').dir, 'rtl');
  assert.match(row('am-rv-q').inner, /^<bdi>1\.<\/bdi> <bdi class="am-rv-tag">E<\/bdi> איזה מטמון\?$/);
  // A Latin answer is isolated left to right inside the right-to-left line; the note is right to left.
  assert.match(row('am-rv-a').inner, /^← <strong><bdi dir="ltr">Redis<\/bdi><\/strong> <em><bdi dir="rtl">\(היה: Memcached\)<\/bdi><\/em>$/);
  // "A · title" reads right to left, so the panel letter comes first for a Hebrew reader.
  assert.match(row('am-rv-c').inner, /<bdi dir="rtl">A · מה השתנה<\/bdi>/);
  // Comment lines are shown as typed (escaped, no bold), each in its own direction.
  const quotes = rows.filter((r) => r.cls === 'am-rv-quote');
  assert.deepEqual(quotes.map((q) => q.dir), ['rtl', 'ltr']);
  assert.equal(quotes[1].inner, 'Also check **bold** &lt;b&gt;');
  // No line keeps the Markdown markers the textarea showed.
  for (const r of rows.filter((x) => x.cls !== 'am-rv-quote')) assert.doesNotMatch(r.inner.replace(/<[^>]+>/g, ''), /\*\*|^#|^\d+\. \[|^- /);
});

test('rtl: only a right-to-left page carries the reply view, and the copied reply text is unchanged', () => {
  const he = renderDoc(draft('he', FLOW)).html;
  const en = renderDoc(draft('en', '## A Flow\n```flow LR\nDraft -> am\n```\n')).html;
  assert.match(he, /am-reply-view/);
  assert.doesNotMatch(en, /am-reply-view|replyViewHtml/);
  // The view is drawn from the textarea, which still holds replyText's Markdown: Copy copies the textarea.
  assert.match(he, /navigator\.clipboard\.writeText\(text\.value\)/);
  assert.match(RTL_CSS, /\.am-reply--view textarea/);
});

// A `>` or `<` inside a quoted attribute value belongs to the tag: no isolate is ever written inside an attribute.
test('rtl: isolateLtrRuns reads quoted attribute values as part of the tag', () => {
  assert.equal(isolateLtrRuns('<span title="a > b">src/app.js</span>'), '<span title="a > b"><bdi dir="ltr">src/app.js</bdi></span>');
  assert.equal(isolateLtrRuns("<span title='a > b'>src/app.js</span>"), `<span title='a > b'><bdi dir="ltr">src/app.js</bdi></span>`);
  assert.equal(isolateLtrRuns('<span title="a < b">src/app.js</span>'), '<span title="a < b"><bdi dir="ltr">src/app.js</bdi></span>');
  // A quote of the other kind inside a value, and values on tags around Hebrew text: the html stays as it was.
  const hebrew = `<p data-x="it's > 1"><span title='say "a > b"'>שלום</span></p>`;
  assert.equal(isolateLtrRuns(hebrew), hebrew);
});

// The reply view (src/runtime/reply-view.js) and the page builder (src/bidi.js) share one RTL_LETTER (src/runtime/rtl-letter.js).
test('rtl: the reply view and bidi.js use the one RTL_LETTER definition, and the page script carries it without an import', () => {
  const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  for (const file of ['bidi.js', 'runtime/reply-view.js']) {
    assert.doesNotMatch(src(file), /RTL_LETTER\s*=/, `${file} defines its own RTL_LETTER`);
    assert.match(src(file), /import \{ RTL_LETTER \} from '\.\/(runtime\/)?rtl-letter\.js';/);
  }
  // The definition is written with property escapes only: no literal right-to-left or invisible characters.
  assert.doesNotMatch(src('runtime/rtl-letter.js'), /[^\x00-\x7F]/);
  // The page script holds the definition once, has no import, and compiles.
  assert.equal(RTL_JS.split(RTL_LETTER.source).length, 2);
  assert.doesNotMatch(RTL_JS, /^\s*(import|export)\b/m);
  assert.doesNotThrow(() => new Function(RTL_JS));
  // Hebrew and Arabic letters count; a byte order mark, Latin letters and digits do not.
  assert.ok(RTL_LETTER.test('א') && RTL_LETTER.test('ا'));
  assert.ok(!RTL_LETTER.test('﻿') && !RTL_LETTER.test('a1'));
});

// A path or flag inside a Hebrew sentence: the run has Hebrew, so it is not isolated whole, and the slash, dot or dash at the edge of
// the Latin word took the sentence direction (`src/` showed as `/src`). Such a word is isolated by itself.
test('rtl: a Latin word that starts or ends with punctuation is isolated inside a Hebrew sentence', () => {
  const bdi = (s) => `<bdi dir="ltr">${s}</bdi>`;
  const p = (s) => isolateLtrRuns(`<p>${s}</p>`);
  assert.equal(p('ערכו את src/ ידנית'), `<p>ערכו את ${bdi('src/')} ידנית</p>`);
  assert.equal(p('הריצו את /usr/bin עכשיו'), `<p>הריצו את ${bdi('/usr/bin')} עכשיו</p>`);
  assert.equal(p('הריצו ./run.sh ואז --force וגם ~/.config'), `<p>הריצו ${bdi('./run.sh')} ואז ${bdi('--force')} וגם ${bdi('~/.config')}</p>`);
  assert.equal(p('ראו https://example.com/docs/ לפרטים'), `<p>ראו ${bdi('https://example.com/docs/')} לפרטים</p>`);
  assert.equal(p('התיקייה C:\\tmp\\ ריקה'), `<p>התיקייה ${bdi('C:\\tmp\\')} ריקה</p>`);
  assert.equal(p('נתיבים כמו #tag או $HOME או C++ שימושיים'), `<p>נתיבים כמו ${bdi('#tag')} או ${bdi('$HOME')} או ${bdi('C++')} שימושיים</p>`);
  assert.equal(p('הגודל הוא -5px בלבד'), `<p>הגודל הוא ${bdi('-5px')} בלבד</p>`);
});

test('rtl: sentence punctuation and a Hebrew prefix stay outside the isolate of a Latin word', () => {
  const bdi = (s) => `<bdi dir="ltr">${s}</bdi>`;
  const p = (s) => isolateLtrRuns(`<p>${s}</p>`);
  // The full stop belongs to the sentence; docs/a.md has punctuation only between letters and needs no isolate.
  assert.equal(p('ערכו את src/ ואת docs/a.md.'), `<p>ערכו את ${bdi('src/')} ואת docs/a.md.</p>`);
  assert.equal(p('עדכנו את ./run.sh.'), `<p>עדכנו את ${bdi('./run.sh')}.</p>`);
  assert.equal(p('מה בתיקייה src/? ו-/usr/bin; וגם src/, ואז src/:'), `<p>מה בתיקייה ${bdi('src/')}? ו-${WJ}${bdi('/usr/bin')}; וגם ${bdi('src/')}, ואז ${bdi('src/')}:</p>`);
  assert.equal(p('התיקייה (src/) ו (./a.sh) ריקות'), `<p>התיקייה (${bdi('src/')}) ו (${bdi('./a.sh')}) ריקות</p>`);
  assert.equal(p('הדגל &quot;--force&quot; וגם "--dry-run" ו-&#39;src/&#39;'), `<p>הדגל &quot;${bdi('--force')}&quot; וגם "${bdi('--dry-run')}" ו-${WJ}&#39;${bdi('src/')}&#39;</p>`);
  assert.equal(p('מה זה src/؟ כן، src/،'), `<p>מה זה ${bdi('src/')}؟ כן، ${bdi('src/')}،</p>`);
  // A Hebrew prefix joined with a hyphen or a maqaf stays with the word, outside the isolate.
  assert.equal(p('ב-src/ ובמקף ב־src/ בלבד'), `<p>ב-${WJ}${bdi('src/')} ובמקף ב־${bdi('src/')} בלבד</p>`);
  // An entity at the end of a word is not cut at its semicolon.
  assert.equal(p('ראו src/a&amp; כאן'), `<p>ראו ${bdi('src/a&amp;')} כאן</p>`);
});

test('rtl: Latin words with no punctuation at the edge, numbers and Hebrew words are left as they are', () => {
  const same = (s) => assert.equal(isolateLtrRuns(`<p>${s}</p>`), `<p>${s}</p>`, s);
  same('ערכו את src/cli.js ואת api.example.com ידנית.');
  same('העלאה לשרת staging, ושם Redis וגם Node.js טובים.');
  same('היא כתבה "Redis" וגם e.g. וגם etc. לפעמים');
  same('בין 1/2 לבין 3/4 וגם ... או -- בלבד');
  same('אמרה: שלום/להתראות או עברית/ערבית');
});

test('rtl: the word rule does not wrap what is already isolated, and skips code, attributes, svg and pre', () => {
  // A signed number is isolated by its own rule; a word with a unit gets one isolate, not two.
  assert.equal(isolateLtrRuns('<p>ירידה של -5% וגם -5px בעומס</p>'), '<p>ירידה של <bdi dir="ltr">-5%</bdi> וגם <bdi dir="ltr">-5px</bdi> בעומס</p>');
  // A run with no Hebrew is isolated whole, once.
  assert.equal(isolateLtrRuns('<p>see src/ and ./run.sh</p>'), '<p><bdi dir="ltr">see src/ and ./run.sh</bdi></p>');
  // Inline code is isolated by the style sheet; its text is not touched.
  assert.equal(isolateLtrRuns('<p>ערכו את <code>src/</code> ואת <code>--force x/</code> ידנית</p>'), '<p>ערכו את <code>src/</code> ואת <code>--force x/</code> ידנית</p>');
  // Attribute values, svg and pre.
  const html = '<p title="src/ --force" data-p="/usr/bin">שלום</p><svg><text>שלום src/</text></svg><pre>שלום src/</pre>';
  assert.equal(isolateLtrRuns(html), html);
  // A word inside inline tags is isolated inside them.
  assert.equal(isolateLtrRuns('<p>ערכו <strong>src/</strong> ו <a href="/a/b/">/usr/bin</a> ידנית</p>'), '<p>ערכו <strong><bdi dir="ltr">src/</bdi></strong> ו <a href="/a/b/"><bdi dir="ltr">/usr/bin</bdi></a> ידנית</p>');
});

test('rtl: a path in a Hebrew paragraph is isolated on the page, and a left-to-right page gets no isolate', () => {
  const he = hebrewPage('## A שלבים\nערכו את src/ ידנית ואת `src/` ואת docs/a.md.\n');
  assert.match(he, /<p>ערכו את <bdi dir="ltr">src\/<\/bdi> ידנית ואת <code>src\/<\/code> ואת docs\/a\.md\.<\/p>/);
  const en = renderDoc('---\nlang: en\n---\n## A Steps\nEdit src/ by hand and /usr/bin and --force.\n').html;
  assert.doesNotMatch(en, /<bdi/);
});

// ── annot on a right-to-left page ──
const annot = (text, dir) => COMPONENTS.get('annot').render(text, { args: '', uid: () => 'u1', ui: {}, dir });
const rowsOf = (html) => [...html.matchAll(/class="am-seg-n" style="--row: (\d+)"/g)].map((m) => Number(m[1]));

test('rtl: an annot sentence is set in the sans font, because no monospace font has Hebrew letters', () => {
  const rule = RTL_CSS.match(/html\[dir="rtl"\] \.am-annot-line \{([^}]*)\}/);
  assert.ok(rule, 'a rule for the annot sentence');
  assert.match(rule[1], /font-family: var\(--font-sans\)/);
  assert.match(RTL_CSS, /html\[dir="rtl"\] [^{]*\.am-annot-meta/);
});

test('rtl: annot notes are placed with the widths of the sans font, as the sentence is drawn in it', () => {
  // The first note is 118 px wide with its gap. The second span starts after 96 px of Hebrew in the sans font, but after 126 px
  // if the sentence were monospace (a space is half as wide in the sans font), so only the sans estimate puts it on a second row.
  const text = '[אבגד]{הערה ארוכה למדי כאן} ו ו ו ו ו [חזרה]{הערה}';
  assert.deepEqual(rowsOf(annot(text, 'ltr')), [0, 0]);
  assert.deepEqual(rowsOf(annot(text, 'rtl')), [0, 1]);
});

test('rtl: an annot block on a Hebrew page keeps Latin terms, paths and notes in order', () => {
  const html = hebrewPage(`## A משפט
\`\`\`annot
# משפט 1 | 13 מילים
ערכו את [src/]{נתיב}, ואת [Redis]{שם המוצר} ואת [המטמון]{!לא "מטמון"} ידנית ב-/usr/bin.
> כתבו הוראה אחת בכל משפט
\`\`\`
`);
  assert.match(html, /<span class="am-seg"><span class="am-seg-t"><bdi dir="ltr">src\/<\/bdi><\/span><span class="am-seg-n" style="--row: 0">נתיב<\/span><\/span>/);
  assert.match(html, /<span class="am-seg-t">Redis<\/span>/);
  assert.match(html, /ב-⁠<bdi dir="ltr">\/usr\/bin<\/bdi>\.<\/div>/);
  assert.match(html, /am-annot-head"><span>משפט 1<\/span><span class="am-annot-meta">13 מילים<\/span>/);
});

test('rtl: annot on a left-to-right page is drawn as before', () => {
  const text = '# Head | meta\nMake sure [the hydraulic reservoir]{Technical name} is [full]{!Not "replenished"}.\n> Caption';
  assert.equal(annot(text, 'ltr'), annot(text));
  assert.equal(annot(text, 'ltr'), annot(text, undefined));
  assert.doesNotMatch(renderDoc(`---\nlang: en\n---\n## A S\n\`\`\`annot\n${text}\n\`\`\`\n`).html, /am-seg-n[^>]*>[^<]*<bdi/);
});

// ── Video pages: the player and its scenes lay out right to left like a page (#158) ──
const HE_VIDEO = (theme) => `---\nlang: he\n${theme ? `theme: ${theme}\n` : ''}---\n## א זרימה\n\`\`\`flow LR\nלקוח -> שרת: SYN\n\`\`\`\n> [לקוח] שולח בקשה.\n`;
const EN_VIDEO = (theme) => HE_VIDEO(theme).replace('lang: he', 'lang: en').replace('לקוח -> שרת', 'Client -> Server').replace(/> .*\n$/, '> The [Client] sends a request.\n');

test('rtl video: a Hebrew video page writes dir="rtl" on the root, a left-to-right one does not', async () => {
  const he = await renderVideo(HE_VIDEO());
  assert.equal(he.language.dir, 'rtl');
  assert.match(he.html, /<html lang="he" dir="rtl" data-theme="[^"]+" data-mode="[^"]+" data-style="[^"]+" data-video>/);
  for (const lang of ['en', 'zh', 'ja']) {
    const { html } = await renderVideo(`---\nlang: ${lang}\n---\n## A x\n- y\n> z\n`);
    assert.doesNotMatch(html, /<html[^>]* dir=/, lang);
  }
});

test('rtl video: the scenes get the page direction, so a flow reads from the right', async () => {
  const centres = async (src) => nodeCentres((await renderVideo(src)).html);
  const he = await centres(HE_VIDEO());
  const en = await centres(EN_VIDEO());
  assert.ok(he['לקוח'] > he['שרת'], 'the first node is on the right in Hebrew');
  assert.ok(en.Client < en.Server, 'the first node stays on the left in English');
  assert.match((await renderVideo(HE_VIDEO())).html, /<svg [^>]*direction="rtl"/);
  assert.doesNotMatch((await renderVideo(EN_VIDEO())).html, /<svg [^>]*direction=/);
});

test('rtl video: the right-to-left styles come only with a right-to-left video, and the player script is the same', async () => {
  const he = (await renderVideo(HE_VIDEO())).html;
  assert.ok(he.includes(RTL_CSS));
  assert.ok(!(await renderVideo(EN_VIDEO())).html.includes(RTL_CSS));
  assert.ok(he.includes(VIDEO_JS), 'one player script for both directions');
});

test('rtl video: the title block mirrors, and the whole controls row stays left to right', () => {
  const block = RTL_CSS.slice(RTL_CSS.indexOf('/* Video player'));
  assert.match(block, /html\[dir="rtl"\]\[data-video\] \.amv-titleblock div \+ div \{ border-left: 0; border-right: 1px solid var\(--line\); \}/);
  assert.match(block, /html\[dir="rtl"\]\[data-video\] \.amv-controls \{ direction: ltr; \}/);
  assert.doesNotMatch(block, /\.amv-(track|time|rate)/, 'nothing inside the row needs a rule of its own');
});

test('rtl video: a theme mirrors what its own video css places, on a right-to-left video only', async () => {
  const rule = { '3b1b': '.amv-scene-head { left: 72px; right: 96px; }', shadcn: '.amv-scene-n { margin: 12px 14px 12px 0; }' };
  for (const [theme, css] of Object.entries(rule)) {
    const sel = `html[data-video][data-theme="${theme}"] ${css}`;
    assert.ok((await renderVideo(HE_VIDEO(theme))).html.includes(sel), theme);
    assert.ok(!(await renderVideo(EN_VIDEO(theme))).html.includes(sel), theme);
  }
});
