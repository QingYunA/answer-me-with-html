---
title: How this repo turns a draft into a page
subtitle: answer-me-with-html, the render path
cols: 3
---
## A Folders {meta="trimmed"}
```tree list
answer-me-with-html
  bin/am.js | CLI entry
  src
    cli.js | commands and flags
    parse.js | frontmatter and panels
    *render.js | the pipeline
    components/ | flow, sequence, tree ...
    lint/ste.js | writing check
    themes/ | blueprint, shadcn, paper
    templates/ | sheet and doc
    runtime/ | page script
  skills/answer-me-with-html
    SKILL.md | what the agent reads
    scripts/am.mjs | bundled CLI
```

## B Call graph {span=2}
```flow LR
(am render) -> cli.js
cli.js -> *render.js
render.js -> parse.js: draft
render.js -> lint/ste.js: prose
render.js -> components: fences
components -> dagre: flow layout
render.js -> templates & themes
templates -> [(page.html)]
group Bundled into am.mjs: cli.js, render.js, parse.js, lint/ste.js, components, templates, themes, dagre
```

## C Where to start reading {span=3}
1. Open `src/render.js`. One function runs the whole pipeline.
2. Read `src/parse.js` next. It splits a draft into panels and fences.
3. Pick one component in `src/components/`. Each one turns text into SVG or HTML.
