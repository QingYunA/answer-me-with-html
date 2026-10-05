// Narration voice-over. Fallback order: ElevenLabs (with ELEVENLABS_API_KEY) → system TTS (macOS say / Linux espeak-ng) → captions only.
// --voice local uses a local OpenAI-compatible /v1/audio/speech service (AM_TTS_URL) instead, only when given explicitly.
// Each line is synthesized as 22050 Hz mono 16-bit PCM and cached by text + voice in AM_HOME/cache/tts/, so re-renders do not synthesize again.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectLang } from '../render.js';
import { hasCommand } from '../sys.js';
import { estimateSeconds } from './script.js';

export const SAMPLE_RATE = 22050;
const ELEVEN_DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb';
const ELEVEN_DEFAULT_MODEL = 'eleven_v4';
const ELEVEN_TIMEOUT_MS = 60000;
const LOCAL_TIMEOUT_MS = 300000;
// Local autoregressive TTS (e.g. Qwen3-TTS) sometimes fails to stop or cuts off early. When actual / estimated duration falls outside this range, retry, at most LOCAL_ATTEMPTS times.
const LOCAL_RATIO = Object.freeze([0.5, 2]);
const LOCAL_ATTEMPTS = 3;
const SILENCE = 300; // amplitude below this counts as silence

export class TtsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TtsError';
  }
}

// Pick the voice-over actually used. Returns { name, synth(text) → Int16Array } or null (captions only).
export function pickProvider(choice, env, { platform = process.platform, which = hasCommand } = {}) {
  const eleven = () => elevenLabs(env);
  const system = () => systemVoice(platform, which);
  if (choice === 'off') return null;
  if (choice === 'elevenlabs') {
    if (!env.ELEVENLABS_API_KEY) throw new TtsError('voice=elevenlabs needs the ELEVENLABS_API_KEY environment variable');
    return eleven();
  }
  if (choice === 'local') return localSpeech(env);
  if (choice === 'system') {
    const p = system();
    if (!p) throw new TtsError('No system TTS found: macOS has say built in; on Linux install espeak-ng');
    return p;
  }
  if (env.ELEVENLABS_API_KEY) return eleven();
  return system();
}

function elevenLabs(env) {
  const voice = env.ELEVENLABS_VOICE_ID || ELEVEN_DEFAULT_VOICE;
  const model = env.ELEVENLABS_MODEL_ID || ELEVEN_DEFAULT_MODEL;
  return {
    name: 'elevenlabs',
    voice: 'elevenlabs',
    id: `elevenlabs:${voice}:${model}`,
    concurrency: 2,
    async synth(text) {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=pcm_${SAMPLE_RATE}`;
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
          body: JSON.stringify({ text, model_id: model }),
          signal: AbortSignal.timeout(ELEVEN_TIMEOUT_MS),
        });
      } catch (e) {
        throw new TtsError(`Cannot connect to ElevenLabs: ${e.name === 'TimeoutError' ? `no response within ${ELEVEN_TIMEOUT_MS / 1000} seconds` : e.message}`);
      }
      if (!res.ok) throw new TtsError(`ElevenLabs returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2)).slice();
    },
  };
}

// OpenAI-compatible speech API: POST {AM_TTS_URL}/v1/audio/speech, must return 16-bit PCM WAV (whole clip at once, no chunked streaming).
// AM_TTS_MODEL / AM_TTS_VOICE map to model / voice in the request; AM_TTS_EXTRA is a JSON object merged into the request body (model-specific parameters),
// but am always decides input / response_format / stream. AM_TTS_ATTEMPTS is the maximum syntheses per line, default 3; 1 turns off the duration check.
// AM_TTS_API_KEY, when set, is sent as a Bearer token; it is not part of the cache key.
function localSpeech(env) {
  if (!env.AM_TTS_URL) throw new TtsError('voice=local needs the AM_TTS_URL environment variable (such as http://127.0.0.1:8000)');
  const url = `${env.AM_TTS_URL.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/audio/speech`;
  let extra = {};
  if (env.AM_TTS_EXTRA) {
    try {
      extra = JSON.parse(env.AM_TTS_EXTRA);
    } catch {
      extra = null;
    }
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new TtsError('AM_TTS_EXTRA must be a JSON object');
  }
  const attempts = env.AM_TTS_ATTEMPTS ? Number(env.AM_TTS_ATTEMPTS) : LOCAL_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts < 1) throw new TtsError('AM_TTS_ATTEMPTS must be a positive integer');
  const body = { ...extra, response_format: 'wav', stream: false };
  delete body.input;
  if (env.AM_TTS_MODEL) body.model = env.AM_TTS_MODEL;
  if (env.AM_TTS_VOICE) body.voice = env.AM_TTS_VOICE;
  // When a speed change is requested, estimate duration at the changed rate, so normal slow reading is not taken as runaway.
  const speed = typeof body.speed === 'number' && body.speed > 0 ? body.speed : 1;
  const headers = { 'content-type': 'application/json', ...(env.AM_TTS_API_KEY ? { authorization: `Bearer ${env.AM_TTS_API_KEY}` } : {}) };
  const request = async (text) => {
    const signal = AbortSignal.timeout(LOCAL_TIMEOUT_MS);
    const why = (e) => (signal.aborted ? `not finished within ${LOCAL_TIMEOUT_MS / 1000} seconds` : e.message);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, input: text }),
        signal,
      });
    } catch (e) {
      throw new TtsError(`Cannot connect to the local TTS ${url}: ${why(e)}`);
    }
    let buf;
    try {
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      throw new TtsError(`Cannot read the local TTS response (HTTP ${res.status}): ${why(e)}`);
    }
    if (!res.ok) throw new TtsError(`The local TTS returned ${res.status}: ${buf.toString('utf8', 0, 200)}`);
    try {
      return readWav(buf);
    } catch (e) {
      throw new TtsError(`Cannot decode the audio from the local TTS (needs 16-bit PCM WAV): ${e.message}`);
    }
  };
  return {
    name: 'local',
    voice: 'local',
    id: `local:${url}:${attempts}:${stableJson(body)}`,
    concurrency: 1,
    async synth(text) {
      // Judge by length after trimming leading/trailing silence: silence padding cannot let a truncated line pass. Empty or all-silent audio is not a result.
      const expected = estimateSeconds(text) / speed;
      let best = null;
      for (let i = 0; i < attempts; i++) {
        const samples = trimSilence(await request(text));
        if (!samples.some((x) => Math.abs(x) >= SILENCE)) continue;
        const ratio = samples.length / SAMPLE_RATE / expected;
        if (!best || Math.abs(Math.log(ratio)) < Math.abs(Math.log(best.ratio))) best = { samples, ratio };
        if (ratio >= LOCAL_RATIO[0] && ratio <= LOCAL_RATIO[1]) break;
      }
      if (!best) throw new TtsError(`The local TTS returned only silence ${attempts} time${attempts === 1 ? '' : 's'} in a row`);
      return best.samples;
    },
  };
}

// JSON with keys in alphabetical order, so the same parameters in another order give the same cache key.
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function systemVoice(platform, which) {
  if (platform === 'darwin' && which('say')) {
    const voices = macVoices();
    return {
      name: 'say',
      voice: 'system',
      id: `say:${voices.zh}:${voices.en}:${voices.ja}`,
      concurrency: 4,
      synth: (text) => withTemp(async (file) => {
        const v = voices[detectLang(text)];
        await run('say', [...(v ? ['-v', v] : []), '-o', file, '--file-format=WAVE', `--data-format=LEI16@${SAMPLE_RATE}`, '-f', textFile(file, text)]);
        return readWav(readFileSync(file));
      }),
    };
  }
  if (which('espeak-ng')) {
    return {
      name: 'espeak-ng',
      voice: 'system',
      id: 'espeak-ng',
      concurrency: 4,
      synth: (text) => withTemp(async (file) => {
        await run('espeak-ng', ['-v', ({ zh: 'cmn', ja: 'ja' })[detectLang(text)] ?? 'en-us', '-w', file, '-f', textFile(file, text)]);
        return readWav(readFileSync(file));
      }),
    };
  }
  return null;
}

// Pick a macOS voice by language: prefer common high-quality voices, then any voice for that language.
export function macVoices() {
  return pickMacVoices(spawnSync('say', ['-v', '?'], { encoding: 'utf8' }).stdout || '');
}

// Parse the output of say -v '?'. With long names, only one space may separate the name and the language code.
export function pickMacVoices(out) {
  const list = out.split('\n').map((l) => l.match(/^(.+?)\s+([a-z]{2}_[A-Z]{2})\s+#/)).filter(Boolean).map((m) => ({ name: m[1].trim(), locale: m[2] }));
  const base = (name) => name.replace(/\s*[(（].*$/, '');
  const pick = (prefer, locale) => prefer.map((p) => list.find((v) => v.locale === locale && base(v.name) === p)).find(Boolean)?.name;
  return {
    zh: pick(['Tingting', 'Ting-Ting', 'Lilian', 'Reed', 'Flo', 'Eddy'], 'zh_CN'),
    en: pick(['Samantha', 'Alex', 'Ava', 'Allison', 'Reed', 'Flo', 'Eddy'], 'en_US'),
    ja: pick(['Kyoko', 'Otoya', 'Eddy', 'Flo'], 'ja_JP'),
  };
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new TtsError(`${cmd} failed (${code}): ${err.slice(0, 200)}`))));
  });
}

// Narration reaches the TTS program through a file, so a line starting with - is not taken as a command-line option.
function textFile(wavFile, text) {
  const p = `${wavFile}.txt`;
  writeFileSync(p, text);
  return p;
}

async function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'am-tts-'));
  try {
    return await fn(join(dir, 'out.wav'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Parse a 16-bit PCM WAV, taking the first channel of multi-channel audio. Returns { rate, samples }.
export function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new TtsError('Not a WAV file');
  let pos = 12;
  let fmt = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    if (id === 'data') {
      if (!fmt || fmt.bits !== 16) throw new TtsError('Only 16-bit PCM WAV is supported');
      const n = Math.floor(Math.min(size, buf.length - pos - 8) / 2 / fmt.channels);
      const samples = new Int16Array(n);
      for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(pos + 8 + i * 2 * fmt.channels);
      return fmt.rate === SAMPLE_RATE ? samples : resample({ rate: fmt.rate, samples });
    }
    pos += 8 + size + (size % 2);
  }
  throw new TtsError('The WAV has no data chunk');
}

// Resample to SAMPLE_RATE by linear interpolation.
function resample(input) {
  if (input instanceof Int16Array) return input;
  const { rate, samples } = input;
  const n = Math.floor((samples.length * SAMPLE_RATE) / rate);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * rate) / SAMPLE_RATE;
    const a = Math.floor(x);
    const b = Math.min(a + 1, samples.length - 1);
    out[i] = Math.round(samples[a] + (samples[b] - samples[a]) * (x - a));
  }
  return out;
}

// Synthesize all narration (with cache and a concurrency limit); returns a list of Int16Array as long as texts.
export async function synthAll(texts, provider, { cacheDir } = {}) {
  if (cacheDir) mkdirSync(cacheDir, { recursive: true });
  const results = new Array(texts.length);
  let next = 0;
  const worker = async () => {
    while (next < texts.length) {
      const i = next++;
      const file = cacheDir && join(cacheDir, `${createHash('sha1').update(`${provider.id}\n${texts[i]}`).digest('hex')}.pcm`);
      const cached = file && readCache(file);
      if (cached) {
        results[i] = cached;
        continue;
      }
      results[i] = trimSilence(await provider.synth(texts[i]));
      if (file) writeCache(file, results[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(provider.concurrency ?? 2, texts.length) }, worker));
  return results;
}

// A corrupt cache file (empty, odd byte count) counts as a miss and is synthesized again.
function readCache(file) {
  if (!existsSync(file)) return null;
  const buf = readFileSync(file);
  if (!buf.length || buf.length % 2) return null;
  return new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2).slice();
}

// Write a temp file then rename, so an interruption never leaves a partial cache file.
function writeCache(file, samples) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  renameSync(tmp, file);
}

// Trim leading/trailing silence so the visual pacing depends only on real speech.
export function trimSilence(samples, threshold = SILENCE) {
  let a = 0;
  let b = samples.length;
  while (a < b && Math.abs(samples[a]) < threshold) a++;
  while (b > a && Math.abs(samples[b - 1]) < threshold) b--;
  const pad = Math.floor(SAMPLE_RATE * 0.04);
  return samples.slice(Math.max(0, a - pad), Math.min(samples.length, b + pad));
}

// Put each line's audio on one track along the timeline and output a WAV.
export function mixTrack(clips, starts, duration) {
  const total = Math.ceil(duration * SAMPLE_RATE);
  const track = new Int16Array(total);
  clips.forEach((clip, i) => {
    const s0 = Math.round(starts[i] * SAMPLE_RATE);
    for (let j = 0; j < clip.length && s0 + j < total; j++) track[s0 + j] = clip[j];
  });
  return wav(track);
}

export function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).copy(buf, 44);
  return buf;
}
