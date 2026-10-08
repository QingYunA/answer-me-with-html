// Narration follows the language of the draft (#84): the render decides the language of every line (a declared language for all
// lines, otherwise each line by its own text) and hands it to the voice. Tested through the video render with a fake voice.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderVideo } from '../src/video/render.js';

const SAMPLE_RATE = 22050;
// A voice that records the language it was asked for. usesLanguage marks a voice whose choice depends on the language (system voices).
function fakeVoice({ usesLanguage }) {
  const calls = [];
  return {
    calls,
    name: 'fake',
    id: 'fake',
    concurrency: 1,
    ...(usesLanguage ? { usesLanguage: true } : {}),
    async synth(text, options) {
      calls.push({ text, language: options?.language });
      return Int16Array.from({ length: Math.round(SAMPLE_RATE * 0.3) }, (_, i) => Math.round(8000 * Math.sin(i / 8)));
    },
  };
}
const video = (beats, lang) => `${lang === undefined ? '' : `---\nlang: ${lang}\n---\n`}## S\n\`\`\`flow\nA -> B\n\`\`\`\n${beats.map((b) => `> ${b}`).join('\n')}\n`;
const languages = async (beats, lang, voice = fakeVoice({ usesLanguage: true })) => {
  await renderVideo(video(beats, lang), { provider: voice });
  return voice.calls.map((c) => c.language);
};

let cacheDir;
before(() => { cacheDir = mkdtempSync(join(tmpdir(), 'am-voice-lang-')); });
after(() => rmSync(cacheDir, { recursive: true, force: true }));

test('video narration: each line of an undeclared draft gets the language of its own text', async () => {
  assert.deepEqual(await languages(['这是一句中文旁白。', 'This line is English narration.', 'これは日本語のナレーションです。', '이것은 한국어 나레이션입니다.']), ['zh', 'en', 'ja', 'ko']); // lang-ok: narration under test
});

test('video narration: Traditional Chinese lines ask for a Traditional Chinese voice, not the Simplified one', async () => {
  assert.deepEqual(await languages(['這是一句繁體中文的旁白。']), ['zh-Hant']); // lang-ok: narration under test
});

test('video narration: a declared language applies to every line', async () => {
  assert.deepEqual(await languages(['这是一句中文旁白。', 'This line is English narration.'], 'en'), ['en', 'en']); // lang-ok: narration under test
  assert.deepEqual(await languages(['This line is English narration.'], 'zh-TW'), ['zh-TW']);
  assert.deepEqual(await languages(['Cette ligne est en français.'], 'fr'), ['fr']);
});

test('video narration: a line the voice has no voice for keeps its caption and its estimated duration', async () => {
  const voice = fakeVoice({ usesLanguage: true });
  // A machine that has a Chinese voice and no Korean one, as `say -v '?'` would report it.
  voice.voiceFor = (language) => (language.startsWith('zh') ? 'Tingting' : null);
  const progress = [];
  const both = await renderVideo(video(['这是一句中文旁白。', '이것은 한국어 나레이션입니다.']), { provider: voice, onProgress: (m) => progress.push(m) }); // lang-ok: narration under test
  assert.deepEqual(voice.calls.map((c) => c.language), ['zh'], 'the Korean line is not read by the Chinese voice');
  assert.deepEqual(both.captionsOnly, [{ language: 'ko', lines: 1 }]);
  assert.ok(both.wav, 'the Chinese line still gives the video a voice track');
  assert.match(progress.join('\n'), /No ko voice on this machine: captions only for 1 line/);
  const lone = await renderVideo(video(['이것은 한국어 나레이션입니다.']), { provider: voice }); // lang-ok: narration under test
  assert.equal(lone.wav, null, 'a video whose every line has no voice has captions only, like --voice off');
  assert.deepEqual(lone.captionsOnly, [{ language: 'ko', lines: 1 }]);
});

test('video narration: a voice that does not use the language is called without one', async () => {
  const voice = fakeVoice({ usesLanguage: false });
  await renderVideo(video(['这是一句中文旁白。']), { provider: voice }); // lang-ok: narration under test
  assert.deepEqual(voice.calls.map((c) => c.language), [undefined]);
});

test('video narration: the cache keeps lines of different languages apart for a voice that uses the language', async () => {
  const voice = fakeVoice({ usesLanguage: true });
  const render = (lang) => renderVideo(video(['Same text.'], lang), { provider: voice, cacheDir });
  await render('en');
  await render('en');
  assert.equal(voice.calls.length, 1, 'the same language is served from the cache');
  await render('fr');
  assert.equal(voice.calls.length, 2, 'another language is synthesized again');
});

test('video narration: the cache of a voice that ignores the language does not change with it', async () => {
  const voice = fakeVoice({ usesLanguage: false });
  const render = (lang) => renderVideo(video(['Other text.'], lang), { provider: voice, cacheDir });
  await render('en');
  await render('fr');
  assert.equal(voice.calls.length, 1, 'already-cached lines are not paid for again');
});
