// 旁白配音。降级顺序：ElevenLabs（有 ELEVENLABS_API_KEY 时）→ 系统 TTS（macOS say / Linux espeak-ng）→ 只出字幕。
// --voice local 改用本地 OpenAI 兼容的 /v1/audio/speech 服务（AM_TTS_URL），只在显式指定时使用。
// 每句合成结果是 22050 Hz 单声道 16 位 PCM，按文本 + 声音缓存在 AM_HOME/cache/tts/，重复渲染不再合成。
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
const ELEVEN_MODEL = 'eleven_multilingual_v2';
const ELEVEN_TIMEOUT_MS = 60000;
const LOCAL_TIMEOUT_MS = 300000;
// 本地自回归 TTS（如 Qwen3-TTS）偶尔停不下来或提前截断。实际时长 / 估算时长超出这个范围就重试，最多 LOCAL_ATTEMPTS 次。
const LOCAL_RATIO = Object.freeze([0.5, 2]);
const LOCAL_ATTEMPTS = 3;
const SILENCE = 300; // 振幅低于它算静音

export class TtsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TtsError';
  }
}

// 选出实际使用的配音方式。返回 { name, synth(text) → Int16Array } 或 null（只出字幕）。
export function pickProvider(choice, env, { platform = process.platform, which = hasCommand } = {}) {
  const eleven = () => elevenLabs(env);
  const system = () => systemVoice(platform, which);
  if (choice === 'off') return null;
  if (choice === 'elevenlabs') {
    if (!env.ELEVENLABS_API_KEY) throw new TtsError('voice=elevenlabs 需要环境变量 ELEVENLABS_API_KEY');
    return eleven();
  }
  if (choice === 'local') return localSpeech(env);
  if (choice === 'system') {
    const p = system();
    if (!p) throw new TtsError('没有找到系统 TTS：macOS 自带 say；Linux 请安装 espeak-ng');
    return p;
  }
  if (env.ELEVENLABS_API_KEY) return eleven();
  return system();
}

function elevenLabs(env) {
  const voice = env.ELEVENLABS_VOICE_ID || ELEVEN_DEFAULT_VOICE;
  return {
    name: 'elevenlabs',
    id: `elevenlabs:${voice}:${ELEVEN_MODEL}`,
    concurrency: 2,
    async synth(text) {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=pcm_${SAMPLE_RATE}`;
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
          body: JSON.stringify({ text, model_id: ELEVEN_MODEL }),
          signal: AbortSignal.timeout(ELEVEN_TIMEOUT_MS),
        });
      } catch (e) {
        throw new TtsError(`无法连接 ElevenLabs：${e.name === 'TimeoutError' ? `${ELEVEN_TIMEOUT_MS / 1000} 秒内没有响应` : e.message}`);
      }
      if (!res.ok) throw new TtsError(`ElevenLabs 返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2)).slice();
    },
  };
}

// OpenAI 兼容的语音接口：POST {AM_TTS_URL}/v1/audio/speech，要求返回 16 位 PCM WAV（一次返回整段，不分块流式）。
// AM_TTS_MODEL / AM_TTS_VOICE 对应请求里的 model / voice；AM_TTS_EXTRA 是一个 JSON 对象，并入请求体（模型专用参数），
// 但 input / response_format / stream 总由 am 决定。AM_TTS_ATTEMPTS 是每句最多合成次数，默认 3，设为 1 关闭时长检查。
function localSpeech(env) {
  if (!env.AM_TTS_URL) throw new TtsError('voice=local 需要环境变量 AM_TTS_URL（如 http://127.0.0.1:8000）');
  const url = `${env.AM_TTS_URL.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/audio/speech`;
  let extra = {};
  if (env.AM_TTS_EXTRA) {
    try {
      extra = JSON.parse(env.AM_TTS_EXTRA);
    } catch {
      extra = null;
    }
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new TtsError('AM_TTS_EXTRA 必须是 JSON 对象');
  }
  const attempts = env.AM_TTS_ATTEMPTS ? Number(env.AM_TTS_ATTEMPTS) : LOCAL_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts < 1) throw new TtsError('AM_TTS_ATTEMPTS 必须是正整数');
  const body = { ...extra, response_format: 'wav', stream: false };
  delete body.input;
  if (env.AM_TTS_MODEL) body.model = env.AM_TTS_MODEL;
  if (env.AM_TTS_VOICE) body.voice = env.AM_TTS_VOICE;
  // 请求了变速时，按变速后的语速估算时长，正常的慢速朗读不会被当成失控。
  const speed = typeof body.speed === 'number' && body.speed > 0 ? body.speed : 1;
  const request = async (text) => {
    const signal = AbortSignal.timeout(LOCAL_TIMEOUT_MS);
    const why = (e) => (signal.aborted ? `${LOCAL_TIMEOUT_MS / 1000} 秒内没有完成` : e.message);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, input: text }),
        signal,
      });
    } catch (e) {
      throw new TtsError(`无法连接本地 TTS ${url}：${why(e)}`);
    }
    let buf;
    try {
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      throw new TtsError(`读取本地 TTS 响应失败（HTTP ${res.status}）：${why(e)}`);
    }
    if (!res.ok) throw new TtsError(`本地 TTS 返回 ${res.status}：${buf.toString('utf8', 0, 200)}`);
    try {
      return readWav(buf);
    } catch (e) {
      throw new TtsError(`本地 TTS 返回的音频无法解码（需要 16 位 PCM WAV）：${e.message}`);
    }
  };
  return {
    name: 'local',
    id: `local:${url}:${attempts}:${stableJson(body)}`,
    concurrency: 1,
    async synth(text) {
      // 按去掉首尾静音后的长度判断：静音填充不能让截断的句子蒙混过关。空音频和纯静音不算结果。
      const expected = estimateSeconds(text) / speed;
      let best = null;
      for (let i = 0; i < attempts; i++) {
        const samples = trimSilence(await request(text));
        if (!samples.some((x) => Math.abs(x) >= SILENCE)) continue;
        const ratio = samples.length / SAMPLE_RATE / expected;
        if (!best || Math.abs(Math.log(ratio)) < Math.abs(Math.log(best.ratio))) best = { samples, ratio };
        if (ratio >= LOCAL_RATIO[0] && ratio <= LOCAL_RATIO[1]) break;
      }
      if (!best) throw new TtsError(`本地 TTS 连续 ${attempts} 次只返回静音`);
      return best.samples;
    },
  };
}

// 键按字母序排列的 JSON，同样的参数换个顺序写也得到同一个缓存键。
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

// 按语言挑 macOS 声音：优先常见的高质量声音，其次该语言的任意声音。
export function macVoices() {
  return pickMacVoices(spawnSync('say', ['-v', '?'], { encoding: 'utf8' }).stdout || '');
}

// 解析 say -v '?' 的输出。名字较长时，名字和语言代码之间可能只剩一个空格。
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
    p.on('close', (code) => (code === 0 ? resolve() : reject(new TtsError(`${cmd} 失败（${code}）：${err.slice(0, 200)}`))));
  });
}

// 旁白经文件传给 TTS 程序，以 - 开头的句子不会被当成命令行选项。
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

// 解析 16 位 PCM WAV，多声道取第一声道。返回 { rate, samples }。
export function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new TtsError('不是 WAV 文件');
  let pos = 12;
  let fmt = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    if (id === 'data') {
      if (!fmt || fmt.bits !== 16) throw new TtsError('只支持 16 位 PCM WAV');
      const n = Math.floor(Math.min(size, buf.length - pos - 8) / 2 / fmt.channels);
      const samples = new Int16Array(n);
      for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(pos + 8 + i * 2 * fmt.channels);
      return fmt.rate === SAMPLE_RATE ? samples : resample({ rate: fmt.rate, samples });
    }
    pos += 8 + size + (size % 2);
  }
  throw new TtsError('WAV 缺少 data 块');
}

// 线性插值重采样到 SAMPLE_RATE。
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

// 合成全部旁白（带缓存与并发上限），返回与 texts 等长的 Int16Array 列表。
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

// 缓存文件损坏（空文件、奇数字节）时视为未命中，重新合成。
function readCache(file) {
  if (!existsSync(file)) return null;
  const buf = readFileSync(file);
  if (!buf.length || buf.length % 2) return null;
  return new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2).slice();
}

// 先写临时文件再改名，中断时不会留下半截缓存。
function writeCache(file, samples) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  renameSync(tmp, file);
}

// 去掉首尾静音，让画面节奏只由真实语音决定。
export function trimSilence(samples, threshold = SILENCE) {
  let a = 0;
  let b = samples.length;
  while (a < b && Math.abs(samples[a]) < threshold) a++;
  while (b > a && Math.abs(samples[b - 1]) < threshold) b--;
  const pad = Math.floor(SAMPLE_RATE * 0.04);
  return samples.slice(Math.max(0, a - pad), Math.min(samples.length, b + pad));
}

// 把各句音频按时间轴放进一条音轨，输出 WAV。
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
