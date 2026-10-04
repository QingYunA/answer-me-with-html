// 视频稿 → 单文件播放页。画面复用页面组件；时间轴由每句旁白的音频时长（或估算时长）决定；
// 播放页里的 render(t) 是确定性的：同一时刻永远画出同一帧，导出 MP4 时逐帧调用它。
import { renderBlocks, detectLang, htmlLang, LintError, timestamp } from '../render.js';
import { pageCss } from '../themes/index.js';
import { lintDoc } from '../lint/ste.js';
import { esc } from '../svg/text.js';
import { VERSION, VIDEO_CSS, VIDEO_JS } from '../assets.js';
import { rootTag, audioTag, sourceTag } from '../page.js';
import { parseVideo, buildTimeline, estimateSeconds, allBeats, VIDEO_THEMES } from './script.js';
import { CHOICES, applyOverrides } from '../parse.js';
import { synthAll, mixTrack, SAMPLE_RATE } from './tts.js';

const UI = {
  zh: { play: '播放', pause: '暂停', chapters: '章节' },
  en: { play: 'Play', pause: 'Pause', chapters: 'Chapters' },
  ja: { play: '再生', pause: '一時停止', chapters: '章' },
};

// provider 为 null 时只出字幕，时长按字数估算。
export async function renderVideo(source, { provider = null, cacheDir, defaults = {}, overrides = {}, onProgress } = {}) {
  const video = parseVideo(source, { defaults });
  const meta = applyOverrides(video.meta, overrides, { ...CHOICES, theme: VIDEO_THEMES });

  // 旁白每行是一拍，连续多行不算"超长段落"。
  const warnings = meta.style === 'off' ? [] : lintDoc(video.doc).filter((w) => w.rule !== 'paragraph-length');
  if (meta.style === 'strict' && warnings.length) throw new LintError(warnings);

  const beats = allBeats(video);
  const { clips, durations } = await voiceBeats(beats, provider, cacheDir, onProgress);
  const timeline = buildTimeline(video, durations);
  const flat = [...timeline.title.beats, ...timeline.scenes.flatMap((s) => s.beats)];
  const wav = clips ? mixTrack(clips, flat.map((b) => b.start), timeline.duration) : null;

  const stats = { panels: video.scenes.length, components: {} };
  const scenesHtml = renderScenes(video, meta, timeline, { seq: 0, stats });
  const lang = meta.lang || detectLang(source);
  const html = shell({ meta, lang, scenesHtml, data: playerData(video, meta, timeline), wav, source });
  return { html, wav, warnings, stats, meta, duration: timeline.duration, beats: beats.length };
}

// 有配音时每拍时长取音频长度；否则按字数估算。
async function voiceBeats(beats, provider, cacheDir, onProgress) {
  if (!provider) return { clips: null, durations: beats.map((b) => estimateSeconds(b.text)) };
  onProgress?.(`配音：${provider.name}，${beats.length} 句`);
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

// 字幕：[名字] 变成高亮词。
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

// 图纸外框与坐标刻度（只在 blueprint 主题显示），固定在镜头之外。
function sheetFrame() {
  const ruler = (side, labels) => `<div class="amv-ruler amv-ruler--${side}">${labels.map((l) => `<span>${l}</span>`).join('')}</div>`;
  const nums = [1, 2, 3, 4, 5, 6, 7, 8];
  const letters = ['A', 'B', 'C', 'D'];
  return `<div class="amv-sheet" aria-hidden="true">${ruler('top', nums)}${ruler('bottom', nums)}${ruler('left', letters)}${ruler('right', letters)}</div>`;
}

function shell({ meta, lang, scenesHtml, data, wav, source }) {
  const ui = UI[lang] ?? UI.zh;
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
${rootTag({ lang: htmlLang(lang), theme: meta.theme, mode: meta.theme === '3b1b' || meta.mode === 'dark' ? 'dark' : 'light', style: meta.style, video: true })}
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Answer me with HTML ${VERSION}">
<title>${esc(meta.title || 'Answer me with HTML')}</title>
<style>
${pageCss()}
${VIDEO_CSS}
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
