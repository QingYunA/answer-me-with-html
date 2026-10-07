---
title: 这个仓库怎么把稿件变成页面
subtitle: answer-me-with-html 的渲染路径
cols: 3
---
## A 目录 {meta="节选"}
```tree list
answer-me-with-html
  bin/am.js | CLI 入口
  src
    cli.js | 命令与参数
    parse.js | 解析稿头和面板
    *render.js | 渲染流水线
    components/ | flow、sequence、tree 等组件
    lint/ste.js | 写作检查
    themes/ | blueprint、shadcn、paper
    templates/ | sheet 与 doc 模板
    runtime/ | 页面脚本
  skills/answer-me-with-html
    SKILL.md | Agent 读的说明
    scripts/am.mjs | 打包好的 CLI
```

## B 调用关系 {span=2}
```flow LR
(am render) -> cli.js
cli.js -> *render.js
render.js -> parse.js: 稿件
render.js -> lint/ste.js: 正文
render.js -> components: 代码块
components -> dagre: 流程图布局
render.js -> templates & themes
templates -> [(page.html)]
group 打包进 am.mjs: cli.js, render.js, parse.js, lint/ste.js, components, templates, themes, dagre
```

## C 从哪里读起 {span=3}
1. 先看 `src/render.js`，一个函数串起整条流水线。
2. 再看 `src/parse.js`，它把稿件拆成面板和代码块。
3. 在 `src/components/` 里挑一个组件看，每个组件把文本变成 SVG 或 HTML。
