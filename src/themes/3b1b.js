// 3b1b: video-only dark theme (dark ground, blue lines, yellow accents); the title floats top left with no frame.
import { serifByLanguage } from './fonts.js';

// The Latin fonts in front of a language's serif fonts, so Han characters use that language's glyphs.
const TITLE_HEAD = '"CMU Serif", "Latin Modern Roman", "Iowan Old Style", "Palatino"';

export default {
  name: '3b1b',
  summary: '3Blue1Brown dark',
  scope: ['video'],
  mode: 'dark',
  video: {
    tokens: {
      common: {
        '--bg': '#0e1015', '--paper': '#141922', '--ink': '#eceff4', '--ink-2': '#a9b4c4', '--ink-3': '#6c7789',
        '--line': '#58c4dd', '--line-2': '#2a3444', '--fill': '#171d27',
        '--accent': '#f7d96f', '--accent-bg': 'rgba(247, 217, 111, 0.12)',
        '--ok': '#83c167', '--ok-bg': 'rgba(131, 193, 103, 0.14)', '--err': '#fc6255', '--err-bg': 'rgba(252, 98, 85, 0.14)',
        '--warn': '#f7d96f', '--warn-bg': 'rgba(247, 217, 111, 0.12)', '--head-bg': '#eceff4', '--head-fg': '#0e1015',
        '--radius': '6px', '--bw': '1.6px', '--shadow': 'none',
        '--font-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, sans-serif',
        '--font-mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        '--head-font': 'var(--font-sans)',
        '--v-stage': 'radial-gradient(ellipse at 50% 40%, #151a23 0%, #0e1015 70%)',
        '--v-cap-fg': '#fff', '--v-cap-bg': 'rgba(8, 10, 14, 0.55)', '--v-cap-border': 'transparent',
        '--v-title-font': '"CMU Serif", "Latin Modern Roman", "Iowan Old Style", "Palatino", "Songti SC", "STSong", "Noto Serif CJK SC", serif',
        '--v-glow': 'drop-shadow(0 0 6px rgba(247, 217, 111, 0.55))',
      },
    },
    css: `${serifByLanguage('--v-title-font', TITLE_HEAD)}
& .amv-scene-head { left: 96px; top: 56px; border: 0; background: none; align-items: baseline; gap: 22px; }
& .amv-scene-n { background: none; color: var(--line); padding: 0; min-width: 0; font: 500 30px var(--font-mono); }
& .amv-scene-title { padding: 0; font-weight: 400; font-size: 46px; }
& .amv-scene-meta { display: none; }
& .amv-title { font-weight: 400; font-size: 104px; letter-spacing: 0.005em; }
& .amv-subtitle { color: var(--line); }
& .amv-titleblock { display: none; }
& .amv-caption { bottom: 56px; }
& .amv-caption span { text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6); font-size: 40px; }`,
    // Right-to-left: the floating title keeps its 96 px inset on the side it starts from.
    rtlCss: '& .amv-scene-head { left: 72px; right: 96px; }',
  },
};
