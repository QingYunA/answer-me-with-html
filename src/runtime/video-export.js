// The export engine for the path that has no ffmpeg: the player page drives its own render(t), rasterizes the stage
// into a canvas, encodes the picture and the narration with WebCodecs and muxes the WebM container with the writer
// from src/video/webm.js (injected ahead of this script as window.__amvWebm). Every video page carries it: the export
// button in the controls drives it, and `am video --mp4` drives the same code through the DevTools protocol.
//
// The page hands out the finished file in slices (window.__amvEnc.bytes(at, len), base64) so no bytes travel twice.
(() => {
  const W = 1920;
  const H = 1080;
  const CODECS = ['vp09.00.31.08', 'vp09.00.10.08', 'vp8'];   // the first one the browser really encodes
  const AUDIO_FRAME_SECONDS = 0.02;    // Opus encodes 20 ms frames
  const KEY_SECONDS = 5;               // a key frame every 5 s, so seeking stays cheap
  const BITRATE = 3_500_000;           // VP9 at 1080p30: flat slides stay clean at this rate
  const QUEUE_LIMIT = 8;               // frames in flight; a software encoder runs slower than the page renders

  const state = { running: false, done: 0, total: 0, error: null, bytes: null, codec: '', audio: false, cancel: false };

  const yieldToPage = () => new Promise((r) => {
    // A timer is clamped in a hidden tab; a message port keeps the export running at full speed in the background.
    const ch = new MessageChannel();
    ch.port1.onmessage = () => r();
    ch.port2.postMessage(0);
  });

  const asBytes = (x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : new Uint8Array(x.buffer, x.byteOffset, x.byteLength));

  // ── Rasterizing: the stage, with every node's computed style copied into the SVG ──
  // The clone needs the styles inline: an <img> of an SVG that embeds the page's own stylesheets does not lay out the
  // page the same way (the fixed-position chain and the html/body height rules break). Computed styles are exact and
  // cost about 300 ms for the whole stage, so unchanged nodes keep their string from the previous frame: the player
  // changes only a handful of nodes per frame (14 of 261 measured on a five-scene video).
  // A pseudo-element is not a node, so the clone cannot carry it and the SVG has no stylesheet that could draw it: the
  // tree and timeline connectors, the annotation brackets and the drawing sheet's inner frame are all ::before / ::after
  // boxes, and without them the exported picture differs from the player. The computed style of each one is read from
  // the live element and put on a real span that opens (::before) or closes (::after) the clone's children. The spans
  // are cached with the element's own entry, so an unchanged frame only re-clones them.
  const styles = new Map();
  const PSEUDOS = ['::before', '::after'];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  const image = new Image();
  let stageEl = null;

  // The picture is always 1920x1080: the stage is pinned at the top left of the SVG and the fit transform the player
  // applies to the live stage (translate + scale) is dropped, so the frame does not depend on the window size.
  const PIN = `;position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform:none;`;

  function styleOf(cs) {
    let out = '';
    for (let i = 0; i < cs.length; i++) {
      const name = cs[i];
      if (name === 'content') continue;   // generated content belongs to the stand-in span's text, not to its style
      out += `${name}:${cs.getPropertyValue(name)};`;
    }
    return out;
  }

  // What the cache entry of one node is keyed on: every attribute decides the node's computed style and what its
  // pseudo-elements print (a code line number reads attr(data-n)), and a change anywhere above a node changes it too.
  function signature(el) {
    let out = '';
    for (const attr of el.attributes) out += `${attr.name}=${attr.value}\u0001`;
    return out;
  }

  // The text a pseudo-element prints: a CSS string such as "" or "→ ", or attr(name) as the browser substitutes it.
  function pseudoText(src, content) {
    let text = '';
    for (const part of content.matchAll(/"((?:[^"\\]|\\.)*)"|attr\(\s*([-\w]+)\s*\)/g)) {
      if (part[2] !== undefined) text += src.getAttribute(part[2]) ?? '';
      else text += part[1].replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_, hex, ch) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : ch));
    }
    return text;
  }

  // The span that stands in for one pseudo-element, or null when the browser generates no box for it.
  function pseudoSpan(src, pseudo) {
    const cs = getComputedStyle(src, pseudo);
    const content = cs.getPropertyValue('content');
    if (!content || content === 'none' || content === 'normal' || cs.display === 'none') return null;
    const span = document.createElement('span');
    span.setAttribute('style', styleOf(cs));
    span.textContent = pseudoText(src, content);
    return span;
  }

  function stageSvg(stage) {
    const animated = new Set();
    for (const anim of document.getAnimations()) {
      const target = anim.effect && anim.effect.target;
      if (target) animated.add(target);
    }
    const clone = stage.cloneNode(true);
    const stamp = `${window.innerWidth}x${window.innerHeight}`;
    let recomputed = 0;
    const walk = (src, dst, parentSign) => {
      const sign = `${parentSign}\u0001${signature(src)}${animated.has(src) ? '\u0001a' : ''}`;
      let entry = styles.get(src);
      if (!entry || entry.sign !== sign) {
        entry = { sign, text: styleOf(getComputedStyle(src)) + (src === stage ? PIN : ''), pseudo: PSEUDOS.map((pseudo) => pseudoSpan(src, pseudo)) };
        styles.set(src, entry);
        recomputed++;
      }
      dst.setAttribute('style', entry.text);
      const before = entry.pseudo[0] && entry.pseudo[0].cloneNode(true);
      const after = entry.pseudo[1] && entry.pseudo[1].cloneNode(true);
      if (before) dst.insertBefore(before, dst.firstChild);
      if (after) dst.appendChild(after);
      const a = src.children;
      const b = dst.children;
      const shift = before ? 1 : 0;
      for (let i = 0; i < a.length; i++) walk(a[i], b[i + shift], sign);
    };
    walk(stage, clone, stamp);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">${new XMLSerializer().serializeToString(clone)}</foreignObject></svg>`;
    return { svg, recomputed };
  }

  async function paint(stage) {
    const { svg } = stageSvg(stage);
    // A data URL keeps the canvas origin clean; a blob URL taints it and the encoder then refuses the frame.
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(image, 0, 0, W, H);
  }

  // ── The narration the page already carries: encoded from the WAV the player holds as a data URL ──
  function readWav() {
    const el = document.getElementById('amv-audio');
    const src = (el && el.getAttribute('src')) || '';
    const comma = src.indexOf(',');
    if (!src.startsWith('data:') || comma < 0) return null;
    const bin = atob(src.slice(comma + 1));
    const wav = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) wav[i] = bin.charCodeAt(i);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const tag = (o) => String.fromCharCode(wav[o], wav[o + 1], wav[o + 2], wav[o + 3]);
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('the narration track is not a WAV file');
    let format = null;
    let pcm = null;
    for (let o = 12; o + 8 <= wav.byteLength;) {
      const id = tag(o);
      const len = view.getUint32(o + 4, true);
      if (id === 'fmt ') format = { channels: view.getUint16(o + 10, true), sampleRate: view.getUint32(o + 12, true), bits: view.getUint16(o + 22, true) };
      else if (id === 'data') pcm = { at: o + 8, len };
      o += 8 + len + (len % 2);
    }
    if (!format || !pcm || format.bits !== 16) throw new Error('the narration track must be 16-bit PCM WAV');
    return { wav, pcm, ...format };
  }

  async function encodeAudio(writer) {
    const sound = readWav();
    if (!sound) return false;
    const { wav, pcm, channels, sampleRate } = sound;
    let head = null;
    const audio = new AudioEncoder({
      output(chunk, meta) {
        if (!head && meta && meta.decoderConfig && meta.decoderConfig.description) head = asBytes(meta.decoderConfig.description).slice();
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        writer.block({ track: 2, key: false, tsUs: chunk.timestamp, data });
      },
      error(e) { state.error = String((e && e.message) || e); },
    });
    audio.configure({ codec: 'opus', sampleRate, numberOfChannels: channels, bitrate: 64000 * channels });
    const perBlock = Math.round(sampleRate * AUDIO_FRAME_SECONDS);
    const total = Math.floor(pcm.len / (2 * channels));
    for (let i = 0; i < total; i += perBlock) {
      const samples = perBlock * channels;
      const data = new Uint8Array(samples * 2);   // zero filled: a short last block becomes a full Opus frame
      const from = pcm.at + i * channels * 2;
      data.set(wav.subarray(from, from + Math.min(samples, (total - i) * channels) * 2));
      const block = new AudioData({
        format: 's16', sampleRate, numberOfFrames: perBlock, numberOfChannels: channels,
        timestamp: Math.round((i / sampleRate) * 1e6), data,
      });
      audio.encode(block);
      block.close();
      while (audio.encodeQueueSize > 16 && !state.error) await yieldToPage();
      if (state.cancel) break;
    }
    await audio.flush();
    audio.close();
    if (state.error) throw new Error(state.error);
    // The encoder adds pre-skip samples of silence; CodecDelay makes the player drop them again.
    const preSkip = head && head.length >= 19 ? new DataView(head.buffer, head.byteOffset, head.byteLength).getUint16(10, true) : 312;
    if (!head || head.length < 19) {
      head = new Uint8Array(19);
      head.set(new TextEncoder().encode('OpusHead'), 0);
      head[8] = 1;
      head[9] = channels;
      new DataView(head.buffer).setUint16(10, 312, true);
      new DataView(head.buffer).setUint32(12, sampleRate, true);
    }
    writer.audio = { channels, codecPrivate: head, preSkipSamples: preSkip };
    return true;
  }

  // ── The whole export, run inside this page ──
  // start() only validates and kicks the work off: the caller polls progress() and then asks for the bytes, so the
  // DevTools protocol never has to wait minutes for one call to come back.
  function start(options = {}) {
    if (state.running) return { error: 'an export is already running' };
    const api = window.__amv;
    const Mux = window.__amvWebm && window.__amvWebm.WebmWriter;
    if (!Mux) return { error: 'the WebM writer is missing from this page' };
    if (typeof VideoEncoder !== 'function' || typeof AudioEncoder !== 'function') {
      return { error: 'this browser cannot encode video (WebCodecs is missing)' };
    }
    Object.assign(state, { running: true, done: 0, total: Math.ceil(api.duration * api.fps), error: null, bytes: null, cancel: false });
    run(Mux, options).catch((e) => { state.error = String((e && e.message) || e); }).finally(() => { state.running = false; styles.clear(); });
    return { total: state.total, fps: api.fps, duration: api.duration };
  }

  async function run(Mux, options) {
    const api = window.__amv;
    const fps = api.fps;
    const total = state.total;
    const config = { width: W, height: H, bitrate: options.bitrate || BITRATE, framerate: fps, latencyMode: 'quality' };
    let codec = null;
    for (const candidate of CODECS) {
      try {
        if ((await VideoEncoder.isConfigSupported({ ...config, codec: candidate })).supported) { codec = candidate; break; }
      } catch {
        // an unknown codec string is not an error, try the next one
      }
    }
    if (!codec) throw new Error('this browser encodes neither VP9 nor VP8');
    state.codec = codec;

    const writer = new Mux({ width: W, height: H, durationMs: api.duration * 1000, videoCodec: codec.startsWith('vp8') ? 'V_VP8' : 'V_VP9' });
    state.audio = await encodeAudio(writer);
    if (state.cancel) throw new Error('cancelled');

    // The player keeps its own clock; the export poses every frame itself, so playback is paused first.
    api.pauseForExport();
    stageEl = stageEl || document.querySelector('.amv-stage');
    const video = new VideoEncoder({
      output(chunk) {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        writer.block({ track: 1, key: chunk.type === 'key', tsUs: chunk.timestamp, data });
      },
      error(e) { state.error = String((e && e.message) || e); },
    });
    video.configure({ ...config, codec });
    const keyEvery = Math.max(1, Math.round(fps * KEY_SECONDS));
    for (let i = 0; i < total; i++) {
      if (state.cancel) { video.close(); throw new Error('cancelled'); }
      if (state.error) throw new Error(state.error);
      window.render(i / fps);
      await paint(stageEl);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i / fps) * 1e6), duration: Math.round(1e6 / fps) });
      video.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      state.done = i + 1;
      if (video.encodeQueueSize > QUEUE_LIMIT || i % 5 === 0) await yieldToPage();
    }
    await video.flush();
    video.close();
    if (state.error) throw new Error(state.error);
    state.bytes = writer.build();
  }

  const base64 = (from, to) => {
    let out = '';
    for (let i = from; i < to; i += 0x8000) out += String.fromCharCode.apply(null, state.bytes.subarray(i, Math.min(to, i + 0x8000)));
    return btoa(out);
  };

  window.__amvEnc = {
    supported() {
      return typeof VideoEncoder === 'function' && typeof AudioEncoder === 'function' && Boolean(window.__amvWebm && window.__amvWebm.WebmWriter);
    },
    start,
    progress() {
      return { running: state.running, done: state.done, total: state.total, error: state.error, audio: state.audio, codec: state.codec };
    },
    // The caller asks for the file in slices: one big string would travel badly over a debugger protocol.
    size() { return state.bytes ? state.bytes.length : 0; },
    bytes(from, len) { return state.bytes ? base64(from, Math.min(from + len, state.bytes.length)) : ''; },
    cancel() { state.cancel = true; },
  };
})();
