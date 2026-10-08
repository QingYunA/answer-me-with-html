// The WebM writer behind the export path that has no ffmpeg, checked by reading the container back. A player is the
// final judge (test/export.test.js plays the file in Chrome), but the structure can be verified here in milliseconds:
// the header, the two tracks, the cluster timecodes and the block order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebmWriter } from '../src/video/webm.js';

const hex = (id) => Buffer.from(id, 'hex');
const OPUS_HEAD = Buffer.from('OpusHead\x01\x01\x38\x01\x44\xac\x00\x00\x00', 'binary');

function readId(buf, at) {
  let len = 1;
  while (len <= 4 && (buf[at] & (0x80 >> (len - 1))) === 0) len++;
  return { id: buf.toString('hex', at, at + len), len };
}

// Element sizes are variable-size integers; the all-ones value means "unknown" (a stream that is still being written).
function readSize(buf, at) {
  let len = 1;
  while (len <= 8 && (buf[at] & (0x80 >> (len - 1))) === 0) len++;
  const bytes = buf.subarray(at, at + len);
  const unknown = bytes.every((b, i) => (i === 0 ? (b & (0xff >> len)) === (0xff >> len) : b === 0xff));
  let value = bytes[0] & (0xff >> len);
  for (let i = 1; i < len; i++) value = value * 256 + bytes[i];
  return { value, len, unknown };
}

function readElement(buf, at) {
  const { id, len: idLen } = readId(buf, at);
  const size = readSize(buf, at + idLen);
  const body = at + idLen + size.len;
  return { id, at, body, end: size.unknown ? null : body + size.value, unknown: size.unknown };
}

// Elements of known size, one level: enough for the header, Info, Tracks and the inside of a cluster. An element with
// the unknown size is returned too, but nothing can follow it here.
function readList(buf, from, to) {
  const out = [];
  let at = from;
  while (at < to) {
    const el = readElement(buf, at);
    out.push(el);
    if (el.unknown) break;
    at = el.end;
  }
  return out;
}

const child = (list, id) => {
  const el = list.find((e) => e.id === id);
  assert.ok(el, `element ${id} missing`);
  return el;
};
const body = (buf, el) => buf.subarray(el.body, el.end);
const number = (buf, el) => body(buf, el).reduce((n, b) => n * 256 + b, 0);
const text = (buf, el) => body(buf, el).toString('utf8');

// Clusters carry the unknown size, so their end is the start of the next one; scanning for the ID is enough here,
// because the test writes payloads that cannot contain it.
function clusters(buf, from) {
  const starts = [];
  for (let i = from; i + 4 <= buf.length; i++) if (buf.readUInt32BE(i) === 0x1f43b675) starts.push(i);
  return starts.map((at, i) => {
    const el = readElement(buf, at);
    assert.ok(el.unknown, 'a cluster carries the unknown size');
    return readList(buf, el.body, starts[i + 1] ?? buf.length);
  });
}

test('WebmWriter: header, Info, both tracks and time-ordered blocks', () => {
  const writer = new WebmWriter({
    width: 1920, height: 1080, durationMs: 2000,
    audio: { channels: 1, codecPrivate: OPUS_HEAD, preSkipSamples: 312 },
  });
  writer.block({ track: 1, key: true, tsUs: 0, data: Buffer.from('V0') });
  writer.block({ track: 1, key: false, tsUs: 33333, data: Buffer.from('V1') });
  writer.block({ track: 1, key: false, tsUs: 66667, data: Buffer.from('V2') });
  writer.block({ track: 2, key: false, tsUs: 20000, data: Buffer.from('A1') });
  writer.block({ track: 2, key: false, tsUs: 0, data: Buffer.from('A0') });
  const file = Buffer.from(writer.build());   // the writer returns plain bytes; this test reads them with Buffer

  const top = readList(file, 0, file.length);
  assert.equal(top[0].id, '1a45dfa3', 'the file starts with the EBML header');
  const header = readList(file, top[0].body, top[0].end);
  assert.equal(text(file, child(header, '4282')), 'webm');
  assert.equal(number(file, child(header, '4287')), 4);
  assert.equal(number(file, child(header, '42f3')), 8);

  const segment = top[1];
  assert.equal(segment.id, '18538067');
  assert.ok(segment.unknown, 'the segment carries the unknown size: nothing is patched after writing');

  const inside = readList(file, segment.body, file.length);
  const info = readList(file, child(inside, '1549a966').body, child(inside, '1549a966').end);
  assert.equal(number(file, child(info, '2ad7b1')), 1_000_000, 'the timecode scale is one millisecond');
  assert.equal(body(file, child(info, '4489')).readDoubleBE(0), 2000, 'the duration is written up front');

  const tracks = readList(file, child(inside, '1654ae6b').body, child(inside, '1654ae6b').end);
  const [video, sound] = tracks;
  const videoTrack = readList(file, video.body, video.end);
  assert.equal(number(file, child(videoTrack, 'd7')), 1);
  assert.equal(number(file, child(videoTrack, '83')), 1, 'track type 1 is video');
  assert.equal(text(file, child(videoTrack, '86')), 'V_VP9');
  const videoInfo = readList(file, child(videoTrack, 'e0').body, child(videoTrack, 'e0').end);
  assert.equal(number(file, child(videoInfo, 'b0')), 1920);
  assert.equal(number(file, child(videoInfo, 'ba')), 1080);

  const audioTrack = readList(file, sound.body, sound.end);
  assert.equal(number(file, child(audioTrack, 'd7')), 2);
  assert.equal(number(file, child(audioTrack, '83')), 2, 'track type 2 is audio');
  assert.equal(text(file, child(audioTrack, '86')), 'A_OPUS');
  assert.deepEqual(body(file, child(audioTrack, '63a2')), OPUS_HEAD, 'the decoder needs the OpusHead');
  assert.equal(number(file, child(audioTrack, '56aa')), 6_500_000, 'CodecDelay drops the pre-skip, in nanoseconds');
  assert.equal(number(file, child(audioTrack, '56bb')), 80_000_000, 'SeekPreRoll, as the specification asks');
  const audioInfo = readList(file, child(audioTrack, 'e1').body, child(audioTrack, 'e1').end);
  assert.equal(body(file, child(audioInfo, 'b5')).readDoubleBE(0), 48000, 'Opus always decodes at 48 kHz');
  assert.equal(number(file, child(audioInfo, '9f')), 1);

  const parts = clusters(file, inside[inside.length - 1].at);
  assert.equal(parts.length, 1, 'blocks within a second share one cluster');
  const cluster = parts[0];
  assert.equal(number(file, child(cluster, 'e7')), 0, 'the cluster timecode is the first block');
  const simples = cluster.filter((e) => e.id === 'a3');
  assert.equal(simples.length, 5);
  // Audio and picture interleave by time, so a player reads both in one pass.
  assert.deepEqual(simples.map((b) => file[b.body]), [0x81, 0x82, 0x82, 0x81, 0x81], 'track numbers, in time order');
  assert.deepEqual(simples.map((b) => file.readInt16BE(b.body + 1)), [0, 0, 20, 33, 67], 'relative timecodes in milliseconds');
  assert.deepEqual(simples.map((b) => file[b.body + 3]), [0x80, 0, 0, 0, 0], 'only the first frame is a key frame');
  assert.deepEqual(simples.map((b) => file.toString('utf8', b.body + 4, b.end)), ['V0', 'A0', 'A1', 'V1', 'V2']);
});

test('WebmWriter: clusters are cut every second, so seeking stays cheap', () => {
  const writer = new WebmWriter({ width: 640, height: 360, durationMs: 3000 });
  for (const tsUs of [0, 1_200_000, 2_500_000]) writer.block({ track: 1, key: true, tsUs, data: Buffer.from('V') });
  const file = Buffer.from(writer.build());   // the writer returns plain bytes; this test reads them with Buffer

  assert.equal(writer.count(1), 3);
  const segment = readList(file, 0, file.length)[1];
  const inside = readList(file, segment.body, file.length);
  const parts = clusters(file, inside[inside.length - 1].at);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((p) => number(file, child(p, 'e7'))), [0, 1200, 2500]);
});

test('WebmWriter: a video without narration has one track', () => {
  const writer = new WebmWriter({ width: 1920, height: 1080, durationMs: 1000 });
  writer.block({ track: 1, key: true, tsUs: 0, data: Buffer.from('V') });
  const file = Buffer.from(writer.build());   // the writer returns plain bytes; this test reads them with Buffer

  const segment = readList(file, 0, file.length)[1];
  const inside = readList(file, segment.body, file.length);
  const tracks = readList(file, child(inside, '1654ae6b').body, child(inside, '1654ae6b').end);
  assert.equal(tracks.length, 1);
});
