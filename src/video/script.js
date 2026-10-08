// Video draft: reuses parseDoc's panel splitting. One "## " panel = one scene; lines starting with > in a panel are narration,
// each narration line is one beat; [name] in narration focuses the camera on the same-named element. Everything else (components, Markdown) is visuals.
import { parseDoc, ParseError } from '../parse.js';
import { isCJK } from '../svg/text.js';
import { themeNames } from '../themes/registry.js';

const NARRATION = /^\s*>\s?(.*)$/;
const FOCUS = /\[([^\]\n]+)\]/g;

// Video themes: every theme whose scope includes video (the page themes, plus the video-only 3b1b).
export const VIDEO_THEMES = Object.freeze(themeNames('video'));

// themeChoices: the theme names a draft may give (the CLI adds the user's themes).
export function parseVideo(source, { defaults = {}, themeChoices = VIDEO_THEMES } = {}) {
  const doc = parseDoc(source, { defaults: { ...defaults, template: 'video' }, choices: { theme: themeChoices } });
  const intro = splitNarration(doc.intro);
  const scenes = doc.panels.map((p) => {
    const { blocks, beats } = splitNarration(p.blocks);
    if (!beats.length) throw new ParseError(`Scene "${p.title}" has no narration: write at least one > narration line in every scene`, p.line);
    return { id: p.id, title: p.title, line: p.line, attrs: p.attrs, blocks, beats };
  });
  if (!scenes.length) throw new ParseError('A video draft needs at least one scene (## Scene title)', 1);
  return { meta: doc.meta, doc, intro: intro.blocks, introBeats: intro.beats, scenes };
}

// Take narration lines out of Markdown blocks; the remaining Markdown stays as visual content.
function splitNarration(blocks) {
  const beats = [];
  const out = [];
  for (const b of blocks) {
    if (b.type !== 'md') {
      out.push(b);
      continue;
    }
    const rest = [];
    b.text.split('\n').forEach((raw, i) => {
      const m = raw.match(NARRATION);
      if (m && m[1].trim()) beats.push(beat(m[1].trim(), b.line + i));
      else if (!m) rest.push(raw);
    });
    if (rest.some((l) => l.trim())) out.push({ ...b, text: rest.join('\n') });
  }
  return { blocks: out, beats };
}

function beat(raw, line) {
  const focus = [...raw.matchAll(FOCUS)].map((m) => m[1].trim());
  return { raw, text: raw.replace(FOCUS, '$1'), focus: focus[0] ?? null, line };
}

// Without a voice-over, reading time is estimated from word count: Chinese about 4.2 characters/s, English about 2.6 words/s.
export function estimateSeconds(text) {
  let cjk = 0;
  let latin = '';
  for (const ch of text) {
    if (isCJK(ch)) cjk++;
    latin += isCJK(ch) ? ' ' : ch;
  }
  const words = latin.match(/[A-Za-z0-9][\w'’-]*/g)?.length ?? 0;
  return Math.max(1.6, cjk / 4.2 + words / 2.6 + 0.3);
}

export const TIMING = Object.freeze({
  title: 2.4,      // intro hold when there is no narration
  transition: 0.9, // scene change (including cross-scene morphs)
  gap: 0.35,       // pause between two narration lines
  tail: 0.8,       // hold after a scene's last line
  outro: 1.5,      // outro hold
});

// Lay out beat durations on a timeline. durations[i] follows the intro narration then each scene's narration (flat order).
export function buildTimeline(video, durations) {
  let t = 0;
  let k = 0;
  const lay = (beats) => beats.map((b) => {
    const dur = durations[k++];
    const start = t;
    t += dur + TIMING.gap;
    return { text: b.text, focus: b.focus, start: round(start), end: round(start + dur) };
  });

  const titleBeats = lay(video.introBeats);
  if (!titleBeats.length) t = TIMING.title;
  const title = { start: 0, end: round(t), beats: titleBeats };

  const scenes = video.scenes.map((s) => {
    const start = t;
    t += TIMING.transition;
    const beats = lay(s.beats);
    t += TIMING.tail - TIMING.gap;
    return { id: s.id, title: s.title, start: round(start), end: round(t), beats };
  });
  t += TIMING.outro;
  return { duration: round(t), title, scenes };
}

export const allBeats = (video) => [...video.introBeats, ...video.scenes.flatMap((s) => s.beats)];

const round = (x) => Math.round(x * 1000) / 1000;
