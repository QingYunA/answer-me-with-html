// The built-in encoder for the export path that has no ffmpeg: the CLI drives window.render(t), screenshots every
// frame and sends the JPEG here; WebCodecs encodes the picture, the narration in the page is encoded too, and the CLI
// collects the chunks and writes the WebM file (src/video/webm.js). The script is injected into the player page at
// export time only, so a page that is merely watched does not carry it.
//
// Every chunk leaves as one record: kind (1 video, 2 audio), flags (bit 0: key frame), timestamp in microseconds as a
// float64, payload length as a uint32, then the payload. The CLI parses the same layout.
(() => {
  const HEADER = 14;
  const AUDIO_FRAME_SECONDS = 0.02;   // Opus encodes 20 ms frames
  const CODECS = ['vp09.00.31.08', 'vp09.00.10.08', 'vp8'];

  const queue = [];
  let video = null;
  let audio = null;
  let fps = 30;
  let error = null;
  let frames = 0;
  let audioChunks = 0;

  const fail = (e) => {
    if (!error) error = String((e && e.message) || e);
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const fromBase64 = (s) => {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  // btoa needs a string, and one built with fromCharCode cannot be too long for the argument list.
  const toBase64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const asBytes = (x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : new Uint8Array(x.buffer, x.byteOffset, x.byteLength));

  function push(kind, key, tsUs, data) {
    const rec = new Uint8Array(HEADER + data.byteLength);
    const view = new DataView(rec.buffer);
    view.setUint8(0, kind);
    view.setUint8(1, key ? 1 : 0);
    view.setFloat64(2, tsUs, true);
    view.setUint32(10, data.byteLength, true);
    rec.set(data, HEADER);
    queue.push(rec);
  }

  // The codec names differ in the level they claim; take the first the browser really encodes.
  async function pickCodec(config) {
    for (const codec of CODECS) {
      try {
        if ((await VideoEncoder.isConfigSupported({ ...config, codec })).supported) return codec;
      } catch {
        // an unknown codec string is not an error, try the next one
      }
    }
    throw new Error('This browser encodes neither VP9 nor VP8');
  }

  async function init(cfg) {
    fps = cfg.fps;
    const config = { width: cfg.width, height: cfg.height, bitrate: cfg.bitrate, framerate: cfg.fps, latencyMode: 'quality' };
    const codec = await pickCodec(config);
    video = new VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        push(1, chunk.type === 'key', chunk.timestamp, data);
        frames++;
      },
      error: fail,
    });
    video.configure({ ...config, codec });
    return { codec };
  }

  async function frame(base64, tsUs, key) {
    const bitmap = await createImageBitmap(new Blob([fromBase64(base64)], { type: 'image/jpeg' }));
    const picture = new VideoFrame(bitmap, { timestamp: tsUs, duration: Math.round(1e6 / fps) });
    video.encode(picture, { keyFrame: Boolean(key) });
    picture.close();
    bitmap.close();
    // A software encoder runs slower than the frames arrive; keep the queue short instead of piling frames up.
    while (video.encodeQueueSize > 8 && !error) await wait(2);
    if (error) throw new Error(error);
    return { frames, queued: video.encodeQueueSize };
  }

  // The narration the page already carries, encoded from the WAV in the <audio> element: no bytes travel twice.
  async function addAudio() {
    const el = document.getElementById('amv-audio');
    const src = el?.getAttribute('src') ?? '';
    const comma = src.indexOf(',');
    if (!src.startsWith('data:') || comma < 0) return null;
    const wav = fromBase64(src.slice(comma + 1));
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const tag = (o) => String.fromCharCode(wav[o], wav[o + 1], wav[o + 2], wav[o + 3]);
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('The narration track is not a WAV file');
    let format = null;
    let pcm = null;
    for (let o = 12; o + 8 <= wav.byteLength;) {
      const id = tag(o);
      const len = view.getUint32(o + 4, true);
      if (id === 'fmt ') format = { channels: view.getUint16(o + 10, true), sampleRate: view.getUint32(o + 12, true), bits: view.getUint16(o + 22, true) };
      else if (id === 'data') pcm = { at: o + 8, len };
      o += 8 + len + (len % 2);
    }
    if (!format || !pcm || format.bits !== 16) throw new Error('The narration track must be 16-bit PCM WAV');
    const { channels, sampleRate } = format;

    let head = null;
    audio = new AudioEncoder({
      output: (chunk, meta) => {
        if (!head && meta?.decoderConfig?.description) head = asBytes(meta.decoderConfig.description).slice();
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        push(2, false, chunk.timestamp, data);
        audioChunks++;
      },
      error: fail,
    });
    audio.configure({ codec: 'opus', sampleRate, numberOfChannels: channels, bitrate: 64000 * channels });
    const perBlock = Math.round(sampleRate * AUDIO_FRAME_SECONDS);
    const total = Math.floor(pcm.len / (2 * channels));
    for (let i = 0; i < total; i += perBlock) {
      const samples = perBlock * channels;
      const bytes = new Uint8Array(samples * 2);   // zero filled: a short last block becomes a full Opus frame
      const from = pcm.at + i * channels * 2;
      bytes.set(wav.subarray(from, from + Math.min(samples, (total - i) * channels) * 2));
      const data = new AudioData({
        format: 's16', sampleRate, numberOfFrames: perBlock, numberOfChannels: channels,
        timestamp: Math.round((i / sampleRate) * 1e6), data: bytes,
      });
      audio.encode(data);
      data.close();
      while (audio.encodeQueueSize > 16 && !error) await wait(2);
    }
    if (error) throw new Error(error);
    return { head: head ? toBase64(head) : '', channels, sampleRate, chunks: audioChunks };
  }

  async function finish() {
    if (video) { await video.flush(); video.close(); video = null; }
    if (audio) { await audio.flush(); audio.close(); audio = null; }
    if (error) throw new Error(error);
    return { frames, audioChunks };
  }

  // Hand the CLI the next slice of encoded data; it writes the container while the encoder keeps working.
  function pull(maxBytes) {
    if (error) return { error };
    const parts = [];
    let bytes = 0;
    while (queue.length && bytes < maxBytes) {
      const rec = queue.shift();
      parts.push(rec);
      bytes += rec.byteLength;
    }
    if (!parts.length) return { data: '', bytes: 0 };
    const all = new Uint8Array(bytes);
    let at = 0;
    for (const part of parts) {
      all.set(part, at);
      at += part.byteLength;
    }
    return { data: toBase64(all), bytes };
  }

  window.__amvEnc = {
    supported: () => typeof VideoEncoder === 'function' && typeof AudioEncoder === 'function',
    init,
    frame,
    audio: addAudio,
    finish,
    pull,
    stats: () => ({ error, frames, audioChunks, queued: queue.length }),
  };
})();
