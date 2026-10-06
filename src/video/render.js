// Video draft → single-file player page. Visuals reuse page components; the timeline comes from each narration line's audio duration (or estimated duration);
// render(t) in the player page is deterministic: the same moment always draws the same frame, and MP4 export calls it frame by frame.
import { renderBlocks, LintError, timestamp } from '../render.js';
import { resolveLanguage } from '../language.js';
import { videoCss } from '../themes/index.js';
import { BUILTIN, AUTO, pickTheme } from '../themes/registry.js';
import { lintDoc } from '../lint/ste.js';
import { esc } from '../svg/text.js';
import { VERSION, VIDEO_JS } from '../assets.js';
import { rootTag, audioTag, sourceTag } from '../page.js';
import { parseVideo, buildTimeline, estimateSeconds, allBeats } from './script.js';
import { CHOICES, ParseError, applyOverrides } from '../parse.js';
import { synthAll, mixTrack, SAMPLE_RATE } from './tts.js';

// When provider is null, only captions are produced and durations are estimated from word count.
// themes: the theme set to pick from (the CLI passes the built-in themes plus the user's theme files).
export async function renderVideo(source, { provider = null, cacheDir, defaults = {}, overrides = {}, onProgress, themes = BUILTIN } = {}) {
  const themeChoices = themes.choices('video');
  const video = parseVideo(source, { defaults, themeChoices });
  const picked = applyOverrides(video.meta, overrides, { ...CHOICES, theme: themeChoices });
  const problem = themes.problem(picked.theme, 'video');
  if (problem) throw new ParseError(problem, 0);
  const meta = picked.theme === AUTO ? { ...picked, theme: pickTheme({ scope: 'video' }) } : picked;

  // Each narration line is one beat; consecutive lines do not count as an "overlong paragraph".
  const warnings = meta.style === 'off' ? [] : lintDoc(video.doc).filter((w) => w.rule !== 'paragraph-length');
  if (meta.style === 'strict' && warnings.length) throw new LintError(warnings);

  const beats = allBeats(video);
  const { clips, durations } = await voiceBeats(beats, provider, cacheDir, onProgress);
  const timeline = buildTimeline(video, durations);
  const flat = [...timeline.title.beats, ...timeline.scenes.flatMap((s) => s.beats)];
  const wav = clips ? mixTrack(clips, flat.map((b) => b.start), timeline.duration) : null;

  const stats = { panels: video.scenes.length, components: {} };
  const language = resolveLanguage({ declared: meta.lang, text: source });
  const scenesHtml = renderScenes(video, meta, timeline, { seq: 0, stats, ui: language.ui });
  const html = shell({ meta, language, scenesHtml, data: playerData(video, meta, timeline), wav, voice: wav ? provider.voice : undefined, source, embedded: themes.embedFor(meta.theme, 'video') });
  return { html, wav, warnings, stats, meta, language, duration: timeline.duration, beats: beats.length };
}

// With a voice-over each beat lasts as long as its audio; otherwise it is estimated from word count.
async function voiceBeats(beats, provider, cacheDir, onProgress) {
  if (!provider) return { clips: null, durations: beats.map((b) => estimateSeconds(b.text)) };
  onProgress?.(`Voice-over: ${provider.name}, ${beats.length} line${beats.length === 1 ? '' : 's'}`);
  const clips = await synthAll(beats.map((b) => b.text), provider, { cacheDir });
  return { clips, durations: clips.map((c) => c.length / SAMPLE_RATE) };
}

function playerData(video, meta, timeline) {
  return {
    duration: timeline.duration,
    fps: 30,
    segments: [timeline.title, ...timeline.scenes].map((s, i) => ({
      start: s.start,
      end: s.end,
      title: i === 0 ? meta.title : s.title,
      beats: s.beats.map((b, k) => ({ ...b, html: captionHtml(beatsOf(video, i)[k].raw) })),
    })),
  };
}

function renderScenes(video, meta, timeline, ctx) {
  const total = video.scenes.length;
  return [
    titleScene(meta, renderBlocks(video.intro, ctx), { scenes: total, duration: timeline.duration }),
    ...video.scenes.map((s, i) => scene(s, i, total, renderBlocks(s.blocks, ctx))),
  ].join('\n');
}

const beatsOf = (video, i) => (i === 0 ? video.introBeats : video.scenes[i - 1].beats);

// Captions: [name] becomes a highlighted word.
export function captionHtml(raw) {
  return raw.split(/(\[[^\]\n]+\])/).map((part) => {
    const m = part.match(/^\[([^\]]+)\]$/);
    return m ? `<b>${esc(m[1])}</b>` : esc(part);
  }).join('');
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function titleScene(meta, introHtml, { scenes, duration }) {
  const mmss = formatClock(duration);
  const cells = [['DRAWN', 'Answer me with HTML'], ['DATE', timestamp().slice(0, 10)], ['SCENES', String(scenes)], ['DURATION', mmss]];
  const block = `<div class="amv-titleblock">${cells.map(([k, v]) => `<div><b>${k}</b><span>${esc(v)}</span></div>`).join('')}</div>`;
  return `<section class="amv-scene amv-scene--title" data-i="0">
<div class="amv-title-wrap"><h1 class="amv-title">${esc(meta.title || 'Answer me with HTML')}</h1>${meta.subtitle ? `<p class="amv-subtitle">${esc(meta.subtitle)}</p>` : ''}${introHtml ? `<div class="amv-intro">${introHtml}</div>` : ''}${block}</div>
</section>`;
}

function scene(s, i, total, body) {
  const pad = (n) => String(n).padStart(2, '0');
  return `<section class="amv-scene" data-i="${i + 1}">
<header class="amv-scene-head"><span class="amv-scene-n">${esc(s.id)}</span><span class="amv-scene-title">${esc(s.title)}</span><span class="amv-scene-meta">SHEET ${pad(i + 1)} / ${pad(total)}</span></header>
<div class="amv-body"><div class="amv-fit">${body}</div></div>
</section>`;
}

// Drawing frame and coordinate ticks (hidden unless the theme shows .amv-sheet), fixed outside the camera.
function sheetFrame() {
  const ruler = (side, labels) => `<div class="amv-ruler amv-ruler--${side}">${labels.map((l) => `<span>${l}</span>`).join('')}</div>`;
  const nums = [1, 2, 3, 4, 5, 6, 7, 8];
  const letters = ['A', 'B', 'C', 'D'];
  return `<div class="amv-sheet" aria-hidden="true">${ruler('top', nums)}${ruler('bottom', nums)}${ruler('left', letters)}${ruler('right', letters)}</div>`;
}

function shell({ meta, language, scenesHtml, data, wav, voice, source, embedded }) {
  const ui = language.videoUi;
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
${rootTag({ lang: language.htmlLang, theme: meta.theme, mode: embedded.find((t) => t.name === meta.theme).mode ?? (meta.mode === 'dark' ? 'dark' : 'light'), style: meta.style, voice, video: true })}
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Answer me with HTML ${VERSION}">
<title>${esc(meta.title || 'Answer me with HTML')}</title>
<style>
${videoCss(embedded)}
</style>
</head>
<body>
<div class="amv-viewport">
<div class="amv-stage">
${sheetFrame()}
<div class="amv-camera">
${scenesHtml}
<div class="amv-overlay"></div>
</div>
<div class="amv-caption"><span></span></div>
<button class="amv-bigplay" type="button" aria-label="${esc(ui.play)}">▶</button>
</div>
</div>
<div class="amv-controls">
<button class="amv-btn" type="button" data-amv="toggle" data-play="${esc(ui.play)}" data-pause="${esc(ui.pause)}" aria-label="${esc(ui.play)}">▶</button>
<span class="amv-time">0:00 / 0:00</span>
<div class="amv-track"><input class="amv-seek" type="range" min="0" step="0.01" value="0" aria-label="seek"><div class="amv-marks"></div></div>
<span class="amv-brand">Answer me with HTML ${VERSION} · ${esc(timestamp())}</span>
</div>
<script type="application/json" id="amv-data">${json}</script>
${wav ? audioTag(wav) : ''}
${sourceTag(source)}
<script>
${VIDEO_JS}</script>
</body>
</html>
`;
}
