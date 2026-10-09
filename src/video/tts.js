// Narration voice-over. Fallback order: ElevenLabs (with ELEVENLABS_API_KEY) → system TTS (macOS say / Linux espeak-ng) → captions only.
// --voice local uses a local OpenAI-compatible /v1/audio/speech service (AM_TTS_URL) instead, only when given explicitly.
// Each line is synthesized as 22050 Hz mono 16-bit PCM and cached by text + voice in AM_HOME/cache/tts/, so re-renders do not synthesize again.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasCommand } from '../sys.js';
import { baseLanguage, voiceHints } from '../language.js';
import { estimateSeconds } from './script.js';

export const SAMPLE_RATE = 22050;
const ELEVEN_DEFAULT_VOICE = 'bIHbv24MWmeRgasZH58o'; // Will: a premade voice, so it works on the free plan; ElevenLabs lists zh as verified
const ELEVEN_DEFAULT_MODEL = 'eleven_v4_turbo';
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
          // No language_code: the API ignores it for the models that do not support it (multilingual_v2 is documented as
          // not supporting it) and every model reads the language from the text, so one voice reads every line.
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
      id: 'say',
      concurrency: 4,
      usesLanguage: true,
      // The voice this machine has for a line's language, or null: the line then keeps its caption instead of being read
      // by a voice for another language.
      voiceFor: (language) => macVoiceFor(voices, language),
      // A caller that does not say which language a line is in (languageOf is optional) gets the system default voice.
      synth: (text, { voice } = {}) => withTemp(async (file) => {
        await run('say', [...(voice ? ['-v', voice] : []), '-o', file, '--file-format=WAVE', `--data-format=LEI16@${SAMPLE_RATE}`, '-f', textFile(file, text)]);
        return readWav(readFileSync(file));
      }),
    };
  }
  if (which('espeak-ng')) {
    const voices = espeakVoices();
    return {
      name: 'espeak-ng',
      voice: 'system',
      id: 'espeak-ng',
      concurrency: 4,
      usesLanguage: true,
      voiceFor: (language) => espeakVoiceFor(voices, language),
      // A caller that does not say which language a line is in gets the English voice, which every espeak-ng build has.
      synth: (text, { voice } = {}) => withTemp(async (file) => {
        await run('espeak-ng', ['-v', voice ?? 'en-us', '-w', file, '-f', textFile(file, text)]);
        return readWav(readFileSync(file));
      }),
    };
  }
  return null;
}

// The installed macOS voices, read once when the provider is created; `say -v '?'` writes one line per voice.
export function macVoices() {
  return parseMacVoices(spawnSync('say', ['-v', '?'], { encoding: 'utf8' }).stdout || '');
}

// The installed espeak-ng voices, read once when the provider is created; `espeak-ng --voices` prints a table whose
// second column is the voice name.
export function espeakVoices() {
  return parseEspeakVoices(spawnSync('espeak-ng', ['--voices'], { encoding: 'utf8' }).stdout || '');
}

// Parse the output of `say -v '?'`: name, locale, then a sample after `#`. macOS writes the Chinese name of some voices in
// brackets after the name, so a long name may be separated from the locale by a single space. A region is usually two
// letters (`zh_TW`) but may be digits (`ar_001`, `es_419`).
export function parseMacVoices(out) {
  return out
    .split('\n')
    .map((l) => l.match(/^(.+?)\s+([a-z]{2,3}[_-][A-Za-z0-9]{2,4})\s+#/))
    .filter(Boolean)
    .map((m) => ({ name: m[1].trim(), locale: m[2] }));
}

// Parse the output of `espeak-ng --voices`: `Pty Language …`, so the name is the column after the priority.
export function parseEspeakVoices(out) {
  return out
    .split('\n')
    .map((l) => l.match(/^\s*\d+\s+(\S+)\s/))
    .filter(Boolean)
    .map((m) => m[1]);
}

// Among the voices of one locale, macOS ships an everyday voice for the language, and also novelty voices (Albert,
// Bells, Zarvox…) that carry en_US and would otherwise win by sorting first.
const PREFERRED_VOICES = {
  zh: ['Tingting', 'Ting-Ting', 'Meijia', 'Sinji'],
  en: ['Samantha', 'Alex', 'Daniel', 'Ava'],
  ja: ['Kyoko', 'Otoya'],
};

// Voices macOS shares between many languages. They read the language, but a voice of the language itself is nicer, so
// they are used only when the language has no voice of its own (Korean would otherwise be read by Eddy, not Yuna).
const SHARED_VOICES = new Set(['Eddy', 'Flo', 'Grandma', 'Grandpa', 'Reed', 'Rocko', 'Sandy', 'Shelley']);

// The voice to read a language with: the locale of the tag itself, then the region the tag leaves out (`fr` -> fr_FR,
// which macOS has and fr_CA does not), then the locale its language file names (a Taiwan voice for Traditional Chinese,
// which has no region in its tag), then any installed voice of the same language. null when the machine has none of
// them: the line keeps its caption. A machine that listed no voice at all reads with its own default voice.
export function macVoiceFor(voices, language) {
  if (!voices.length) return '';
  const base = baseLanguage(language);
  const implied = new Intl.Locale(language).maximize();
  const named = voiceHints(language)?.say;
  const wanted = [language, implied.region && `${implied.language}-${implied.region}`, named].filter(Boolean).map(localeKey);
  for (const locale of new Set(wanted)) {
    const voice = bestVoice(voices.filter((v) => localeKey(v.locale) === locale), base);
    if (voice) return voice;
  }
  return bestVoice(voices.filter((v) => localeKey(v.locale).split('_')[0] === base), base);
}

// The espeak-ng voice to read a language with: the name its language file gives (espeak-ng lists Mandarin as `cmn`, not
// `zh`), otherwise the language itself. null when espeak-ng has no voice for the language, so the line keeps its caption.
export function espeakVoiceFor(voices, language) {
  const base = baseLanguage(language);
  const name = voiceHints(language)?.espeak ?? base;
  // espeak-ng lists English and French as en-us / fr-fr and the like, so a voice is installed when the name, the language
  // itself or a variant of it is listed. An unreadable list (the command failed) is not taken as "nothing installed".
  if (!voices.length) return name;
  const installed = voices.includes(name) || voices.includes(base) || voices.some((v) => v.startsWith(`${base}-`));
  return installed ? name : null;
}

const localeKey = (locale) => String(locale).toLowerCase().replace(/-/g, '_');

function bestVoice(candidates, base) {
  if (!candidates.length) return null;
  for (const name of PREFERRED_VOICES[base] ?? []) {
    const hit = candidates.find((v) => stripName(v.name) === name);
    if (hit) return hit.name;
  }
  const own = candidates.filter((v) => !SHARED_VOICES.has(stripName(v.name)));
  return (own[0] ?? candidates[0]).name;
}

// A voice name may carry the Chinese translation of its name in brackets, after the name itself.
const stripName = (name) => name.replace(/\s*[(（].*$/, '');

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

// Synthesize all narration (with cache and a concurrency limit); returns a list as long as texts, holding an Int16Array
// per line, or null for a line whose language the voice has no voice for (the line keeps its caption, and the caller
// estimates its duration).
// languageOf(text) is the language to read a line in; only a voice marked usesLanguage (the system voices) gets it, and for it the
// language and the chosen voice are part of the cache key. The cache of the other voices (ElevenLabs, a local server) does not
// change with the language.
export async function synthAll(texts, provider, { cacheDir, languageOf } = {}) {
  if (cacheDir) mkdirSync(cacheDir, { recursive: true });
  const results = new Array(texts.length);
  let next = 0;
  const worker = async () => {
    while (next < texts.length) {
      const i = next++;
      const language = provider.usesLanguage ? languageOf?.(texts[i]) : undefined;
      // A voice picked by language (a system voice) answers null for a language it has no voice for: the line stays silent
      // rather than being read by a voice for another language. '' means the voice's own default (a machine that listed no
      // voice at all), and no language at all leaves the default too.
      const voice = language && provider.voiceFor ? provider.voiceFor(language) : undefined;
      if (language && provider.voiceFor && voice === null) {
        results[i] = null;
        continue;
      }
      // The key holds the voice that was actually chosen, so picking or installing another voice for a language does not
      // reuse the clips the old one produced.
      const key = `${provider.id}${voice ? `:${voice}` : ''}${language ? `\n${language}` : ''}\n${texts[i]}`;
      const file = cacheDir && join(cacheDir, `${createHash('sha1').update(key).digest('hex')}.pcm`);
      const cached = file && readCache(file);
      if (cached) {
        results[i] = cached;
        continue;
      }
      results[i] = trimSilence(await provider.synth(texts[i], { language, voice }));
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
    if (!clip) return;
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
