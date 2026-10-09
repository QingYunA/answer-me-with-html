// Paper: a reading theme for long text. Warm paper, ink-colored text, serif prose and headings; diagrams keep the sans font,
// because their text widths are estimated for sans in Node (svg/text.js).
import { SANS, MONO, serifByLanguage } from './fonts.js';

const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", serif';
// The Latin fonts in front of a language's serif fonts, so Han characters use that language's glyphs.
const LANGUAGE_SERIF_HEAD = '"Iowan Old Style", Palatino, Georgia';

export default {
  name: 'paper',
  summary: 'Paper, for long reading',
  label: { zh: '纸张', 'zh-Hant': '紙張', en: 'Paper', ja: '紙', he: 'נייר' }, // lang-ok: viewer-facing theme labels
  scope: ['page'],
  tokens: {
    common: { '--font-sans': SANS, '--font-mono': MONO, '--font-serif': SERIF, '--radius': '2px', '--shadow': 'none', '--bw': '1px', '--head-font': 'var(--font-serif)' },
    light: {
      '--bg': '#f5f2ea', '--paper': '#fdfbf6', '--ink': '#1f1c17', '--ink-2': '#57514a', '--ink-3': '#8c867b',
      '--line': '#cbc3b4', '--line-2': '#e5dfd3', '--fill': '#f3eee4',
      '--accent': '#8c2f1e', '--accent-bg': '#f5e5df',
      '--ok': '#2e6a3b', '--ok-bg': '#e4efe5', '--err': '#a3251b', '--err-bg': '#f7e3e0',
      '--warn': '#7f5300', '--warn-bg': '#f6ecd6', '--head-bg': '#1f1c17', '--head-fg': '#fdfbf6',
    },
    dark: {
      '--bg': '#15130f', '--paper': '#1c1a15', '--ink': '#ebe5d8', '--ink-2': '#b5ad9e', '--ink-3': '#7b7467',
      '--line': '#4a443a', '--line-2': '#2d2a24', '--fill': '#242119',
      '--accent': '#e59a7d', '--accent-bg': '#3a2219',
      '--ok': '#8cc79a', '--ok-bg': '#1c3122', '--err': '#f0928a', '--err-bg': '#3a1d1a',
      '--warn': '#e3b866', '--warn-bg': '#352a13', '--head-bg': '#ebe5d8', '--head-fg': '#15130f',
    },
  },
  css: `${serifByLanguage('--font-serif', LANGUAGE_SERIF_HEAD)}
& .am-head h1, & .am-panel-head h2, & .am-md, & .am-intro, & .am-callout { font-family: var(--font-serif); }
& .am-head h1 { font-weight: 600; letter-spacing: 0; }
& .am-md p, & .am-md li, & .am-md blockquote, & .am-intro { font-size: 15.5px; line-height: 1.75; }
& .am-md p { margin-bottom: 12px; }
& .am-md table { font-family: var(--font-sans); }`,
};
