// Blueprint drawing: square corners, heavy lines, a double frame with coordinate rulers.
import { SANS, MONO } from './fonts.js';

export default {
  name: 'blueprint',
  summary: 'Blueprint drawing',
  label: { zh: '图纸', 'zh-Hant': '圖紙', en: 'Blueprint', ja: '図面', he: 'שרטוט' }, // lang-ok: viewer-facing theme labels
  scope: ['page', 'video'],
  tokens: {
    common: { '--font-sans': SANS, '--font-mono': MONO, '--radius': '0px', '--shadow': 'none', '--bw': '1.5px', '--head-font': 'var(--font-sans)' },
    light: {
      '--bg': '#f6f6f3', '--paper': '#ffffff', '--ink': '#16181d', '--ink-2': '#4b5260', '--ink-3': '#8b929e',
      '--line': '#1d2026', '--line-2': '#d6dae1', '--fill': '#f3f5f8',
      '--accent': '#1d5fbf', '--accent-bg': '#e4ecf8',
      '--ok': '#1d5fbf', '--ok-bg': '#e4ecf8', '--err': '#c62828', '--err-bg': '#fbeaea',
      '--warn': '#a8620a', '--warn-bg': '#fdf3e2', '--head-bg': '#16181d', '--head-fg': '#ffffff',
    },
    dark: {
      '--bg': '#081322', '--paper': '#0d1c31', '--ink': '#e6edf7', '--ink-2': '#a9b8cc', '--ink-3': '#6b7f99',
      '--line': '#c9d6e8', '--line-2': '#23385a', '--fill': '#12253f',
      '--accent': '#6ea8ff', '--accent-bg': '#16305a',
      '--ok': '#6ea8ff', '--ok-bg': '#16305a', '--err': '#ff7070', '--err-bg': '#3b1620',
      '--warn': '#f0b14a', '--warn-bg': '#3a2a10', '--head-bg': '#e6edf7', '--head-fg': '#081322',
    },
  },
  css: `& .am-frame { border: 1px solid var(--line); padding: 30px; }
& .am-frame::before {
  content: ""; position: absolute; inset: 18px; border: 1px solid var(--line); pointer-events: none;
}
& .am-ruler {
  display: flex; position: absolute; font: 10px/1 var(--font-mono); color: var(--ink-3);
}
@media (max-width: 760px) {
  & .am-frame { padding: 0; border: 0; }
  & .am-frame::before, & .am-ruler { display: none; }
}`,
  video: {
    // Drawing-sheet ground with a fine grid.
    tokens: {
      light: {
        '--v-stage': `linear-gradient(var(--line-2) 1px, transparent 1px) 0 0 / 40px 40px,
             linear-gradient(90deg, var(--line-2) 1px, transparent 1px) 0 0 / 40px 40px, var(--paper)`,
      },
      dark: {
        '--v-stage': `linear-gradient(rgba(201, 214, 232, 0.07) 1px, transparent 1px) 0 0 / 40px 40px,
             linear-gradient(90deg, rgba(201, 214, 232, 0.07) 1px, transparent 1px) 0 0 / 40px 40px, var(--bg)`,
      },
    },
    css: `& .amv-sheet {
  display: block; position: absolute; inset: 24px; border: 1.5px solid var(--line); pointer-events: none;
}
& .amv-sheet::before {
  content: ""; position: absolute; inset: 24px; border: 1.5px solid var(--line);
}`,
  },
};
