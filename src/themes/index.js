// 主题 = 一组 CSS 变量。组件样式（base.css）只引用变量，因此切换主题只需切换 data-theme。
// 每个主题提供 light / dark 两套取值；auto 模式跟随系统 prefers-color-scheme。

import { BASE_CSS } from '../assets.js';

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace';
// 日文页面：日文字体排在中文字体前面。点名的中文字体会盖过 lang="ja"，汉字会用中文字形（直、込）。
const JA_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, "Noto Sans CJK JP", "Noto Sans JP", "PingFang SC", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif';
const JA_SERIF = '"CMU Serif", "Latin Modern Roman", "Iowan Old Style", "Palatino", "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", "Noto Serif JP", "Songti SC", serif';

const shared = { '--font-sans': SANS, '--font-mono': MONO };

export const THEMES = Object.freeze({
  blueprint: {
    label: '图纸 Blueprint',
    common: { ...shared, '--radius': '0px', '--shadow': 'none', '--bw': '1.5px', '--head-font': 'var(--font-sans)' },
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
  shadcn: {
    label: '卡片 shadcn',
    common: { ...shared, '--radius': '8px', '--shadow': '0 1px 2px 0 rgba(0,0,0,0.05)', '--bw': '1px', '--head-font': 'var(--font-sans)' },
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
});

const block = (selector, vars) =>
  `${selector} {\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`;

export function themeCss() {
  return Object.entries(THEMES).map(([name, t]) => {
    const sel = `html[data-theme="${name}"]`;
    return [
      block(`${sel}, ${sel}[data-mode="light"]`, { ...t.common, ...t.light }),
      block(`${sel}[data-mode="dark"]`, t.dark),
      `@media (prefers-color-scheme: dark) {\n${block(`${sel}[data-mode="auto"]`, t.dark)}\n}`,
    ].join('\n');
  }).join('\n\n') + `\n\n${JA_FONT_CSS}`;
}

// [data-theme][data-mode] 让选择器比各主题（含视频的 3b1b）更具体，放在哪里都能生效。
const JA_FONT_CSS = block('html[lang="ja"][data-theme][data-mode]', { '--font-sans': JA_SANS, '--v-title-font': JA_SERIF });

export function pageCss() {
  return `${themeCss()}\n\n${BASE_CSS}`;
}
