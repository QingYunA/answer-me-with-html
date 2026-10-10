// shadcn cards: rounded corners, thin borders, a soft shadow.
import { SANS, MONO } from './fonts.js';

export default {
  name: 'shadcn',
  summary: 'shadcn cards',
  label: { zh: '卡片', 'zh-Hant': '卡片', en: 'Cards', ja: 'カード', he: 'כרטיסים' }, // lang-ok: viewer-facing theme labels
  scope: ['page', 'video'],
  tokens: {
    common: { '--font-sans': SANS, '--font-mono': MONO, '--radius': '8px', '--shadow': '0 1px 2px 0 rgba(0,0,0,0.05)', '--bw': '1px', '--head-font': 'var(--font-sans)' },
    light: {
      '--bg': '#fafafa', '--paper': '#ffffff', '--ink': '#09090b', '--ink-2': '#71717a', '--ink-3': '#a1a1aa',
      '--line': '#e4e4e7', '--line-2': '#f0f0f2', '--fill': '#f4f4f5',
      '--accent': '#2563eb', '--accent-bg': '#eff6ff',
      '--ok': '#16a34a', '--ok-bg': '#f0fdf4', '--err': '#dc2626', '--err-bg': '#fef2f2',
      '--warn': '#d97706', '--warn-bg': '#fffbeb', '--head-bg': '#18181b', '--head-fg': '#fafafa',
    },
    dark: {
      '--bg': '#09090b', '--paper': '#121215', '--ink': '#fafafa', '--ink-2': '#a1a1aa', '--ink-3': '#71717a',
      '--line': '#27272a', '--line-2': '#1c1c1f', '--fill': '#18181b',
      '--accent': '#60a5fa', '--accent-bg': '#172554',
      '--ok': '#4ade80', '--ok-bg': '#052e16', '--err': '#f87171', '--err-bg': '#450a0a',
      '--warn': '#fbbf24', '--warn-bg': '#451a03', '--head-bg': '#fafafa', '--head-fg': '#18181b',
    },
  },
  css: `& .am-panel-id { border-radius: 6px; min-width: 24px; height: 24px; margin: 9px 0 9px 14px; font-size: 12px; }
& .am-panel-head { border-bottom-width: 1px; }
& .am-kv { border-color: var(--line); border-radius: var(--radius); overflow: hidden; }`,
  video: {
    css: `& .amv-scene-n { margin: 12px 0 12px 14px; min-width: 40px; border-radius: 8px; font-size: 22px; }
& .amv-scene-head { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06); }`,
    rtlCss: '& .amv-scene-n { margin: 12px 14px 12px 0; }',
  },
};
