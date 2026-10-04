import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseVideo, estimateSeconds, buildTimeline, allBeats, TIMING } from '../src/video/script.js';
import { renderVideo, captionHtml, formatClock } from '../src/video/render.js';
import { readWav, wav, mixTrack, trimSilence, synthAll, pickProvider, pickMacVoices, TtsError, SAMPLE_RATE } from '../src/video/tts.js';
import { findChrome } from '../src/video/export.js';
import { renderDoc } from '../src/render.js';
import { ParseError } from '../src/parse.js';
import { COMPONENTS } from '../src/components/index.js';
import { main } from '../src/cli.js';

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'am-video-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

const SRC = `---
title: 握手
---
> 片头旁白。

## 第一幕
\`\`\`sequence
A -> B: SYN
B -> A: ACK
\`\`\`
> A 先发 SYN。
> [B] 回 ACK。

## 第二幕
- 要点一
> 只有一句。
`;

// 假配音：每个字 0.1 秒的正弦波，记录调用次数。
function fakeProvider() {
  const calls = [];
  return {
    calls,
    name: 'fake',
    id: 'fake',
    concurrency: 2,
    async synth(text) {
      calls.push(text);
      const n = Math.round([...text].length * 0.1 * SAMPLE_RATE);
      return Int16Array.from({ length: n }, (_, i) => Math.round(8000 * Math.sin(i / 8)));
    },
  };
}

// ── 稿件解析 ──
test('parseVideo: 场景、旁白拍、聚焦、片头旁白', () => {
  const v = parseVideo(SRC);
  assert.equal(v.meta.title, '握手');
  assert.deepEqual(v.introBeats.map((b) => b.text), ['片头旁白。']);
  assert.equal(v.scenes.length, 2);
  assert.deepEqual(v.scenes[0].beats.map((b) => b.text), ['A 先发 SYN。', 'B 回 ACK。']);
  assert.equal(v.scenes[0].beats[1].focus, 'B');
  assert.equal(v.scenes[0].blocks[0].lang, 'sequence');
  assert.equal(v.scenes[1].blocks[0].type, 'md', '非旁白的 Markdown 留作画面');
  assert.equal(allBeats(v).length, 4);
});

test('parseVideo: 场景没有旁白或稿件没有场景时报错', () => {
  assert.throws(() => parseVideo('## 空场景\n- 只有画面\n'), (e) => e instanceof ParseError && /没有旁白/.test(e.message));
  assert.throws(() => parseVideo('> 只有旁白\n'), (e) => e instanceof ParseError && /至少需要一个场景/.test(e.message));
});

test('estimateSeconds: 中文按字、英文按词估算，且有下限', () => {
  assert.ok(Math.abs(estimateSeconds('一二三四五六七八九十一二三四五六七八九十一') - (21 / 4.2 + 0.3)) < 1e-9);
  assert.ok(estimateSeconds('one two three four five six seven eight nine ten') > 3.5);
  assert.equal(estimateSeconds('好'), 1.6);
});

test('buildTimeline: 片头 → 场景切换 → 旁白依次排开，时间单调递增', () => {
  const v = parseVideo(SRC);
  const tl = buildTimeline(v, [2, 1, 1, 1]);
  assert.equal(tl.title.beats[0].start, 0);
  assert.equal(tl.scenes[0].start, tl.title.end);
  assert.equal(tl.scenes[0].beats[0].start, tl.scenes[0].start + TIMING.transition);
  assert.equal(tl.scenes[0].beats[1].start, tl.scenes[0].beats[0].end + TIMING.gap);
  assert.equal(tl.scenes[1].start, tl.scenes[0].end);
  assert.equal(tl.duration, tl.scenes[1].end + TIMING.outro);
  const noIntro = buildTimeline({ ...v, introBeats: [] }, [1, 1, 1]);
  assert.equal(noIntro.scenes[0].start, TIMING.title, '没有片头旁白时停留固定时长');
});

test('formatClock: 四舍五入后进位到下一分钟，不出现 0:60', () => {
  assert.equal(formatClock(59.6), '1:00');
  assert.equal(formatClock(59.4), '0:59');
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(90), '1:30');
});

test('captionHtml: 转义 HTML，[名字] 变成高亮词', () => {
  assert.equal(captionHtml('[Server] 回 <ACK>'), '<b>Server</b> 回 &lt;ACK&gt;');
});

// ── 配音 ──
test('wav / readWav 往返；mixTrack 按开始时间放置', () => {
  const samples = Int16Array.from([0, 1000, -1000, 32767]);
  assert.deepEqual([...readWav(wav(samples))], [...samples]);
  const track = readWav(mixTrack([Int16Array.from([5, 6])], [1], 2));
  assert.equal(track.length, 2 * SAMPLE_RATE);
  assert.equal(track[SAMPLE_RATE], 5);
  assert.equal(track[SAMPLE_RATE - 1], 0);
});

test('trimSilence: 去掉首尾静音并保留 40ms 余量', () => {
  const pad = Math.floor(SAMPLE_RATE * 0.04);
  const s = new Int16Array(SAMPLE_RATE);
  s.fill(5000, 10000, 11000);
  const out = trimSilence(s);
  assert.equal(out.length, 1000 + pad * 2);
});

test('synthAll: 并发合成并缓存，第二次不再调用 TTS', async () => {
  const p = fakeProvider();
  const cacheDir = join(dir, 'cache');
  const a = await synthAll(['一句', '两句话'], p, { cacheDir });
  assert.equal(p.calls.length, 2);
  const b = await synthAll(['一句', '两句话'], p, { cacheDir });
  assert.equal(p.calls.length, 2, '命中缓存');
  assert.deepEqual([...b[1]], [...a[1]]);
});

test('pickProvider: off / elevenlabs / system / auto 的选择与报错', () => {
  assert.equal(pickProvider('off', {}), null);
  assert.throws(() => pickProvider('elevenlabs', {}), TtsError);
  assert.equal(pickProvider('auto', { ELEVENLABS_API_KEY: 'k' }).name, 'elevenlabs');
  assert.throws(() => pickProvider('system', {}, { platform: 'linux', which: () => false }), TtsError);
  assert.equal(pickProvider('auto', {}, { platform: 'linux', which: () => false }), null, '都没有时只出字幕');
  assert.equal(pickProvider('auto', {}, { platform: 'linux', which: (c) => c === 'espeak-ng' }).name, 'espeak-ng');
});

test('pickMacVoices: 名字很长只隔一个空格时也能认出，优先婷婷 / Samantha', () => {
  const out = [
    'Reed (中文（中国大陆）)     zh_CN    # 你好！我叫Reed。',
    'Tingting (中文（中国大陆）) zh_CN    # 你好！我叫婷婷。',
    'Albert              en_US    # Hello! My name is Albert.',
    'Samantha (英语（美国）)   en_US    # Hello! My name is Samantha.',
  ].join('\n');
  assert.deepEqual(pickMacVoices(out), { zh: 'Tingting (中文（中国大陆）)', en: 'Samantha (英语（美国）)', ja: undefined });
  assert.deepEqual(pickMacVoices('Reed (中文（中国大陆）)  zh_CN  # x'), { zh: 'Reed (中文（中国大陆）)', en: undefined, ja: undefined });
});

test('pickMacVoices: 日文优先 Kyoko', () => {
  const out = [
    'Eddy (日本語（日本）)      ja_JP    # こんにちは! 私の名前はEddyです。',
    'Kyoko               ja_JP    # こんにちは! 私の名前はKyokoです。',
  ].join('\n');
  assert.equal(pickMacVoices(out).ja, 'Kyoko');
  assert.equal(pickMacVoices(out.split('\n')[0]).ja, 'Eddy (日本語（日本）)');
});

// ── 渲染 ──
test('renderVideo: 片头时长进位到 1:00，不写成 0:60', async () => {
  const samples = new Int16Array(Math.round(54 * SAMPLE_RATE));
  samples.fill(1000);
  const r = await renderVideo(`---\ntitle: Dur\n---\n## S\n\`\`\`flow\nA -> B\n\`\`\`\n> beat\n`, {
    provider: { name: 'fake', id: 'fake', concurrency: 1, synth: async () => samples },
  });
  assert.ok(Math.abs(r.duration - 59.6) < 0.05, r.duration);
  assert.match(r.html, /DURATION<\/b><span>1:00<\/span>/);
});

test('renderVideo: 无配音时按估算时长出播放页，场景与数据齐全', async () => {
  const r = await renderVideo(SRC);
  assert.equal(r.wav, null);
  assert.equal(r.beats, 4);
  assert.equal((r.html.match(/<section class="amv-scene/g) || []).length, 3, '片头 + 两个场景');
  const data = JSON.parse(r.html.match(/id="amv-data">(.*?)<\/script>/)[1]);
  assert.equal(data.segments.length, 3);
  assert.equal(data.segments[1].beats[1].html, '<b>B</b> 回 ACK。');
  assert.equal(data.duration, r.duration);
  assert.doesNotMatch(r.html, /<audio/);
  assert.match(r.html, /window\.render = render/);
});

test('renderVideo: 有配音时时长来自音频，并内嵌 WAV', async () => {
  const p = fakeProvider();
  const r = await renderVideo(SRC, { provider: p });
  assert.equal(p.calls.length, 4);
  assert.match(r.html, /<audio id="amv-audio" preload="auto" src="data:audio\/wav;base64,/);
  const data = JSON.parse(r.html.match(/id="amv-data">(.*?)<\/script>/)[1]);
  const first = data.segments[0].beats[0];
  assert.ok(Math.abs(first.end - first.start - [...'片头旁白。'].length * 0.1) < 0.01);
  assert.equal(readWav(r.wav).length, Math.ceil(r.duration * SAMPLE_RATE));
});

test('renderVideo: 多行旁白不算超长段落；strict 下其他问题照常拦截', async () => {
  const many = `## 场景\n- 画面\n${Array.from({ length: 8 }, (_, i) => `> 第 ${i + 1} 句。`).join('\n')}\n`;
  const r = await renderVideo(many);
  assert.equal(r.warnings.filter((w) => w.rule === 'paragraph-length').length, 0);
  await assert.rejects(renderVideo(`---\nstyle: strict\n---\n## 场景\n> 我们对系统进行优化。\n`), /STE/);
});

test('视频主题：默认 blueprint 浅色；稿件可写 3b1b；命令行参数优先', async () => {
  const def = await renderVideo(SRC);
  assert.match(def.html, /data-theme="blueprint" data-mode="light" data-video/);
  assert.match(def.html, /class="amv-sheet"/, '图纸外框');
  assert.match(def.html, /SHEET 01 \/ 02/);
  const dark = await renderVideo(`---\ntheme: 3b1b\n---\n${SRC.split('---\n').slice(2).join('---\n')}`);
  assert.match(dark.html, /data-theme="3b1b" data-mode="dark"/);
  const cli = await renderVideo(SRC, { overrides: { theme: 'shadcn', mode: 'dark' } });
  assert.match(cli.html, /data-theme="shadcn" data-mode="dark"/);
  await assert.rejects(renderVideo(SRC, { overrides: { theme: 'neon' } }), /theme 的值 "neon" 无效/);
  assert.throws(() => renderDoc('---\ntheme: 3b1b\n---\n## A\n文字\n'), ParseError, '页面不支持 3b1b');
});

test('视频字体：日文 3b1b 标题用日文衬线体，其他主题的标题不被覆盖', async () => {
  const JA = '## 概要\n> 接続は3回のやりとりで行う。\n';
  const dark = await renderVideo(`---\ntheme: 3b1b\n---\n${JA}`);
  const rule = dark.html.match(/html\[lang="ja"\]\[data-theme="3b1b"\]\[data-mode\] \{[^}]*\}/)?.[0];
  assert.ok(rule, '3b1b 有日文标题字体规则');
  assert.ok(rule.indexOf('"Hiragino Mincho ProN"') < rule.indexOf('"Songti SC"'));
  assert.doesNotMatch(rule, /--font-sans/, '衬线规则只管标题');
  const generic = dark.html.match(/html\[lang="ja"\]\[data-theme\]\[data-mode\] \{[^}]*\}/)?.[0];
  assert.ok(generic, '有通用日文字体规则');
  assert.doesNotMatch(generic, /--v-title-font/, '通用规则不改标题字体');
});

test('renderDoc: template video 提示改用 am video', () => {
  assert.throws(() => renderDoc('---\ntemplate: video\n---\n## A\n文字\n'), (e) => e instanceof ParseError && /am video/.test(e.message));
});

// ── 组件的分步标记 ──
test('组件分步标记：flow 按源码行、sequence 按消息、tree 按节点', () => {
  const ctx = { args: '', uid: () => 'u' };
  const flow = COMPONENTS.get('flow').render('A -> B\nB -> C: 标签', ctx);
  assert.match(flow, /data-key="A" data-step="0"/);
  assert.match(flow, /data-key="C" data-step="1"/);
  assert.equal((flow.match(/<g data-step="/g) || []).length, 2, '每条边一个分步组');
  const seq = COMPONENTS.get('sequence').render('A -> B: x\nB --> A: y', ctx);
  assert.match(seq, /<g data-key="A">/);
  assert.match(seq, /<g data-step="1">/);
  const tree = COMPONENTS.get('tree').render('根\n  子一\n  子二', ctx);
  assert.match(tree, /data-key="子二" data-step="2"/);
});

// ── CLI ──
function sink() {
  let text = '';
  const stream = new Writable({ write(chunk, _enc, cb) { text += chunk; cb(); } });
  return { stream, get text() { return text; } };
}

// 不传 ttsProvider 时用 null（只出字幕）；显式传 undefined 时走真实的配音选择逻辑。
async function run(args, opts = {}) {
  const { stdin = '', env = {} } = opts;
  const ttsProvider = 'ttsProvider' in opts ? opts.ttsProvider : null;
  const out = sink();
  const err = sink();
  const code = await main(args, {
    stdout: out.stream, stderr: err.stream, stdin: Readable.from([stdin]),
    env: { AM_NO_OPEN: '1', AM_HOME: dir, ...env }, cwd: dir, ttsProvider,
  });
  return { code, out: out.text, err: err.text };
}

test('cli video: 写入 AM_HOME/videos 并打印场景、旁白、时长与配音方式', async () => {
  const r = await run(['video', '-'], { stdin: SRC });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /✓ .+videos[\\/]握手-.+\.html/);
  assert.match(r.out, /2 场景 · 4 句旁白 · [\d.]+s · 配音：无/);
  assert.equal(readdirSync(join(dir, 'videos')).length, 1);
});

test('cli video: 配音方式写在输出里；无效 voice 报错', async () => {
  const r = await run(['video', '-', '-o', 'v.html'], { stdin: SRC, ttsProvider: fakeProvider() });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /配音：fake/);
  assert.match(readFileSync(join(dir, 'v.html'), 'utf8'), /data:audio\/wav/);
  const bad = await run(['video', '-', '--voice', 'robot'], { stdin: SRC });
  assert.equal(bad.code, 2);
  assert.match(bad.err, /voice 的值 "robot" 无效/);
});

test('cli patch: 视频页改一幕后仍是视频页', async () => {
  const vid = `---
title: 补丁视频
---
## 第一幕
- 旧画面
> 旧旁白。

## 第二幕
- 保留
> 第二句。
`;
  const made = await run(['video', '-', '-o', 'vid.html', '--voice', 'off'], { stdin: vid });
  assert.equal(made.code, 0, made.err);
  const before = readFileSync(join(dir, 'vid.html'), 'utf8');
  assert.match(before, /\sdata-video/);
  assert.match(before, /class="amv-scene/);

  const patched = await run(['patch', 'vid.html', '--panel', '第一幕'], {
    stdin: '## 第一幕\n- 新画面\n> 新旁白。\n',
  });
  assert.equal(patched.code, 0, patched.err);
  const after = readFileSync(join(dir, 'vid.html'), 'utf8');
  assert.match(after, /\sdata-video/);
  assert.match(after, /class="amv-scene/);
  assert.match(after, /新画面|新旁白/);
  assert.doesNotMatch(after, /<main class="am-(sheet|doc)/);
  assert.doesNotMatch(after, /旧画面/);
});

test('cli help video / config voice', async () => {
  assert.match((await run(['help', 'video'])).out, /视频稿格式/);
  const set = await run(['config', 'set', 'voice', 'off']);
  assert.equal(set.code, 0, set.err);
  assert.match((await run(['config', 'get', 'voice'])).out, /^off/);
});

test('findChrome: AM_CHROME 优先', () => {
  assert.equal(findChrome({ AM_CHROME: '/x/chrome' }), '/x/chrome');
});

// ── 端到端：真实系统 TTS + Chrome + ffmpeg。较慢，设置 AM_E2E=1 时才运行。──
const E2E = process.env.AM_E2E === '1';

test('e2e: 系统 TTS 合成真实语音', { skip: !E2E }, async () => {
  const p = pickProvider('system', process.env);
  const [clip] = await synthAll(['你好，世界。'], p, {});
  assert.ok(clip.length / SAMPLE_RATE > 0.4);
});

test('e2e: --mp4 导出 1080p30 带音轨的视频', { skip: !E2E, timeout: 120000 }, async () => {
  const short = '---\ntitle: 导出测试\n---\n## 场景\n```flow\nA -> B\n```\n> A 连到 B。\n';
  const r = await run(['video', '-', '-o', 'e2e.html', '--mp4'], { stdin: short, ttsProvider: fakeProvider() });
  assert.equal(r.code, 0, r.err);
  const { execFileSync } = await import('node:child_process');
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', join(dir, 'e2e.mp4')], { encoding: 'utf8' });
  assert.match(probe, /video,1920,1080/);
  assert.match(probe, /audio/);
});

// ── 审查后的修复 ──
test('synthAll: 损坏的缓存（奇数字节）视为未命中并重新合成', async () => {
  const { writeFileSync: write, readdirSync: list } = await import('node:fs');
  const p = fakeProvider();
  const cacheDir = join(dir, 'cache-broken');
  await synthAll(['坏缓存'], p, { cacheDir });
  const [f] = list(cacheDir);
  write(join(cacheDir, f), Buffer.alloc(3));
  await synthAll(['坏缓存'], p, { cacheDir });
  assert.equal(p.calls.length, 2);
  assert.ok(list(cacheDir).every((n) => !n.endsWith('.tmp')), '不留临时文件');
});

test('ElevenLabs: 网络错误包装成 TtsError，CLI 给出 --voice off 提示', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    const p = pickProvider('elevenlabs', { ELEVENLABS_API_KEY: 'k' });
    await assert.rejects(p.synth('你好'), (e) => e instanceof TtsError && /无法连接 ElevenLabs/.test(e.message));
    const r = await run(['video', '-', '--voice', 'elevenlabs'], { stdin: SRC, env: { ELEVENLABS_API_KEY: 'k' }, ttsProvider: undefined });
    assert.equal(r.code, 1);
    assert.match(r.err, /配音失败：无法连接 ElevenLabs.*--voice off/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('e2e: 以 - 开头的旁白不会被系统 TTS 当成选项', { skip: !E2E }, async () => {
  const p = pickProvider('system', process.env);
  const [clip] = await synthAll(['-v 这句以连字符开头'], p, {});
  assert.ok(clip.length / SAMPLE_RATE > 0.5);
});
