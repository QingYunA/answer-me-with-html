import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { audioMapProvider, readWav, SAMPLE_RATE, synthAll, trimSilence, TtsError, wav } from '../src/video/tts.js';
import { normalizeNarration } from '../src/video/script.js';
import { main } from '../src/cli.js';

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'am-audio-map-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

function tone(seconds, amplitude = 8000) {
  return Int16Array.from({ length: Math.round(seconds * SAMPLE_RATE) }, (_, i) => Math.round(amplitude * Math.sin(i / 8)));
}

function fixture(name, samples = tone(0.2)) {
  const file = join(dir, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, wav(samples));
  return file;
}

function map(name, value) {
  const file = join(dir, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
  return file;
}

function sink() {
  let text = '';
  const stream = new Writable({ write(chunk, _enc, cb) { text += chunk; cb(); } });
  return { stream, get text() { return text; } };
}

async function run(args, stdin = '') {
  const out = sink();
  const err = sink();
  const code = await main(args, {
    stdout: out.stream,
    stderr: err.stream,
    stdin: Readable.from([stdin]),
    env: { AM_HOME: join(dir, 'home'), AM_NO_OPEN: '1' },
    cwd: dir,
    ttsProvider: null,
  });
  return { code, out: out.text, err: err.text };
}

test('audio map: normalization removes narration markers and collapses whitespace; relative audio is trimmed', async () => {
  assert.equal(normalizeNarration('  > [Server]   answers    SYN-ACK. '), 'Server answers SYN-ACK.');
  const audio = fixture('normalized/audio/answer.wav', Int16Array.from([...new Int16Array(100), ...tone(0.2), ...new Int16Array(100)]));
  const mapFile = map('normalized/lines.json', { '> [Server]   answers    SYN-ACK.': 'audio/answer.wav' });
  const provider = audioMapProvider(mapFile);
  const actual = await provider.synth('Server answers SYN-ACK.');
  assert.deepEqual(actual, trimSilence(readWav(readFileSync(audio))));
  await assert.rejects(provider.synth('A missing narration line.'), (e) => e instanceof TtsError && /A missing narration line\./.test(e.message));
});

test('audio map: malformed maps and missing audio files give clear errors', () => {
  const malformed = join(dir, 'malformed.json');
  writeFileSync(malformed, '{bad');
  assert.throws(() => audioMapProvider(malformed), /Cannot parse audio map/);
  const missing = map('missing.json', { 'A line.': 'audio/not-here.wav' });
  assert.throws(() => audioMapProvider(missing), (e) => e instanceof TtsError && /A line\./.test(e.message) && /not-here\.wav/.test(e.message));
});

test('audio map: a silent narration file stops instead of producing a beat', async () => {
  fixture('silent.wav', new Int16Array(SAMPLE_RATE));
  const provider = audioMapProvider(map('silent.json', { 'Silent line.': 'silent.wav' }));
  await assert.rejects(provider.synth('Silent line.'), (e) => e instanceof TtsError && /Silent line\./.test(e.message) && /only silence/.test(e.message));
});

test('audio map: non-WAV audio needs ffmpeg and is converted to mono 22050 Hz PCM WAV', async () => {
  const audio = join(dir, 'voice.mp3');
  writeFileSync(audio, 'not a WAV fixture');
  const mapFile = map('convert.json', { 'Converted line.': 'voice.mp3' });
  const unavailable = audioMapProvider(mapFile, { which: () => false });
  await assert.rejects(unavailable.synth('Converted line.'), /not WAV.*needs ffmpeg/);

  const calls = [];
  const provider = audioMapProvider(mapFile, {
    which: () => true,
    runCommand: async (cmd, args) => {
      calls.push({ cmd, args });
      writeFileSync(args.at(-1), wav(tone(0.25)));
    },
  });
  const samples = await provider.synth('Converted line.');
  assert.equal(samples.length, Math.round(0.25 * SAMPLE_RATE));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'ffmpeg');
  assert.ok(calls[0].args.includes(audio));
  assert.deepEqual(calls[0].args.slice(-6, -1), ['1', '-ar', '22050', '-c:a', 'pcm_s16le']);
});

test('audio map: cache keys follow the map file and every audio file size and mtime', async () => {
  const audio = fixture('cache.wav', tone(0.2, 4000));
  const mapFile = map('cache.json', { 'Cached line.': 'cache.wav' });
  const cacheDir = join(dir, 'speech-cache');
  const first = audioMapProvider(mapFile);
  const a = await synthAll(['Cached line.'], first, { cacheDir });
  const b = await synthAll(['Cached line.'], audioMapProvider(mapFile), { cacheDir });
  assert.deepEqual(a, b);

  writeFileSync(audio, wav(tone(0.3, 7000)));
  const resized = audioMapProvider(mapFile);
  assert.notEqual(first.id, resized.id, 'audio size changes the cache key');
  const c = await synthAll(['Cached line.'], resized, { cacheDir });
  assert.equal(c[0].length, Math.round(0.3 * SAMPLE_RATE));

  const stamp = new Date(Date.now() + 5000);
  utimesSync(audio, stamp, stamp);
  const touched = audioMapProvider(mapFile);
  assert.notEqual(resized.id, touched.id, 'audio mtime changes the cache key');

  writeFileSync(mapFile, `${JSON.stringify({ 'Cached line.': 'cache.wav' }, null, 2)}\n`);
  assert.notEqual(touched.id, audioMapProvider(mapFile).id, 'map file changes the cache key');
});

test('cli video: --audio-map renders mapped narration and rejects an explicit --voice conflict', async () => {
  fixture('cli-one.wav', tone(0.15));
  fixture('cli-two.wav', tone(0.25));
  map('cli.json', {
    '> [Client]   sends SYN.': 'cli-one.wav',
    'Server answers SYN-ACK.': 'cli-two.wav',
  });
  const draft = join(dir, 'draft.md');
  writeFileSync(draft, '---\ntitle: Mapped audio\n---\n## Handshake\n- one\n- two\n> [Client] sends SYN.\n> Server answers SYN-ACK.\n');
  const rendered = await run(['video', 'draft.md', '--audio-map', 'cli.json', '-o', 'mapped.html', '--no-open']);
  assert.equal(rendered.code, 0, rendered.err);
  assert.match(rendered.out, /voice: audio-map/);
  const html = readFileSync(join(dir, 'mapped.html'), 'utf8');
  assert.match(html, /data-voice="audio-map"/);
  assert.match(html, /data:audio\/wav;base64,/);

  const conflict = await run(['video', 'draft.md', '--audio-map', 'cli.json', '--voice', 'off']);
  assert.equal(conflict.code, 2);
  assert.match(conflict.err, /--audio-map cannot be used with --voice/);
});

test('cli video: a narration line absent from the map stops before writing the page', async () => {
  fixture('only.wav');
  map('incomplete.json', { 'Present line.': 'only.wav' });
  const draft = join(dir, 'incomplete.md');
  writeFileSync(draft, '## Scene\n- one\n- two\n> Present line.\n> Missing narration line.\n');
  const result = await run(['video', 'incomplete.md', '--audio-map', 'incomplete.json', '-o', 'incomplete.html']);
  assert.equal(result.code, 1);
  assert.match(result.err, /No audio map entry for narration line "Missing narration line\."/);
  assert.equal(existsSync(join(dir, 'incomplete.html')), false);
});
