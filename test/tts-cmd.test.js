import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { commandArgs, pickProvider, SAMPLE_RATE, synthAll, TtsError } from '../src/video/tts.js';
import { main } from '../src/cli.js';

// A command-line TTS for the tests. It writes a 16-bit PCM WAV of 0.05 s per character of the text it was given, and appends
// what it received (arguments, stdin, the text file) to --log. --mode makes it fail in the ways a real TTS can.
const FAKE_TTS = String.raw`
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const stdin = readFileSync(0, 'utf8');
const file = opt('--file');
const text = opt('--text') ?? (file ? readFileSync(file, 'utf8') : stdin);
const mode = opt('--mode') ?? 'ok';
if (opt('--log')) appendFileSync(opt('--log'), JSON.stringify({ args, stdin, file: file && readFileSync(file, 'utf8'), lang: opt('--lang') }) + '\n');
if (mode === 'fail') { process.stderr.write('Traceback (most recent call last):\n' + '  File "tts.py", line 1\n'.repeat(40) + 'ValueError: voice zz-ZZ-Nobody not found\n'); process.exit(3); }
if (mode === 'none') process.exit(0);
if (mode === 'sleep') setTimeout(() => {}, 60000);
// Ignores SIGTERM and leaves a grandchild that holds stderr open, so the child's 'close' never comes in time.
if (mode === 'stubborn') {
  process.on('SIGTERM', () => {});
  (await import('node:child_process')).spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { stdio: ['ignore', 'ignore', 'inherit'] });
  setTimeout(() => {}, 60000);
}
if (mode === 'mp3') { writeFileSync(opt('--out'), Buffer.from('ID3\x03\x00\x00\x00fake mp3')); process.exit(0); }
const n = Math.round(text.length * 0.05 * 22050);
const buf = Buffer.alloc(44 + n * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(22050, 24);
buf.writeUInt32LE(44100, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
if (mode !== 'silent') for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), 44 + i * 2);
if (mode !== 'sleep' && mode !== 'stubborn') writeFileSync(opt('--out'), buf);
`;

let dir;
let fake;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'am-tts-cmd-'));
  fake = join(dir, 'fake-tts.mjs');
  writeFileSync(fake, FAKE_TTS);
});
after(() => rmSync(dir, { recursive: true, force: true }));

// The node binary and the fake script, quoted: on Windows both paths hold backslashes and the node path holds a space.
const node = () => `"${process.execPath}" "${fake}"`;
const logLines = (log) => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const seconds = (samples) => samples.length / SAMPLE_RATE;

test('cmd voice: commandArgs splits the template like a shell would, without running one, and fills placeholders per word', () => {
  const values = { text: 'a "b" $(rm -rf ~); c', out: 'C:\\tmp dir\\out.wav', text_file: '/t/x.txt', lang: 'zh-CN' };
  assert.deepEqual(
    commandArgs(`"C:\\Program Files\\edge-tts.exe" --text {text} --write-media={out} -f '{text_file}' --lang {lang} --keep {other}`, values),
    ['C:\\Program Files\\edge-tts.exe', '--text', values.text, `--write-media=${values.out}`, '-f', '/t/x.txt', '--lang', 'zh-CN', '--keep', '{other}'],
  );
  assert.deepEqual(commandArgs(`say  -v "Mei-Jia"   -o {out}`, values), ['say', '-v', 'Mei-Jia', '-o', values.out]);
  assert.deepEqual(commandArgs(`tts --empty "" --quote "it's"`, values), ['tts', '--empty', '', '--quote', "it's"]);
  assert.throws(() => commandArgs('tts --text "{text}', values), (e) => e instanceof TtsError && /unclosed "/.test(e.message));
});

test('cmd voice: without AM_TTS_CMD, or with a command that has no {out}, the error says what to set', () => {
  assert.throws(() => pickProvider('cmd', {}), (e) => e instanceof TtsError && /AM_TTS_CMD/.test(e.message) && /edge-tts/.test(e.message) && /\{out\}/.test(e.message));
  assert.throws(() => pickProvider('cmd', { AM_TTS_CMD: '   ' }), (e) => e instanceof TtsError && /AM_TTS_CMD/.test(e.message));
  assert.throws(() => pickProvider('cmd', { AM_TTS_CMD: 'edge-tts --text {text}' }), (e) => e instanceof TtsError && /\{out\}/.test(e.message));
});

test('cmd voice: runs the command once per line with an argument array; the text reaches it literally as {text}, {text_file} and stdin', async () => {
  const log = join(dir, 'literal.log');
  const nasty = `-n "; touch ${join(dir, 'pwned')}; echo $(id) \`id\` 'q' & | > x`;
  const provider = pickProvider('cmd', { AM_TTS_CMD: `${node()} --text {text} --file {text_file} --out {out} --log "${log}"` });
  assert.equal(provider.name, 'cmd');
  assert.equal(provider.voice, 'cmd');
  const samples = await provider.synth(nasty);
  assert.ok(Math.abs(seconds(samples) - nasty.length * 0.05) < 0.1, `${seconds(samples)} s`);
  const [call] = logLines(log);
  assert.equal(call.args[call.args.indexOf('--text') + 1], nasty);
  assert.equal(call.file, nasty);
  assert.equal(call.stdin, nasty);
  assert.equal(existsSync(join(dir, 'pwned')), false, 'no shell ran the text');
});

test('cmd voice: {lang} passes each line its language, which then joins the cache key; without {lang} it does not', async () => {
  const log = join(dir, 'lang.log');
  const cacheDir = join(dir, 'cache-lang');
  const withLang = pickProvider('cmd', { AM_TTS_CMD: `${node()} --lang {lang} --out {out} --log "${log}"` });
  assert.equal(withLang.usesLanguage, true);
  const languageOf = (text) => (/[\u4e00-\u9fff]/.test(text) ? 'zh-CN' : 'en');
  await synthAll(['Hello there.', '你好。'], withLang, { cacheDir, languageOf });
  assert.deepEqual(logLines(log).map((c) => c.lang).sort(), ['en', 'zh-CN']);
  const without = pickProvider('cmd', { AM_TTS_CMD: `${node()} --out {out}` });
  assert.equal(without.usesLanguage, false);
  assert.notEqual(withLang.id, without.id);
});

test('cmd voice: clips are cached by command and text; another command synthesizes again', async () => {
  const log = join(dir, 'cache.log');
  const cacheDir = join(dir, 'cache');
  const env = { AM_TTS_CMD: `${node()} --out {out} --log "${log}"` };
  const first = await synthAll(['One line.', 'A second, longer line.'], pickProvider('cmd', env), { cacheDir });
  assert.equal(logLines(log).length, 2);
  assert.ok(seconds(first[1]) > seconds(first[0]), 'each clip is as long as its own audio');
  const again = await synthAll(['One line.', 'A second, longer line.'], pickProvider('cmd', env), { cacheDir });
  assert.equal(logLines(log).length, 2, 'the second run reads the cache');
  assert.deepEqual(again, first);
  await synthAll(['One line.'], pickProvider('cmd', { AM_TTS_CMD: `${env.AM_TTS_CMD} --voice other` }), { cacheDir });
  assert.equal(logLines(log).length, 3, 'a changed command is not served from the cache');
});

test('cmd voice: a missing program, a failed run, no audio, silent audio and a hang each give a TtsError that says what happened', async () => {
  const fails = (cmd, pattern, options) => assert.rejects(pickProvider('cmd', { AM_TTS_CMD: cmd }, options).synth('A line.'), (e) => e instanceof TtsError && pattern.test(e.message));
  await fails('am-no-such-tts-program --out {out}', /"am-no-such-tts-program", which is not installed or not on PATH/);
  await fails(`${node()} --mode fail --out {out}`, /exited with code 3: .*ValueError: voice zz-ZZ-Nobody not found$/);
  await fails(`${node()} --mode none --out {out}`, /wrote no audio/);
  await fails(`${node()} --mode silent --out {out}`, /only silence/);
  await fails(`${node()} --mode mp3 --out {out}`, /ffmpeg/, { which: () => false });
  await fails(`${node()} --mode sleep --out {out}`, /did not finish within 0\.5 seconds/, { timeoutMs: 500 });
  const started = Date.now();
  await fails(`${node()} --mode stubborn --out {out}`, /did not finish within 0\.5 seconds/, { timeoutMs: 500 });
  assert.ok(Date.now() - started < 2500, 'the timeout does not wait for the command or its children to close their pipes');
});

function sink() {
  let text = '';
  const stream = new Writable({ write(chunk, _enc, cb) { text += chunk; cb(); } });
  return { stream, get text() { return text; } };
}

// No ttsProvider: the CLI picks the voice itself, as it does for a user.
async function run(args, env = {}) {
  const out = sink();
  const err = sink();
  const code = await main(args, {
    stdout: out.stream,
    stderr: err.stream,
    stdin: Readable.from(['']),
    env: { AM_HOME: join(dir, 'home'), AM_NO_OPEN: '1', ...env },
    cwd: dir,
  });
  return { code, out: out.text, err: err.text };
}

test('cli video: --voice cmd narrates with AM_TTS_CMD, and the page keeps the voice for am patch', async () => {
  writeFileSync(join(dir, 'draft.md'), '---\ntitle: Command voice\n---\n## Handshake\n- one\n- two\n> [Client] sends SYN.\n> Server answers SYN-ACK.\n');
  const env = { AM_TTS_CMD: `${node()} --file {text_file} --out {out}` };
  const r = await run(['video', 'draft.md', '--voice', 'cmd', '-o', 'cmd.html', '--no-open'], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /voice: cmd/);
  const html = readFileSync(join(dir, 'cmd.html'), 'utf8');
  assert.match(html, /data-voice="cmd"/);
  assert.match(html, /data:audio\/wav;base64,/);
});

test('cli video: --voice cmd without AM_TTS_CMD, or with a program that is not installed, stops with a ✗ line and writes no page', async () => {
  writeFileSync(join(dir, 'missing.md'), '## Scene\n- one\n> A line.\n');
  const unset = await run(['video', 'missing.md', '--voice', 'cmd', '-o', 'unset.html']);
  assert.equal(unset.code, 1);
  assert.match(unset.err, /✗ Voice-over failed: voice=cmd needs the AM_TTS_CMD environment variable.*Add --voice off for captions only/s);
  assert.equal(existsSync(join(dir, 'unset.html')), false);

  const absent = await run(['video', 'missing.md', '--voice', 'cmd', '-o', 'absent.html'], { AM_TTS_CMD: 'am-no-such-tts-program --out {out}' });
  assert.equal(absent.code, 1);
  assert.match(absent.err, /✗ Voice-over failed: .*am-no-such-tts-program/);
  assert.equal(existsSync(join(dir, 'absent.html')), false);
});

test('cli video: an unknown --voice lists cmd among the choices', async () => {
  const r = await run(['video', 'missing.md', '--voice', 'shell']);
  assert.equal(r.code, 2);
  assert.match(r.err, /Choose one of: .*\bcmd\b/);
});
