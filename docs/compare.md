# How it compares

[简体中文](compare.zh-CN.md)

Other tools also turn agent output into something visual. Two come up most: [Archify](https://github.com/tt-a1i/archify) and the GenUI plugins for DeepSeek Harness, such as [dsh-genui](https://github.com/omdsh-dev/dsh-genui). Each one does a different job.

| | Answer me with HTML | Archify | dsh-genui |
| :--- | :--- | :--- | :--- |
| The model writes | A Markdown draft | A typed JSON spec | JSON in a `dsh-ui` fence |
| You get | One page that answers the question | One interactive diagram | Components inside the chat reply |
| What fits on it | Text, tables, real code from your files, 12 components (flow, er, sequence, tree, timeline …) | Five diagram types: architecture, workflow, sequence, data flow, lifecycle | 30+ components: cards, tables, charts, forms, quizzes, 3D scenes |
| Where it works | Any agent that can run a shell command: Claude Code, Codex, Cursor, OpenCode, Pi | Claude Code, Codex, opencode, Cursor; Claude.ai by upload | The DeepSeek Harness web UI |
| The result | A single `.html` file, no CDN or web fonts, opens offline | A single `.html` file | Shown in the chat; finished blocks export to HTML |
| Interaction | Comments and decisions on the page; one Reply message to paste back | Focus, route tracing, search, presentation mode, PNG / SVG / WebM export | Buttons, forms and quizzes send events back to the model; renders while the model writes |
| Checks | Draft errors come back with the line and a fix; ASD-STE100 writing check | Schema, layout and route checks before delivery | A spec guard drops bad nodes |
| Video | `am video`: narrated, 3Blue1Brown style | Animated diagram export | No |

## Pick by the job

- **Archify** when you want one diagram of a system, to explore, present or export as an image or video. Its diagram tools go further than ours.
- **dsh-genui** when you work in the DeepSeek Harness web UI and want a live tool in the chat: forms, quizzes, clicks that go back to the model.
- **Answer me with HTML** when you work in a terminal agent and want the whole answer as one page: the explanation, the comparison, the code and the diagrams. You can read it, keep it and send it to someone.

## What is different here

- **A page, not one diagram.** A hard question needs text and a table next to the diagram. The agent picks the components by the shape of the answer.
- **The model writes only content.** The CLI does the layout, the colours and every coordinate. A page draft is about 600 tokens in our [benchmark](../bench/README.md), against about 4,900 for a hand-written HTML page on the same question. We did not measure Archify or dsh-genui.
- **No host needed.** The agent runs one shell command. Nothing has to render inside the chat app.
- **Text you can trust.** Code blocks quote your real files, and the writing check keeps sentences short and plain.

The facts about Archify and dsh-genui come from their READMEs, checked on 2026-10-07. If something here is out of date, please [open an issue](https://github.com/QingYunA/answer-me-with-html/issues).
