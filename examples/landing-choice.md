---
title: 选一个首屏方向
subtitle: 同一个产品，三种落地页。先看缩略图，再选一个。
template: doc
theme: shadcn
lang: zh
file: landing-choice
---
缩略图只画结构，不代表最终视觉。选定后我按这个方向画完整页面。

## A 首屏选择题 {bare}
```ask cards
三种首屏，你选哪一种？
* A 先讲价值 | 标题直接说结果，适合第一次来的访客
  :::html
  <svg viewBox="0 0 320 180" width="320" height="180" role="img" aria-label="左文右图：标题和按钮在左，产品截图在右" xmlns="http://www.w3.org/2000/svg">
    <rect x=".5" y=".5" width="319" height="179" rx="8" style="fill:var(--paper);stroke:var(--line-2)"/>
    <path d="M.5 8A7.5 7.5 0 0 1 8 .5h304a7.5 7.5 0 0 1 7.5 7.5v10H.5Z" style="fill:var(--fill);stroke:var(--line-2)"/>
    <circle cx="12" cy="9" r="2" style="fill:var(--ink-3)"/>
    <circle cx="19" cy="9" r="2" style="fill:var(--ink-3)"/>
    <circle cx="26" cy="9" r="2" style="fill:var(--ink-3)"/>
    <rect x="64" y="6" width="192" height="6" rx="3" style="fill:var(--line-2)"/>
    <rect x="20" y="40" width="122" height="9" rx="2" style="fill:var(--ink)"/>
    <rect x="20" y="55" width="98" height="9" rx="2" style="fill:var(--ink)"/>
    <rect x="20" y="76" width="120" height="4" rx="2" style="fill:var(--ink-3)"/>
    <rect x="20" y="85" width="104" height="4" rx="2" style="fill:var(--ink-3)"/>
    <rect x="20" y="94" width="112" height="4" rx="2" style="fill:var(--ink-3)"/>
    <rect x="20" y="112" width="58" height="17" rx="8.5" style="fill:var(--accent)"/>
    <rect x="86" y="117" width="42" height="7" rx="3.5" style="fill:var(--ink-3)"/>
    <rect x="164" y="34" width="136" height="112" rx="6" style="fill:var(--fill);stroke:var(--line-2)"/>
    <circle cx="232" cy="78" r="18" style="fill:var(--accent);opacity:.18"/>
    <path d="M178 128l28-30 20 20 18-26 40 36Z" style="fill:var(--accent);opacity:.35"/>
    <rect x="178" y="44" width="44" height="5" rx="2.5" style="fill:var(--ink-3)"/>
  </svg>
  :::
- B 先给画面 | 大图先建立情绪，再补一句说明
  :::html
  <svg viewBox="0 0 320 180" width="320" height="180" role="img" aria-label="大图在上：通栏主视觉，标题和按钮居中" xmlns="http://www.w3.org/2000/svg">
    <rect x=".5" y=".5" width="319" height="179" rx="8" style="fill:var(--paper);stroke:var(--line-2)"/>
    <path d="M.5 8A7.5 7.5 0 0 1 8 .5h304a7.5 7.5 0 0 1 7.5 7.5v10H.5Z" style="fill:var(--fill);stroke:var(--line-2)"/>
    <circle cx="12" cy="9" r="2" style="fill:var(--ink-3)"/>
    <circle cx="19" cy="9" r="2" style="fill:var(--ink-3)"/>
    <circle cx="26" cy="9" r="2" style="fill:var(--ink-3)"/>
    <rect x="64" y="6" width="192" height="6" rx="3" style="fill:var(--line-2)"/>
    <rect x="14" y="28" width="292" height="86" rx="4" style="fill:var(--fill);stroke:var(--line-2)"/>
    <circle cx="240" cy="58" r="15" style="fill:var(--accent);opacity:.22"/>
    <path d="M24 104l54-46 34 30 30-44 60 60Z" style="fill:var(--accent);opacity:.28"/>
    <rect x="92" y="126" width="136" height="8" rx="2" style="fill:var(--ink)"/>
    <rect x="112" y="139" width="96" height="5" rx="2.5" style="fill:var(--ink-3)"/>
    <rect x="138" y="154" width="44" height="13" rx="6.5" style="fill:var(--accent)"/>
  </svg>
  :::
- C 只问一句 | 首屏只留一个问题和一个按钮
  :::html
  <svg viewBox="0 0 320 180" width="320" height="180" role="img" aria-label="极简：一个问题、一个输入框和一个按钮" xmlns="http://www.w3.org/2000/svg">
    <rect x=".5" y=".5" width="319" height="179" rx="8" style="fill:var(--paper);stroke:var(--line-2)"/>
    <path d="M.5 8A7.5 7.5 0 0 1 8 .5h304a7.5 7.5 0 0 1 7.5 7.5v10H.5Z" style="fill:var(--fill);stroke:var(--line-2)"/>
    <circle cx="12" cy="9" r="2" style="fill:var(--ink-3)"/>
    <circle cx="19" cy="9" r="2" style="fill:var(--ink-3)"/>
    <circle cx="26" cy="9" r="2" style="fill:var(--ink-3)"/>
    <rect x="64" y="6" width="192" height="6" rx="3" style="fill:var(--line-2)"/>
    <rect x="78" y="62" width="164" height="10" rx="2" style="fill:var(--ink)"/>
    <rect x="104" y="82" width="112" height="5" rx="2.5" style="fill:var(--ink-3)"/>
    <rect x="84" y="108" width="106" height="20" rx="10" style="fill:var(--paper);stroke:var(--line-2)"/>
    <rect x="94" y="116" width="54" height="4" rx="2" style="fill:var(--ink-3)"/>
    <rect x="198" y="108" width="38" height="20" rx="10" style="fill:var(--accent)"/>
    <rect x="124" y="148" width="72" height="4" rx="2" style="fill:var(--ink-3)"/>
  </svg>
  :::
```

```callout info 选定之后
点右上角 Reply 把选项发给我。我按这个方向画完整页面，并保留另外两版做对比。
```
