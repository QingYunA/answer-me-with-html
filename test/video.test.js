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

// Fake voice: a 0.1-second sine wave per character, counting calls.
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

// ── Draft parsing ──
test('parseVideo: scenes, narration beats, focus, title narration', () => {
  const v = parseVideo(SRC);
  assert.equal(v.meta.title, '握手');
  assert.deepEqual(v.introBeats.map((b) => b.text), ['片头旁白。']);
  assert.equal(v.scenes.length, 2);
  assert.deepEqual(v.scenes[0].beats.map((b) => b.text), ['A 先发 SYN。', 'B 回 ACK。']);
  assert.equal(v.scenes[0].beats[1].focus, 'B');
  assert.equal(v.scenes[0].blocks[0].lang, 'sequence');
  assert.equal(v.scenes[1].blocks[0].type, 'md', 'Markdown that is not narration stays on screen');
  assert.equal(allBeats(v).length, 4);
});

test('parseVideo: error when a scene has no narration or the draft has no scene', () => {
  assert.throws(() => parseVideo('## 空场景\n- 只有画面\n'), (e) => e instanceof ParseError && /has no narration/.test(e.message));
  assert.throws(() => parseVideo('> 只有旁白\n'), (e) => e instanceof ParseError && /needs at least one scene/.test(e.message));
});

test('estimateSeconds: estimates Chinese by character and English by word, with a minimum', () => {
  assert.ok(Math.abs(estimateSeconds('一二三四五六七八九十一二三四五六七八九十一') - (21 / 4.2 + 0.3)) < 1e-9);
  assert.ok(estimateSeconds('one two three four five six seven eight nine ten') > 3.5);
  assert.equal(estimateSeconds('好'), 1.6);
});

test('buildTimeline: title, scene changes and narration follow in order with increasing times', () => {
  const v = parseVideo(SRC);
  const tl = buildTimeline(v, [2, 1, 1, 1]);
  assert.equal(tl.title.beats[0].start, 0);
  assert.equal(tl.scenes[0].start, tl.title.end);
  assert.equal(tl.scenes[0].beats[0].start, tl.scenes[0].start + TIMING.transition);
  assert.equal(tl.scenes[0].beats[1].start, tl.scenes[0].beats[0].end + TIMING.gap);
  assert.equal(tl.scenes[1].start, tl.scenes[0].end);
  assert.equal(tl.duration, tl.scenes[1].end + TIMING.outro);
  const noIntro = buildTimeline({ ...v, introBeats: [] }, [1, 1, 1]);
  assert.equal(noIntro.scenes[0].start, TIMING.title, 'without title narration, the title holds for a fixed time');
});

test('formatClock: rounding carries into the next minute, never 0:60', () => {
  assert.equal(formatClock(59.6), '1:00');
  assert.equal(formatClock(59.4), '0:59');
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(90), '1:30');
});

test('captionHtml: escapes HTML, [name] becomes a highlighted word', () => {
  assert.equal(captionHtml('[Server] 回 <ACK>'), '<b>Server</b> 回 &lt;ACK&gt;');
});

// ── Voice ──
test('wav / readWav round trip; mixTrack places clips by start time', () => {
  const samples = Int16Array.from([0, 1000, -1000, 32767]);
  assert.deepEqual([...readWav(wav(samples))], [...samples]);
  const track = readWav(mixTrack([Int16Array.from([5, 6])], [1], 2));
  assert.equal(track.length, 2 * SAMPLE_RATE);
  assert.equal(track[SAMPLE_RATE], 5);
  assert.equal(track[SAMPLE_RATE - 1], 0);
});

test('trimSilence: trims leading and trailing silence, keeping a 40ms margin', () => {
  const pad = Math.floor(SAMPLE_RATE * 0.04);
  const s = new Int16Array(SAMPLE_RATE);
  s.fill(5000, 10000, 11000);
  const out = trimSilence(s);
  assert.equal(out.length, 1000 + pad * 2);
});

test('synthAll: synthesizes concurrently and caches, the second run does not call TTS', async () => {
  const p = fakeProvider();
  const cacheDir = join(dir, 'cache');
  const a = await synthAll(['一句', '两句话'], p, { cacheDir });
  assert.equal(p.calls.length, 2);
  const b = await synthAll(['一句', '两句话'], p, { cacheDir });
  assert.equal(p.calls.length, 2, 'cache hit');
  assert.deepEqual([...b[1]], [...a[1]]);
});

test('pickProvider: choices and errors for off / elevenlabs / system / auto', () => {
  assert.equal(pickProvider('off', {}), null);
  assert.throws(() => pickProvider('elevenlabs', {}), TtsError);
  assert.equal(pickProvider('auto', { ELEVENLABS_API_KEY: 'k' }).name, 'elevenlabs');
  assert.throws(() => pickProvider('system', {}, { platform: 'linux', which: () => false }), TtsError);
  assert.equal(pickProvider('auto', {}, { platform: 'linux', which: () => false }), null, 'captions only when nothing is available');
  assert.equal(pickProvider('auto', {}, { platform: 'linux', which: (c) => c === 'espeak-ng' }).name, 'espeak-ng');
});

test('pickProvider: local needs AM_TTS_URL, AM_TTS_EXTRA must be a JSON object, auto never picks local', () => {
  assert.throws(() => pickProvider('local', {}), (e) => e instanceof TtsError && /AM_TTS_URL/.test(e.message));
  assert.throws(() => pickProvider('local', { AM_TTS_URL: 'http://x', AM_TTS_EXTRA: '[1]' }), /JSON object/);
  assert.throws(() => pickProvider('local', { AM_TTS_URL: 'http://x', AM_TTS_EXTRA: '{bad' }), /JSON object/);
  assert.equal(pickProvider('local', { AM_TTS_URL: 'http://x' }).name, 'local');
  assert.equal(pickProvider('auto', { AM_TTS_URL: 'http://x' }, { platform: 'linux', which: () => false }), null);
});

// A fake fetch returns WAVs of the given seconds (or error responses) in turn and records the requests.
async function withFakeFetch(replies, fn) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (typeof r === 'number') return new Response(wav(new Int16Array(Math.round(r * SAMPLE_RATE)).fill(1000)));
    if (r instanceof Response) return r;
    return new Response(r.text, { status: r.status });
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test('local voice: the request body merges AM_TTS_EXTRA, the returned WAV decodes to samples', async () => {
  const env = { AM_TTS_URL: 'http://127.0.0.1:8000/', AM_TTS_MODEL: 'm', AM_TTS_VOICE: 'v', AM_TTS_EXTRA: '{"repetition_penalty":1.05,"response_format":"mp3"}' };
  const p = pickProvider('local', env);
  const expected = estimateSeconds('一句话');
  await withFakeFetch([expected], async (calls) => {
    const out = await p.synth('一句话');
    assert.equal(out.length, Math.round(expected * SAMPLE_RATE));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:8000/v1/audio/speech');
    assert.deepEqual(calls[0].body, { repetition_penalty: 1.05, response_format: 'wav', stream: false, model: 'm', voice: 'v', input: '一句话' });
  });
  assert.notEqual(p.id, pickProvider('local', { ...env, AM_TTS_VOICE: 'w' }).id, 'a different voice does not reuse the cache');
});

test('local voice: retries a runaway or truncated duration up to three times and keeps the attempt closest to the estimate', async () => {
  const p = pickProvider('local', { AM_TTS_URL: 'http://x' });
  const text = '这一句旁白大约需要几秒钟才能读完。';
  const e = estimateSeconds(text);
  await withFakeFetch([e * 8, e], async (calls) => {
    const out = await p.synth(text);
    assert.equal(calls.length, 2, 'stops when the second attempt is normal');
    assert.equal(out.length, Math.round(e * SAMPLE_RATE));
  });
  await withFakeFetch([e * 8, e * 0.1, e * 3], async (calls) => {
    const out = await p.synth(text);
    assert.equal(calls.length, 3);
    assert.equal(out.length, Math.round(e * 3 * SAMPLE_RATE), 'when none is normal, picks the ratio closest to 1');
  });
});

test('local voice: TtsError when the server returns an error or cannot be reached', async () => {
  const p = pickProvider('local', { AM_TTS_URL: 'http://x' });
  await withFakeFetch([{ status: 422, text: 'model required' }], async () => {
    await assert.rejects(p.synth('一句'), (e) => e instanceof TtsError && /422/.test(e.message) && /model required/.test(e.message));
  });
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    await assert.rejects(p.synth('一句'), (e) => e instanceof TtsError && /Cannot connect to the local TTS/.test(e.message));
  } finally {
    globalThis.fetch = real;
  }
});

test('local voice: AM_TTS_EXTRA cannot override input / response_format / stream; a trailing /v1 in the URL is not doubled', async () => {
  const p = pickProvider('local', { AM_TTS_URL: 'http://h:1/v1/', AM_TTS_MODEL: 'm', AM_TTS_EXTRA: '{"stream":true,"input":"x","model":"a","response_format":"mp3"}' });
  await withFakeFetch([estimateSeconds('一句')], async (calls) => {
    await p.synth('一句');
    assert.equal(calls[0].url, 'http://h:1/v1/audio/speech');
    assert.deepEqual(calls[0].body, { stream: false, input: '一句', model: 'm', response_format: 'wav' });
  });
});

test('local voice: the cache key ignores parameter order and any input in AM_TTS_EXTRA', () => {
  const id = (extra) => pickProvider('local', { AM_TTS_URL: 'http://x', AM_TTS_EXTRA: extra }).id;
  assert.equal(id('{"a":1,"b":{"d":2,"c":3}}'), id('{"b":{"c":3,"d":2},"a":1}'));
  assert.equal(id('{"a":1,"input":"x"}'), id('{"a":1}'));
  assert.notEqual(id('{"a":1}'), id('{"a":2}'));
});

test('local voice: judges length after trimming silence, so truncated audio padded with silence is retried', async () => {
  const p = pickProvider('local', { AM_TTS_URL: 'http://x' });
  const text = '这一句旁白大约需要几秒钟才能读完。';
  const e = estimateSeconds(text);
  const padded = new Int16Array(Math.round(e * SAMPLE_RATE));
  padded.fill(1000, 0, Math.round(0.1 * e * SAMPLE_RATE));
  await withFakeFetch([new Response(wav(padded)), e], async (calls) => {
    const out = await p.synth(text);
    assert.equal(calls.length, 2);
    assert.ok(out.length >= Math.round(e * SAMPLE_RATE));
  });
});

test('local voice: speed in AM_TTS_EXTRA adjusts the estimated duration; AM_TTS_ATTEMPTS=1 turns off retries', async () => {
  const text = '这一句旁白大约需要几秒钟才能读完。';
  const e = estimateSeconds(text);
  const slow = pickProvider('local', { AM_TTS_URL: 'http://x', AM_TTS_EXTRA: '{"speed":0.25}' });
  await withFakeFetch([e * 4], async (calls) => {
    await slow.synth(text);
    assert.equal(calls.length, 1, 'normal reading at quarter speed is not runaway');
  });
  const once = pickProvider('local', { AM_TTS_URL: 'http://x', AM_TTS_ATTEMPTS: '1' });
  await withFakeFetch([e * 8, e], async (calls) => {
    await once.synth(text);
    assert.equal(calls.length, 1);
  });
  assert.throws(() => pickProvider('local', { AM_TTS_URL: 'http://x', AM_TTS_ATTEMPTS: '0' }), /positive integer/);
});

test('local voice: TtsError when the response body breaks off or the audio is not 16-bit PCM WAV', async () => {
  const p = pickProvider('local', { AM_TTS_URL: 'http://x' });
  const broken = new Response(new ReadableStream({ start(c) { c.error(new TypeError('terminated')); } }));
  await withFakeFetch([broken], async () => {
    await assert.rejects(p.synth('一句'), (e) => e instanceof TtsError && /terminated/.test(e.message));
  });
  const pcm24 = wav(new Int16Array(100));
  pcm24.writeUInt16LE(24, 34);
  await withFakeFetch([new Response(pcm24)], async () => {
    await assert.rejects(p.synth('一句'), (e) => e instanceof TtsError && /16-bit PCM WAV/.test(e.message));
  });
});

test('local voice: empty or silent audio is not a result, TtsError when all attempts are; the attempt with sound is used', async () => {
  const p = pickProvider('local', { AM_TTS_URL: 'http://x' });
  const e = estimateSeconds('一句');
  const silent = () => new Response(wav(new Int16Array(5 * SAMPLE_RATE)));
  await withFakeFetch([new Response(wav(new Int16Array(0))), silent(), silent()], async (calls) => {
    await assert.rejects(p.synth('一句'), (err) => err instanceof TtsError && /silence/.test(err.message));
    assert.equal(calls.length, 3);
  });
  await withFakeFetch([silent(), e * 3], async (calls) => {
    const out = await p.synth('一句');
    assert.equal(calls.length, 3, 'ratio 3 is out of range, keep retrying');
    assert.ok(out.length >= Math.round(e * 3 * SAMPLE_RATE), 'uses the result with sound, not the silent one');
  });
});

test('local voice: a different retry count gives a different cache key', () => {
  const id = (n) => pickProvider('local', { AM_TTS_URL: 'http://x', AM_TTS_ATTEMPTS: n }).id;
  assert.notEqual(id('1'), id('3'));
});

test('local voice: keeps the HTTP status code when reading fails after the response headers', async () => {
  const p = pickProvider('local', { AM_TTS_URL: 'http://x' });
  const broken = new Response(new ReadableStream({ start(c) { c.error(new TypeError('terminated')); } }), { status: 500 });
  await withFakeFetch([broken], async () => {
    await assert.rejects(p.synth('一句'), (e) => e instanceof TtsError && /HTTP 500/.test(e.message) && /terminated/.test(e.message));
  });
});

test('pickMacVoices: recognizes long names separated by one space, prefers Tingting / Samantha', () => {
  const out = [
    'Reed (中文（中国大陆）)     zh_CN    # 你好！我叫Reed。',
    'Tingting (中文（中国大陆）) zh_CN    # 你好！我叫婷婷。',
    'Albert              en_US    # Hello! My name is Albert.',
    'Samantha (英语（美国）)   en_US    # Hello! My name is Samantha.',
  ].join('\n');
  assert.deepEqual(pickMacVoices(out), { zh: 'Tingting (中文（中国大陆）)', en: 'Samantha (英语（美国）)', ja: undefined });
  assert.deepEqual(pickMacVoices('Reed (中文（中国大陆）)  zh_CN  # x'), { zh: 'Reed (中文（中国大陆）)', en: undefined, ja: undefined });
});

test('pickMacVoices: prefers Kyoko for Japanese', () => {
  const out = [
    'Eddy (日本語（日本）)      ja_JP    # こんにちは! 私の名前はEddyです。',
    'Kyoko               ja_JP    # こんにちは! 私の名前はKyokoです。',
  ].join('\n');
  assert.equal(pickMacVoices(out).ja, 'Kyoko');
  assert.equal(pickMacVoices(out.split('\n')[0]).ja, 'Eddy (日本語（日本）)');
});

// ── Render ──
test('renderVideo: the title duration carries to 1:00, not 0:60', async () => {
  const samples = new Int16Array(Math.round(54 * SAMPLE_RATE));
  samples.fill(1000);
  const r = await renderVideo(`---\ntitle: Dur\n---\n## S\n\`\`\`flow\nA -> B\n\`\`\`\n> beat\n`, {
    provider: { name: 'fake', id: 'fake', concurrency: 1, synth: async () => samples },
  });
  assert.ok(Math.abs(r.duration - 59.6) < 0.05, r.duration);
  assert.match(r.html, /DURATION<\/b><span>1:00<\/span>/);
});

test('renderVideo: without voice, the player page uses estimated durations with all scenes and data', async () => {
  const r = await renderVideo(SRC);
  assert.equal(r.wav, null);
  assert.equal(r.beats, 4);
  assert.equal((r.html.match(/<section class="amv-scene/g) || []).length, 3, 'title + two scenes');
  const data = JSON.parse(r.html.match(/id="amv-data">(.*?)<\/script>/)[1]);
  assert.equal(data.segments.length, 3);
  assert.equal(data.segments[1].beats[1].html, '<b>B</b> 回 ACK。');
  assert.equal(data.duration, r.duration);
  assert.doesNotMatch(r.html, /<audio/);
  assert.match(r.html, /window\.render = render/);
});

test('renderVideo: with voice, durations come from the audio and the WAV is embedded', async () => {
  const p = fakeProvider();
  const r = await renderVideo(SRC, { provider: p });
  assert.equal(p.calls.length, 4);
  assert.match(r.html, /<audio id="amv-audio" preload="auto" src="data:audio\/wav;base64,/);
  const data = JSON.parse(r.html.match(/id="amv-data">(.*?)<\/script>/)[1]);
  const first = data.segments[0].beats[0];
  assert.ok(Math.abs(first.end - first.start - [...'片头旁白。'].length * 0.1) < 0.01);
  assert.equal(readWav(r.wav).length, Math.ceil(r.duration * SAMPLE_RATE));
});

test('renderVideo: multi-line narration is not a long paragraph; strict still blocks other problems', async () => {
  const many = `## 场景\n- 画面\n${Array.from({ length: 8 }, (_, i) => `> 第 ${i + 1} 句。`).join('\n')}\n`;
  const r = await renderVideo(many);
  assert.equal(r.warnings.filter((w) => w.rule === 'paragraph-length').length, 0);
  await assert.rejects(renderVideo(`---\nstyle: strict\n---\n## 场景\n> 我们对系统进行优化。\n`), /STE/);
});

test('video theme: blueprint light by default; a draft may set 3b1b; the command-line argument wins', async () => {
  const def = await renderVideo(SRC);
  assert.match(def.html, /data-theme="blueprint" data-mode="light" data-style="80" data-video/);
  assert.match(def.html, /class="amv-sheet"/, 'sheet frame');
  assert.match(def.html, /SHEET 01 \/ 02/);
  const dark = await renderVideo(`---\ntheme: 3b1b\n---\n${SRC.split('---\n').slice(2).join('---\n')}`);
  assert.match(dark.html, /data-theme="3b1b" data-mode="dark"/);
  const cli = await renderVideo(SRC, { overrides: { theme: 'shadcn', mode: 'dark' } });
  assert.match(cli.html, /data-theme="shadcn" data-mode="dark"/);
  await assert.rejects(renderVideo(SRC, { overrides: { theme: 'neon' } }), /Invalid theme value "neon"/);
  assert.throws(() => renderDoc('---\ntheme: 3b1b\n---\n## A\n文字\n'), ParseError, 'pages do not support 3b1b');
});

test('video fonts: Japanese 3b1b titles use a Japanese serif; titles in other themes are not overridden', async () => {
  const JA = '## 概要\n> 接続は3回のやりとりで行う。\n';
  const dark = await renderVideo(`---\ntheme: 3b1b\n---\n${JA}`);
  const rule = dark.html.match(/html\[lang="ja"\]\[data-theme="3b1b"\]\[data-mode\] \{[^}]*\}/)?.[0];
  assert.ok(rule, '3b1b has a Japanese title font rule');
  assert.ok(rule.indexOf('"Hiragino Mincho ProN"') < rule.indexOf('"Songti SC"'));
  assert.doesNotMatch(rule, /--font-sans/, 'the serif rule applies only to titles');
  const generic = dark.html.match(/html\[lang="ja"\]\[data-theme\]\[data-mode\] \{[^}]*\}/)?.[0];
  assert.ok(generic, 'has a general Japanese font rule');
  assert.doesNotMatch(generic, /--v-title-font/, 'the general rule does not change the title font');
});

test('renderDoc: template video points to am video', () => {
  assert.throws(() => renderDoc('---\ntemplate: video\n---\n## A\n文字\n'), (e) => e instanceof ParseError && /am video/.test(e.message));
});

// ── Component step markers ──
test('component step markers: flow by source line, sequence by message, tree by node', () => {
  const ctx = { args: '', uid: () => 'u' };
  const flow = COMPONENTS.get('flow').render('A -> B\nB -> C: 标签', ctx);
  assert.match(flow, /data-key="A" data-step="0"/);
  assert.match(flow, /data-key="C" data-step="1"/);
  assert.equal((flow.match(/<g data-step="/g) || []).length, 2, 'one step group per edge');
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

// Without ttsProvider, use null (captions only); an explicit undefined runs the real voice selection.
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

test('cli video: writes to AM_HOME/videos and prints scenes, narration, duration and voice', async () => {
  const r = await run(['video', '-'], { stdin: SRC });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /✓ .+videos[\\/]握手-.+\.html/);
  assert.match(r.out, /2 scenes · 4 beats · [\d.]+s · voice: none/);
  assert.equal(readdirSync(join(dir, 'videos')).length, 1);
});

test('cli video: the output names the voice; an invalid voice is an error', async () => {
  const r = await run(['video', '-', '-o', 'v.html'], { stdin: SRC, ttsProvider: fakeProvider() });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /voice: fake/);
  assert.match(readFileSync(join(dir, 'v.html'), 'utf8'), /data:audio\/wav/);
  const bad = await run(['video', '-', '--voice', 'robot'], { stdin: SRC });
  assert.equal(bad.code, 2);
  assert.match(bad.err, /Invalid voice value "robot"/);
});

test('cli patch: a video page is still a video page after one scene changes', async () => {
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
  assert.match((await run(['help', 'video'])).out, /Video draft format/);
  const set = await run(['config', 'set', 'voice', 'off']);
  assert.equal(set.code, 0, set.err);
  assert.match((await run(['config', 'get', 'voice'])).out, /^off/);
});

test('findChrome: AM_CHROME wins', () => {
  assert.equal(findChrome({ AM_CHROME: '/x/chrome' }), '/x/chrome');
});

// ── End to end: real system TTS + Chrome + ffmpeg. Slow; runs only with AM_E2E=1. ──
const E2E = process.env.AM_E2E === '1';

test('e2e: system TTS synthesizes real speech', { skip: !E2E }, async () => {
  const p = pickProvider('system', process.env);
  const [clip] = await synthAll(['你好，世界。'], p, {});
  assert.ok(clip.length / SAMPLE_RATE > 0.4);
});

test('e2e: --mp4 exports a 1080p30 video with an audio track', { skip: !E2E, timeout: 120000 }, async () => {
  const short = '---\ntitle: 导出测试\n---\n## 场景\n```flow\nA -> B\n```\n> A 连到 B。\n';
  const r = await run(['video', '-', '-o', 'e2e.html', '--mp4'], { stdin: short, ttsProvider: fakeProvider() });
  assert.equal(r.code, 0, r.err);
  const { execFileSync } = await import('node:child_process');
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', join(dir, 'e2e.mp4')], { encoding: 'utf8' });
  assert.match(probe, /video,1920,1080/);
  assert.match(probe, /audio/);
});

// ── Fixes after review ──
test('synthAll: a corrupt cache entry (odd byte count) counts as a miss and is synthesized again', async () => {
  const { writeFileSync: write, readdirSync: list } = await import('node:fs');
  const p = fakeProvider();
  const cacheDir = join(dir, 'cache-broken');
  await synthAll(['坏缓存'], p, { cacheDir });
  const [f] = list(cacheDir);
  write(join(cacheDir, f), Buffer.alloc(3));
  await synthAll(['坏缓存'], p, { cacheDir });
  assert.equal(p.calls.length, 2);
  assert.ok(list(cacheDir).every((n) => !n.endsWith('.tmp')), 'leaves no temp file');
});

test('ElevenLabs: network errors become TtsError and the CLI suggests --voice off', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    const p = pickProvider('elevenlabs', { ELEVENLABS_API_KEY: 'k' });
    await assert.rejects(p.synth('你好'), (e) => e instanceof TtsError && /Cannot connect to ElevenLabs/.test(e.message));
    const r = await run(['video', '-', '--voice', 'elevenlabs'], { stdin: SRC, env: { ELEVENLABS_API_KEY: 'k' }, ttsProvider: undefined });
    assert.equal(r.code, 1);
    assert.match(r.err, /Voice-over failed: Cannot connect to ElevenLabs.*--voice off/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('e2e: narration starting with - is not taken as an option by system TTS', { skip: !E2E }, async () => {
  const p = pickProvider('system', process.env);
  const [clip] = await synthAll(['-v 这句以连字符开头'], p, {});
  assert.ok(clip.length / SAMPLE_RATE > 0.5);
});

test('player: morphs hide elements by "collect first, then set", so the morph of the next scene does not override them', async () => {
  const { VIDEO_JS } = await import('../src/assets.js');
  assert.match(VIDEO_JS, /const hidden = new Set\(\)/);
  assert.doesNotMatch(VIDEO_JS, /m\.to\.style\.visibility =/);
});

test('local voice: AM_TTS_API_KEY is sent as a Bearer token and stays out of the cache key', async () => {
  const env = { AM_TTS_URL: 'http://x' };
  const keyed = pickProvider('local', { ...env, AM_TTS_API_KEY: 'sk-1' });
  await withFakeFetch([estimateSeconds('一句话')], async (calls) => {
    await keyed.synth('一句话');
    assert.equal(calls[0].headers.authorization, 'Bearer sk-1');
  });
  await withFakeFetch([estimateSeconds('一句话')], async (calls) => {
    await pickProvider('local', env).synth('一句话');
    assert.equal(calls[0].headers.authorization, undefined);
  });
  assert.equal(keyed.id, pickProvider('local', env).id);
  assert.ok(!keyed.id.includes('sk-1'));
});

test('am patch: a voiced video keeps its voice instead of switching to the configured one', async () => {
  const draft = '## 第一幕\n- 画面\n> 第一句。\n';
  const local = { name: 'local', voice: 'local', id: 'fake-local', concurrency: 1, synth: async () => new Int16Array(SAMPLE_RATE).fill(1000) };
  const { html } = await renderVideo(draft, { provider: local });
  assert.match(html, /<html[^>]* data-voice="local"/);
  const file = join(dir, 'voiced-local.html');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, html);
  await withFakeFetch([estimateSeconds('改过的一句。')], async (calls) => {
    const r = await run(['patch', file, '--panel', '第一幕', '--no-open'], { stdin: '- 画面\n> 改过的一句。\n', env: { AM_TTS_URL: 'http://tts' }, ttsProvider: undefined });
    assert.equal(r.code, 0, r.err);
    assert.equal(calls.length, 1, 're-voiced with local');
    assert.match(r.out, /voice: local/);
  });
  assert.match(readFileSync(file, 'utf8'), /data-voice="local"/);
});

test('ElevenLabs: defaults to eleven_v4_turbo, ELEVENLABS_MODEL_ID changes the model, the cache id follows it', async () => {
  const realFetch = globalThis.fetch;
  const bodies = [];
  const urls = [];
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    bodies.push(JSON.parse(init.body));
    return new Response(new Uint8Array(4), { status: 200 });
  };
  try {
    const base = { ELEVENLABS_API_KEY: 'k' };
    const def = pickProvider('elevenlabs', base);
    const flash = pickProvider('elevenlabs', { ...base, ELEVENLABS_MODEL_ID: 'eleven_flash_v2_5' });
    await def.synth('你好');
    await flash.synth('你好');
    assert.deepEqual(bodies.map((b) => b.model_id), ['eleven_v4_turbo', 'eleven_flash_v2_5']);
    assert.match(def.id, /:eleven_v4_turbo$/);
    // The default voice is Will, a premade voice that works on the free plan; ELEVENLABS_VOICE_ID overrides it.
    assert.match(urls[0], /text-to-speech\/bIHbv24MWmeRgasZH58o\?/);
    await pickProvider('elevenlabs', { ...base, ELEVENLABS_VOICE_ID: 'abc' }).synth('你好');
    assert.match(urls[2], /text-to-speech\/abc\?/);
    assert.notEqual(def.id, flash.id);
  } finally {
    globalThis.fetch = realFetch;
  }
});
