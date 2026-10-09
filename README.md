<p align="center">
  <img src="docs/logo.svg" width="64" height="64" alt="Answer me with HTML logo">
</p>

<h1 align="center">Answer me with HTML</h1>

<p align="center">
  <b>Super Fast&nbsp;&nbsp;|&nbsp;&nbsp;ASD-STE100&nbsp;&nbsp;|&nbsp;&nbsp;Explainer Videos&nbsp;&nbsp;|&nbsp;&nbsp;One File, Offline</b>
</p>

<p align="center">
  <b>An agent skill. Ask a hard question, get a page you can actually read instead of a wall of text.<br>The model writes about 1/8 of the tokens it would need to hand-write the HTML.</b>
</p>

<p align="center">
  <a href="https://github.com/QingYunA/answer-me-with-html/releases"><img src="https://img.shields.io/github/v/release/QingYunA/answer-me-with-html?style=flat-square&logo=github&labelColor=16181d&color=2ea44f" alt="Release"></a>
  <a href="https://github.com/QingYunA/answer-me-with-html/stargazers"><img src="https://img.shields.io/github/stars/QingYunA/answer-me-with-html?style=flat-square&logo=github&labelColor=16181d&color=2ea44f" alt="Stars"></a>
  <img src="https://img.shields.io/badge/works%20with-Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Cursor%20%C2%B7%20OpenCode%20%C2%B7%20Pi-2ea44f?style=flat-square&labelColor=16181d" alt="Works with Claude Code, Codex, Cursor, OpenCode, Pi">
  <a href="https://www.theagenticleaderboard.com/alternatives/answer-me-with-html/"><img src="https://www.theagenticleaderboard.com/badges/new/answer-me-with-html.svg" alt="The New 100"></a>
</p>

<p align="center">
  <a href="https://answer-me-with-html.com/"><b>Website</b></a> · <a href="#install">Install</a> · <a href="#what-you-ask-what-you-get">Examples</a> · <a href="#explainer-videos">Videos</a> · <a href="#always-on-mode-recommended">Always-on mode</a> · <a href="docs/reference.md">Reference</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="docs/images/text-vs-page.png" alt="The same TCP question answered in plain text and with the skill: a wall of terminal text on the left, one readable page with diagrams on the right" width="100%">
</p>

Once installed, ask questions the way you always do:

```
> Explain the TCP three-way handshake
> Map out how the modules in this repo fit together
> Redis or Memcached for our cache?
```

The agent writes a short Markdown draft and hands it to the CLI that ships with the skill. About 50 ms later you have a page:

https://github.com/user-attachments/assets/d3063a28-5dfd-4c44-a562-be901c49b249

<p align="center"><sub>24-second demo. Turn the sound on for the music.</sub></p>

## Why not just ask for HTML?

You can. Models write decent HTML now. But most of what they write is not content. We counted the tokens in 9 pages the model wrote by hand, 4,893 tokens on average:

| Part of the page | Share | With this skill |
| :--- | ---: | :--- |
| SVG diagrams: coordinates and paths | 47% | The CLI writes it |
| CSS | 15% | The CLI writes it |
| HTML tags | 17% | The CLI writes it |
| Text | 21% | The model writes it, as Markdown |

With this skill the model writes only a Markdown draft. For the same questions that was 612 tokens on average, **about 1/8 of the hand-written HTML**. Less to write means less to wait for (3 topics × 3 runs, medians, Claude Sonnet 5.5, a plain Claude Code setup):

| | Ask for HTML directly | Answer me with HTML | |
| :--- | ---: | ---: | :--- |
| Tokens the model writes | 4,893 | **612** | **8× fewer** |
| Time | 31 s | **12 s** | **2.6× faster** |

<p align="center">
  <img src="docs/images/plain-vs-skill.png" alt="The same TCP question answered both ways" width="100%">
</p>

<p align="center"><sub>The same question, the same model, answered both ways. Both pages are usable.</sub></p>

The token counts are saved in [bench/corpus/tokens.json](bench/corpus/tokens.json), so `node bench/corpus.mjs` gives the same numbers every time. The pages themselves are a [download](https://github.com/QingYunA/answer-me-with-html/releases/download/v0.4.14/bench-corpus-2026-10-07.zip). The bill drops less than the writing, about 15% here, because every turn also reads the system prompt, your question and the conversation, with or without the skill. See [where the cost goes](bench/README.md#where-the-cost-goes).

Explainer videos save even more: about 18× fewer output tokens and 12× faster in [a small test](bench/README.md#explainer-videos).

## Install

You need [Node.js](https://nodejs.org/) 20 or newer. There is no `npm install` step. The CLI is bundled inside the skill.

### Let your agent install it (recommended)

Paste this into Claude Code, Codex, Cursor, OpenCode or any other agent:

> Install Answer me with HTML: read https://raw.githubusercontent.com/QingYunA/answer-me-with-html/main/INSTALL.md and follow it.

[INSTALL.md](INSTALL.md) is written for agents. It installs the plugin in Claude Code and the skill in other agents, keeps an existing install, asks you nothing, and ends with one report after checking the result with the TCP three-way handshake page. If your agent cannot open links, use `npx -y skills add QingYunA/answer-me-with-html -g -y -a <your agent name>` (for Claude Code, `-a claude-code`).

### Claude Code plugin

Run this inside Claude Code:

```
/plugin marketplace add QingYunA/answer-me-with-html
/plugin install answer-me-with-html@answer-me-with-html
```

### One command

```bash
npx skills add QingYunA/answer-me-with-html
```

It asks which agents to install into. The installer, [vercel-labs/skills](https://github.com/vercel-labs/skills), supports more than 70 agents.

<details>
<summary>Manual install</summary>

Copy the `skills/answer-me-with-html` folder into your agent's skill folder. For Claude Code:

```bash
git clone --depth 1 https://github.com/QingYunA/answer-me-with-html.git /tmp/answer-me-with-html
cp -R /tmp/answer-me-with-html/skills/answer-me-with-html ~/.claude/skills/answer-me-with-html
```

Skill folders for other agents: Codex `~/.codex/skills/`, Cursor `~/.cursor/skills/`, OpenCode `~/.config/opencode/skill/`.

</details>

No setup is needed after install. **We recommend turning on [always-on mode](#always-on-mode-recommended)**: the agent then adds a page to every conclusion, not only the hard ones. It takes one rule in your rules file.

## What you ask, what you get

| You ask | You get |
| :--- | :--- |
| "Explain the TCP three-way handshake" | A sequence diagram, a state diagram and a flag table |
| "How are the modules in this repo organized?" | A folder tree plus a call graph |
| "Redis or Memcached?" | A comparison table with ✓ and ✗, then a verdict |
| "What's wrong with this paragraph?" | Each sentence annotated, with the problem words and fixes |
| "How did Kubernetes come about?" | A timeline with the key moments highlighted |
| "Plan the cache change" | The real code from your files, and the open decisions as options you answer on the page |
| "How do I show hidden files with `ls`?" | No page. A one-line question gets a one-line answer |

The agent decides when a page is worth it: related concepts, multi-step flows, multi-way comparisons. You can also just say "explain it in HTML".

Pages are saved in `~/.answer-me-with-html/pages/`. The buttons in the top-right corner switch the theme and light/dark mode, collect your reply, and copy the Markdown that produced the page.

## How is this different from Archify or GenUI plugins?

[Archify](https://github.com/tt-a1i/archify) makes one interactive diagram from a JSON spec. GenUI plugins such as [dsh-genui](https://github.com/omdsh-dev/dsh-genui) show components inside one chat app. This skill answers the whole question as one page: text, tables, code and diagrams, from a Markdown draft, in any agent that can run a shell command. See the [full comparison](docs/compare.md).

## Explainer videos

Karpathy's ladder for understanding LLM output ends with explainer videos. Ask for one in 3Blue1Brown style: "make a 3b1b-style video on the TCP handshake".

<p align="center"><img src="docs/images/video-en.png" alt="Four frames from a generated explainer video in the blueprint style: title card, a sequence diagram with the Server highlighted, a flow diagram, and a comparison table" width="820"></p>

The agent writes the same kind of draft as for a page, plus one line of narration per beat. Nothing else:

````markdown
## Both sides wait
```sequence
Client -> Server: SYN
Server -> Client: SYN-ACK
```
> The client sends a SYN to ask for a connection.
> The [Server] answers with a SYN-ACK.
````

`am video` turns it into a player page. The diagram builds step by step with the narration, and the camera follows the node named in brackets. The voice is inside the page, so it plays offline. The player has a chapter strip to jump between scenes, a speed button, and an export button that encodes the video in the browser and downloads it (a local file or `localhost`, no ffmpeg). Add `--mp4` for an MP4 file (needs ffmpeg), or `--webm` for a WebM file the page encodes itself (no ffmpeg). The agent only makes videos when you ask. Details: [video guide](docs/video.md).

## Settings

Change settings with a slash command. There are no config files to edit by hand.

| Where | How |
| :--- | :--- |
| Claude Code (plugin install) | `/answer-me-with-html:config` asks what to change. `/answer-me-with-html:config open off` changes it directly |
| Any agent | `/answer-me-with-html config open off`, or just say "stop opening the browser" |
| Terminal | `am config` to view, `am config set open off` to change, `am config reset` to restore defaults |

The settings are `open` (open pages in the browser), `theme`, `mode` (light or dark), `style` (writing check), `update_check` and `voice` (video narration). Defaults and values: [reference](docs/reference.md#settings).

## Always-on mode (recommended)

With always-on mode, **every conclusion comes with a page**: whenever the agent gives a conclusion, summary, plan or comparison, even a short one, it adds a small page with 2 to 4 panels and puts the path at the end of the reply. These pages never pop open, so they don't interrupt you. Casual chat and replies with no conclusion stay as they are. Claude Code makes no pages in plan mode.

It is off by default. We recommend it: you stop asking for pages, and short answers read as well as long ones. Pages pile up in `~/.answer-me-with-html/`; clear them with `am clean`. To turn it on, paste this to your agent so it writes the rule into its rules file, such as `~/.claude/CLAUDE.md` or `AGENTS.md`:

> Turn on always-on mode for Answer me with HTML: add a global rule — "[answer-me-with-html always-on] Whenever a reply gives a conclusion, summary, plan, comparison, review or explanation, even a short one, also make a page with the answer-me-with-html skill (2 to 4 panels for routine answers), render it with --no-open before you write the reply, and end the reply with a file:// link to the page. Skip casual chat, one- or two-sentence replies with no conclusion, pure command output, and requests for plain text."

To turn it off, delete that rule. Want fewer pages instead? See [less proactive](docs/reference.md#less-proactive).

## Updating and cleaning up

Updates are manual. Once a week the agent checks GitHub for a new version number and tells you; nothing about you is sent. To update, tell your agent "update answer-me-with-html". Pages pile up in `~/.answer-me-with-html/`. Say "clean up the pages", and the agent asks before it deletes anything. Other install methods and every option: [reference](docs/reference.md#updating-and-cleaning-up).

## Background

Andrej Karpathy [posted](https://x.com/karpathy/status/2105819303471976479) that as LLMs do more of the work, keeping up with their output becomes the hard part. A diagram or a web page is far easier to take in than a long block of text.

I tried asking agents to answer in HTML directly. The pages were good, but slow: a decent page took a minute or two, mostly hundreds of lines of CSS that were nearly the same every time. Diagrams were worse. The model had to compute SVG coordinates by hand, and arrows often pointed at nothing.

So Answer me with HTML takes that work away from the model. The model writes content. The CLI handles layout, color and drawing.

## How it works

This is all the model writes:

````markdown
---
title: TCP three-way handshake
---
## A Three-way handshake {span=2}
```sequence num
Client -> Server: SYN, seq=x
Server -> Client: SYN+ACK, seq=y, ack=x+1
Client -> Server: ACK, ack=y+1
note Client, Server: ESTABLISHED
```

## C State changes {span=2}
```flow LR
(CLOSED) -> LISTEN: passive open
LISTEN -> SYN_RCVD: get SYN / send SYN+ACK
SYN_RCVD -> *ESTABLISHED: get ACK
```
````

The CLI does the rest. It picks the template, places the panels, applies the theme, lays out the flow chart with [dagre](https://github.com/dagrejs/dagre) and spaces the sequence diagram by label width. The full draft, [examples/tcp.en.md](examples/tcp.en.md), becomes this page:

<p align="center">
  <img src="docs/images/tcp-en.png" alt="The TCP example page" width="100%">
</p>

## Features

- **Layout by code:** Panel placement and diagram coordinates are computed, not guessed. Labels don't get cut off, and there are no gaps in the grid.
- **Fixes its own mistakes:** When a draft has an error, the CLI returns the line number, the component and a correct example. The agent fixes it in one try.
- **Three themes:** `blueprint` looks like an engineering drawing, `shadcn` uses clean cards, and `paper` is set for long reading. By default the CLI picks paper for long text and blueprint for diagrams. All have light and dark modes, and you can add your own.
- **One file, no dependencies:** Each page is a single `.html` with no CDN links or web fonts. It opens offline and is easy to share.
- **Languages:** Chinese (Simplified and Traditional), English and Japanese get their own buttons and fonts. Other languages work with English buttons. See [languages](docs/reference.md#languages).
- **Writing check:** Drafts are checked against rules adapted from ASD-STE100: long sentences, wordy phrases, passive voice. It only warns unless you ask for strict mode.
- **Real code, not retyped:** A code block can quote lines from your files (`src=` `lines=`), so the code on the page is the real code. Files outside the folder and files that hold keys are refused.
- **Answer on the page:** Comment on any panel, and pick options in the decisions the agent asks (`ask`). The Reply button turns your answers and comments into one message to paste back to the agent.
- **Keeps its source:** Every page embeds the Markdown that made it. Click "Copy source" to get it back.

<table>
  <tr>
    <td width="50%"><img src="docs/images/ste100.png" alt="Blueprint theme"></td>
    <td width="50%"><img src="docs/images/tcp-en-dark.png" alt="shadcn theme, dark"></td>
  </tr>
  <tr>
    <td align="center"><sub>Blueprint theme (<a href="examples/ste100.md">examples/ste100.md</a>)</sub></td>
    <td align="center"><sub>shadcn theme, dark mode</sub></td>
  </tr>
</table>

## Components

The agent picks a component by the shape of the information:

| Component | Good for |
| :--- | :--- |
| `flow` | Architecture, call chains, decision branches. Auto layout, with groups, decisions and databases |
| `er` | A data model: entities with their columns (PK / FK / UK) and crow's-foot relationships |
| `sequence` | Messages going back and forth between several parties over time |
| `tree` | Folders, modules, taxonomies |
| `timeline` | History, releases, phases |
| `limits` | A value against its limit |
| `annot` | Word-by-word notes on a sentence |
| `kv` | Metadata, a drawing's title block |
| `callout` | A conclusion, a tip, a warning |
| `ask` | A decision you make on the page; the agent's suggestion starts selected |
| Code block | Real code quoted from a file (`src=` `lines=`), or a sketch |
| Table | Multi-way comparison. Write `ok` / `no` / `warn` in a cell to get ✓ ✗ ! |

The draft format (frontmatter, `span`, `rows`, raw `html` / `svg` blocks) and how to call the CLI without an agent are in the [reference](docs/reference.md). Full syntax for a component: `am help <component>`.

## The STE writing check

[ASD-STE100](https://www.asd-ste100.org/) is a controlled form of English first used for aircraft maintenance manuals. Its rules are concrete: keep sentences short, give each word one meaning, write steps as commands. Karpathy noted that asking an LLM to follow these rules makes its writing much easier to read.

Every render checks the parts a machine can check: sentence length, plain words, passive voice, and common Chinese typos and vague words. It only warns by default. Set `/answer-me-with-html:config style strict` to refuse drafts that fail, or `style:` in one draft. The full rule list: [reference](docs/reference.md#writing-check).

## Development

```bash
git clone https://github.com/QingYunA/answer-me-with-html.git && cd answer-me-with-html
npm install
npm test          # run the tests
AM_E2E=1 npm test # also run end-to-end video tests (system TTS, Chrome, ffmpeg)
npm run smoke:install # install for real with npx skills and validate the plugin manifests (needs network)
npm run build     # after changing src/, rebuild skills/answer-me-with-html/scripts/am.mjs
npm run snapshot  # compare rendered HTML with origin/main (refactors must not change it)
```

Maintainer conventions (generated bundle, page format, snapshot checks, reviewing PRs, releasing) are in [CONTRIBUTING.md](CONTRIBUTING.md).

There are two runtime dependencies: [marked](https://github.com/markedjs/marked) parses Markdown and [@dagrejs/dagre](https://github.com/dagrejs/dagre) lays out flow charts. Both are bundled into `am.mjs`.

## Community

Discussion and feedback also happen on [LINUX DO](https://linux.do), a Chinese-language developer forum.

## Star History

<a href="https://star-history.com/#QingYunA/answer-me-with-html&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=QingYunA/answer-me-with-html&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=QingYunA/answer-me-with-html&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=QingYunA/answer-me-with-html&type=Date" />
  </picture>
</a>

## License

[MIT](LICENSE)
