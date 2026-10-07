// Page envelope: settings on the page's root tag, video voice-over, hidden source draft at the end.
// render / video write the envelope here, patch reads it back with readPage. The format is defined only in this file.
import { esc } from './svg/text.js';

const SOURCE_OPEN = '<textarea id="am-source"';
const SOURCE_RE = new RegExp(`^${SOURCE_OPEN}[^>]*>([\\s\\S]*?)<\\/textarea>`);
const AUDIO_OPEN = '<audio id="amv-audio"';

// lang is already an html lang value when passed in (e.g. zh-CN).
// voice is written only on voiced video pages (elevenlabs / local / system); patch keeps the same voice.
export function rootTag({ lang, theme, mode, style, voice, video = false }) {
  return `<html lang="${lang}" data-theme="${esc(theme)}" data-mode="${esc(mode)}" data-style="${esc(style)}"${voice ? ` data-voice="${esc(voice)}"` : ''}${video ? ' data-video' : ''}>`;
}

// Copies of the root settings, written on the toolbar. A host that serves the page inside its own document leaves the real <html>
// without them; the page runtime sets back whatever the root lacks from these (see the first statement of src/runtime/page.js).
export function rootCarrierAttrs({ lang, theme, mode, style }) {
  return ` data-am-root-lang="${lang}" data-am-root-theme="${esc(theme)}" data-am-root-mode="${esc(mode)}" data-am-root-style="${esc(style)}"`;
}

export function audioTag(wav) {
  return `${AUDIO_OPEN} preload="auto" src="data:audio/wav;base64,${wav.toString('base64')}"></audio>`;
}

// Must be the page's last textarea, right after the optional audioTag.
export function sourceTag(source) {
  return `${SOURCE_OPEN} hidden readonly aria-hidden="true">${esc(source)}</textarea>`;
}

// Read the envelope back: { source, video, template, theme, mode, style, lang, voice, voiced }. source is null when there is no source draft.
// The body html / markdown may contain tags with the same names, so: settings come only from the document-root <html>,
// the source only from the final textarea, the voice only from the audio right before the source.
export function readPage(html) {
  const s = String(html);
  const root = s.match(/<html\b[^>]*>/)?.[0] ?? '';
  const attr = (name) => root.match(new RegExp(`\\s${name}="([^"]+)"`))?.[1];
  const video = /\sdata-video\b/.test(root);
  const open = s.lastIndexOf(SOURCE_OPEN);
  const m = open === -1 ? null : s.slice(open).match(SOURCE_RE);
  const before = open === -1 ? '' : s.slice(0, open).trimEnd();
  return {
    source: m ? unescapeHtml(m[1]) : null,
    video,
    // A <main class="am-doc"> in the body does not count; the template's <main> always comes before the body.
    template: video ? 'video' : s.match(/<main class="am-(doc|sheet)\b/)?.[1],
    theme: attr('data-theme'),
    mode: attr('data-mode'),
    style: attr('data-style'),
    lang: attr('lang'),
    voice: attr('data-voice'),
    voiced: video && before.endsWith('</audio>') && before.lastIndexOf(AUDIO_OPEN) > before.lastIndexOf('<textarea'),
  };
}

function unescapeHtml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
