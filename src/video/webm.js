// Minimal WebM (Matroska) writer for the export path that has no ffmpeg: the browser encodes the frames (WebCodecs,
// see src/runtime/video.js) and this module writes the container. One VP8/VP9 video track and an optional Opus audio
// track. The blocks are buffered, sorted by time and cut into clusters of about a second, so the sound and the
// picture of a moment sit next to each other in the file. The Segment and the Clusters carry the unknown size, which
// is how a stream is written: nothing needs to be measured first and nothing is patched afterwards.
// Plain bytes only (no Buffer, no imports), so the same source runs in Node and inside a page (scripts/inline-assets.mjs
// turns it into a script for the player page).
const APP = 'answer-me-with-html';   // MuxingApp / WritingApp
const CLUSTER_MS = 1000;              // how much time one cluster holds
const SEEK_PRE_ROLL_NS = 80_000_000;  // what the Opus specification asks for

const ID = {
  EBML: [0x1a, 0x45, 0xdf, 0xa3],
  EBMLVersion: [0x42, 0x86], EBMLReadVersion: [0x42, 0xf7], EBMLMaxIDLength: [0x42, 0xf2], EBMLMaxSizeLength: [0x42, 0xf3],
  DocType: [0x42, 0x82], DocTypeVersion: [0x42, 0x87], DocTypeReadVersion: [0x42, 0x85],
  Segment: [0x18, 0x53, 0x80, 0x67], Info: [0x15, 0x49, 0xa9, 0x66], TimecodeScale: [0x2a, 0xd7, 0xb1],
  MuxingApp: [0x4d, 0x80], WritingApp: [0x57, 0x41], Duration: [0x44, 0x89],
  Tracks: [0x16, 0x54, 0xae, 0x6b], TrackEntry: [0xae], TrackNumber: [0xd7], TrackUID: [0x73, 0xc5], FlagLacing: [0x9c],
  CodecID: [0x86], TrackType: [0x83], Video: [0xe0], PixelWidth: [0xb0], PixelHeight: [0xba],
  Audio: [0xe1], SamplingFrequency: [0xb5], Channels: [0x9f], CodecPrivate: [0x63, 0xa2],
  CodecDelay: [0x56, 0xaa], SeekPreRoll: [0x56, 0xbb],
  Cluster: [0x1f, 0x43, 0xb6, 0x75], Timecode: [0xe7], SimpleBlock: [0xa3],
};
const UNKNOWN_SIZE = new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

const concat = (parts) => {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const bytes = (id) => new Uint8Array(id);
const text = (s) => new TextEncoder().encode(s);

// Element size as a variable-size integer, in the shortest length that fits; the all-ones value is reserved.
function size(n) {
  for (let len = 1; len <= 8; len++) {
    if (len === 8 || n < 2 ** (7 * len) - 1) {
      const out = new Uint8Array(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) {
        out[i] = v & 0xff;
        v = Math.floor(v / 256);
      }
      out[0] |= 0x80 >> (len - 1);
      return out;
    }
  }
}

// Unsigned integer, big endian, as short as it can be (a Matroska integer drops leading zero bytes).
function uint(n) {
  const out = [];
  let v = Math.round(n);
  do {
    out.unshift(v & 0xff);
    v = Math.floor(v / 256);
  } while (v > 0);
  return new Uint8Array(out);
}

function f64(x) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, x);
  return out;
}

const elem = (id, payload) => concat([bytes(id), size(payload.length), payload]);

// WebM writer. video: { width, height, codec } with codec 'V_VP9' or 'V_VP8'; audio: null or
// { channels, codecPrivate, preSkipSamples }. Duration is written up front, so a player knows the length at once.
export class WebmWriter {
  constructor({ width, height, durationMs, videoCodec = 'V_VP9', audio = null }) {
    this.width = width;
    this.height = height;
    this.durationMs = durationMs;
    this.videoCodec = videoCodec;
    this.audio = audio;
    this.blocks = [];
  }

  // track 1 is the picture, track 2 the sound. key marks a key frame; tsUs is the time in microseconds.
  block({ track, key, tsUs, data }) {
    this.blocks.push({ track, key: Boolean(key), ms: Math.round(tsUs / 1000), data });
  }

  count(track) {
    return this.blocks.reduce((n, b) => n + (b.track === track ? 1 : 0), 0);
  }

  build() {
    const parts = [
      elem(ID.EBML, concat([
        elem(ID.EBMLVersion, uint(1)),
        elem(ID.EBMLReadVersion, uint(1)),
        elem(ID.EBMLMaxIDLength, uint(4)),
        elem(ID.EBMLMaxSizeLength, uint(8)),
        elem(ID.DocType, text('webm')),
        elem(ID.DocTypeVersion, uint(4)),
        elem(ID.DocTypeReadVersion, uint(2)),
      ])),
      concat([bytes(ID.Segment), UNKNOWN_SIZE]),
      elem(ID.Info, concat([
        elem(ID.TimecodeScale, uint(1_000_000)),
        elem(ID.MuxingApp, text(APP)),
        elem(ID.WritingApp, text(APP)),
        elem(ID.Duration, f64(this.durationMs)),
      ])),
      elem(ID.Tracks, concat([this.#videoTrack(), ...(this.audio ? [this.#audioTrack()] : [])])),
    ];
    for (const cluster of this.#clusters()) parts.push(cluster);
    return concat(parts);
  }

  #track(num, type, codecId, extra) {
    return elem(ID.TrackEntry, concat([
      elem(ID.TrackNumber, uint(num)),
      elem(ID.TrackUID, uint(num)),
      elem(ID.FlagLacing, uint(0)),
      elem(ID.CodecID, text(codecId)),
      elem(ID.TrackType, uint(type)),
      ...extra,
    ]));
  }

  #videoTrack() {
    return this.#track(1, 1, this.videoCodec, [
      elem(ID.Video, concat([elem(ID.PixelWidth, uint(this.width)), elem(ID.PixelHeight, uint(this.height))])),
    ]);
  }

  #audioTrack() {
    const { channels, codecPrivate, preSkipSamples } = this.audio;
    const extra = [elem(ID.Audio, concat([elem(ID.SamplingFrequency, f64(48000)), elem(ID.Channels, uint(channels))]))];
    if (codecPrivate) extra.unshift(elem(ID.CodecPrivate, codecPrivate));
    // The encoder adds pre-skip samples of silence; CodecDelay tells the player to drop them again.
    extra.push(elem(ID.CodecDelay, uint((preSkipSamples / 48000) * 1e9)), elem(ID.SeekPreRoll, uint(SEEK_PRE_ROLL_NS)));
    return this.#track(2, 2, 'A_OPUS', extra);
  }

  #clusters() {
    const blocks = [...this.blocks].sort((a, b) => a.ms - b.ms || a.track - b.track);
    const out = [];
    for (let i = 0; i < blocks.length; ) {
      const start = blocks[i].ms;
      const body = [elem(ID.Timecode, uint(start))];
      while (i < blocks.length && blocks[i].ms - start <= CLUSTER_MS) {
        body.push(this.#block(blocks[i], start));
        i++;
      }
      out.push(concat([bytes(ID.Cluster), UNKNOWN_SIZE, ...body]));
    }
    return out;
  }

  #block(b, clusterStart) {
    const head = new Uint8Array(4);
    head[0] = 0x80 | b.track;                 // the track number as a variable-size integer
    new DataView(head.buffer).setInt16(1, b.ms - clusterStart);
    head[3] = b.key ? 0x80 : 0x00;
    return elem(ID.SimpleBlock, concat([head, b.data]));
  }
}
