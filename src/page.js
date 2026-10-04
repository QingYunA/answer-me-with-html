// 页面信封：页面根标签上的设置、视频配音、文末隐藏源稿。
// render / video 用这里写出信封，patch 用 readPage 读回。格式只在这个文件里定义。
import { esc } from './svg/text.js';

const SOURCE_OPEN = '<textarea id="am-source"';
const SOURCE_RE = new RegExp(`^${SOURCE_OPEN}[^>]*>([\\s\\S]*?)<\\/textarea>`);
const AUDIO_OPEN = '<audio id="amv-audio"';

// lang 传入时已是 html lang 值（如 zh-CN）。
export function rootTag({ lang, theme, mode, style, video = false }) {
  return `<html lang="${lang}" data-theme="${esc(theme)}" data-mode="${esc(mode)}" data-style="${esc(style)}"${video ? ' data-video' : ''}>`;
}

export function audioTag(wav) {
  return `${AUDIO_OPEN} preload="auto" src="data:audio/wav;base64,${wav.toString('base64')}"></audio>`;
}

// 必须是页面最后一个 textarea，紧跟在可选的 audioTag 之后。
export function sourceTag(source) {
  return `${SOURCE_OPEN} hidden readonly aria-hidden="true">${esc(source)}</textarea>`;
}

// 读回信封：{ source, video, template, theme, mode, style, voiced }。没有源稿时 source 为 null。
// 正文的 html / markdown 里可能写出同名标签，所以：设置只认文档根上的 <html>，
// 源稿只认文末那一枚 textarea，配音只认紧挨源稿之前的 audio。
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
    // 正文里的 <main class="am-doc"> 不算；模板的 <main> 总在正文之前。
    template: video ? 'video' : s.match(/<main class="am-(doc|sheet)\b/)?.[1],
    theme: attr('data-theme'),
    mode: attr('data-mode'),
    style: attr('data-style'),
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
