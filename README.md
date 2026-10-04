<p align="center">
  <img src="docs/logo.svg" width="64" height="64" alt="Answer me with HTML logo">
</p>

<h1 align="center">Answer me with HTML</h1>

<p align="center">
  <b>An agent skill. Ask a hard question, get a page you can actually read instead of a wall of text.<br>The model writes about 1/7 of the tokens it would need to hand-write the HTML.</b>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <a href="https://github.com/QingYunA/answer-me-with-html/actions/workflows/ci.yml"><img src="https://github.com/QingYunA/answer-me-with-html/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/works%20with-Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Cursor%20%C2%B7%20OpenCode-black" alt="Works with Claude Code, Codex, Cursor, OpenCode">
</p>

<p align="center">
  <b>English</b> · <a href="README.zh-CN.md">简体中文</a>
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

You can. Models write decent HTML now. The problem is the bill you pay in output tokens: the model has to type every line of CSS, every wrapper `div` and every SVG coordinate. Output tokens are also what you sit and wait for.

With this skill, the model writes only the content. We asked the same questions with the same model both ways (3 topics × 3 runs, medians, Claude Sonnet 5.5):

| | Ask for HTML directly | Answer me with HTML | |
| :--- | ---: | ---: | :--- |
| Output tokens | 6,873 | **923** | **7.4× fewer** |
| Time | 46 s | **13 s** | **3.6× faster** |
| Cost per answer | $0.22 | $0.26 | about the same |

<p align="center">
  <img src="docs/images/plain-vs-skill.png" alt="The same TCP question answered both ways" width="100%">
</p>

<p align="center"><sub>One run from the benchmark: same prompt, same model, and both pages are usable. This run took 9,351 output tokens for the plain page and 899 with the skill. The table above shows the medians.</sub></p>

Why the cost doesn't drop too: the skill adds two short turns (load the skill, run the CLI), and every turn re-reads the conversation context. You save the waiting, not the bill. Per-topic numbers and the script to reproduce them are in [bench/](bench/README.md).

## Install

You need [Node.js](https://nodejs.org/) 20 or newer. There is no `npm install` step. The CLI is bundled inside the skill.

### Let your agent install it (recommended)

Paste this into Claude Code, Codex, Cursor, OpenCode or any other agent:

> Install the Answer me with HTML skill: run `npx -y skills add QingYunA/answer-me-with-html -g -y`, and pass `-a` with your own agent name (for Claude Code, `-a claude-code`). Then read its SKILL.md and use it to make a page that explains the TCP three-way handshake, so we know it works.

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

No setup is needed after install.

## What you ask, what you get

| You ask | You get |
| :--- | :--- |
| "Explain the TCP three-way handshake" | A sequence diagram, a state diagram and a flag table |
| "How are the modules in this repo organized?" | A folder tree plus a call graph |
| "Redis or Memcached?" | A comparison table with ✓ and ✗, then a verdict |
| "What's wrong with this paragraph?" | Each sentence annotated, with the problem words and fixes |
| "How did Kubernetes come about?" | A timeline with the key moments highlighted |
| "How do I show hidden files with `ls`?" | No page. A one-line question gets a one-line answer |

The agent decides when a page is worth it: related concepts, multi-step flows, multi-way comparisons. You can also just say "explain it in HTML".

Pages are saved in `~/.answer-me-with-html/pages/`. The buttons in the top-right corner switch the theme and light/dark mode, and copy the Markdown that produced the page.

## Explainer videos (3Blue1Brown style)

Karpathy's ladder for understanding LLM output ends with explainer videos. Ask for one: "make a 3b1b-style video on the TCP handshake".

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

`am video` turns it into a player page:

- **Built step by step.** When the Nth line of narration plays, the Nth step of the diagram appears. Arrows draw themselves. If there are more lines than steps, the extra lines at the start act as an intro.
- **Spoken narration.** The agent writes narration the way a person explains things out loud, not like a manual.
- **Camera focus.** `[Server]` in the narration pushes the camera toward that node and highlights it. The diagram never leaves the frame.
- **Objects carry over.** A node with the same name in the next scene glides to its new place instead of cutting.
- **Narration.** It uses ElevenLabs if `ELEVENLABS_API_KEY` is set, the system voice otherwise (macOS `say`: Tingting for Chinese, Samantha for English, Kyoko for Japanese), and captions only if neither exists. Each beat lasts as long as its audio, so picture and voice stay in sync.
- **Same look as the pages.** Videos use the blueprint drawing style by default: a ruled frame and lettered sheet heads. Write `theme: 3b1b` for the dark 3Blue1Brown look. `theme: shadcn` and `mode: dark` also work.
- **One file.** The page has the audio inside and plays offline. Add `--mp4` for a 1080p video file. This needs Chrome, ffmpeg and Node.js 22+ on your machine. Export takes about 1.3 times the video length.

The draft for the example video ([examples/video-tcp.en.md](examples/video-tcp.en.md), about 45 seconds) is 1.3 KB, a few hundred output tokens. Rendering takes under a second without voice and about 4 seconds with the system voice. The agent only makes videos when you ask; always-on mode still makes pages. Full syntax: `am help video`.

## Settings

Change settings with a slash command. There are no config files to edit by hand.

| Where | How |
| :--- | :--- |
| Claude Code (plugin install) | `/answer-me-with-html:config` asks what to change. `/answer-me-with-html:config open off` changes it directly |
| Any agent | `/answer-me-with-html config open off`, or just say "stop opening the browser" |
| Terminal | `am config` to view, `am config set open off` to change, `am config reset` to restore defaults |

| Key | Default | What it does |
| :--- | :--- | :--- |
| `open` | `on` | Open each page in the browser after it is made. Turn it off if pop-ups interrupt you |
| `always` | `on` | Always-on mode (see below). Only matters when the always-on plugin is installed |
| `theme` | `blueprint` | Default theme: `blueprint` or `shadcn` |
| `mode` | `auto` | Default color mode: `auto`, `light` or `dark` |
| `style` | `80` | Writing check: `off`, `80` (warn only) or `strict` (refuse to render) |
| `update_check` | `on` | Check GitHub for a new version once a week and mention it. Never updates by itself |
| `voice` | `auto` | Video narration: `auto` (ElevenLabs if `ELEVENLABS_API_KEY` is set, else system voice), `elevenlabs`, `system` or `off` |

Settings live in `~/.answer-me-with-html/config.json`. A theme written in a draft beats the default. `--open` and `--no-open` affect one run only.

## Always-on mode (optional)

By default, the agent makes a page only for questions that need one. If you want **a page with every conclusion**, turn on always-on mode.

The agent then gets a short reminder each turn (about 90 tokens). Whenever it gives a conclusion, summary, plan or comparison, even a short one, it adds a small page with 2 to 4 panels and puts the path at the end of the reply. These pages never pop open, so they don't interrupt you. Casual chat and replies with no conclusion stay as they are. Claude Code makes no pages in plan mode.

**Claude Code:** install one more plugin.

```
/plugin marketplace add QingYunA/answer-me-with-html
/plugin install answer-me-with-html-always@answer-me-with-html
```

Pause it with `/answer-me-with-html:config always off`. You don't need to uninstall.

**Other agents:** paste this to your agent so it writes the rule into its own rules file, such as `AGENTS.md`:

> Turn on always-on mode for Answer me with HTML: add a global rule — "[answer-me-with-html always-on] Whenever a reply gives a conclusion, summary, plan, comparison, review or explanation, even a short one, also make a page with the answer-me-with-html skill (2 to 4 panels for routine answers), render it with --no-open, and end the reply with the page path. Skip casual chat, one- or two-sentence replies with no conclusion, pure command output, and requests for plain text."

## Updating and cleaning up

**Updating.** Updates are manual, and the tool tells you when one is out. Once a week, a background process downloads this project's `package.json` from GitHub to read the latest version number. Nothing about you or your pages is sent, and the page you asked for never waits on it. When there is a newer version, the next render adds a one-line notice and the agent asks whether you want to update. Turn this off with `/answer-me-with-html:config update_check off`.

| Installed with | Update with |
| :--- | :--- |
| `npx skills add` | `npx skills update answer-me-with-html -y`, or tell your agent "update answer-me-with-html" |
| `git clone` + `npm link` | `git pull && npm install` in the repository |
| Claude Code plugin | In a terminal run `claude plugin update answer-me-with-html@answer-me-with-html` (or open `/plugin` → Installed → Update now), then `/reload-plugins`. To update automatically, turn on auto-update for this marketplace in `/plugin` → Marketplaces. Claude Code leaves it off for third-party marketplaces |

**Cleaning up.** Pages, videos and the narration cache build up in `~/.answer-me-with-html/`. If that folder grows past 200 MB, or passes 20 MB with no cleanup for 30 days, the agent asks once a week whether to clean it. Nothing is deleted without your OK.

- `/answer-me-with-html:clean` (plugin), or say "clean up the pages", previews first and then asks.
- `am clean` deletes pages and videos older than 30 days and empties the narration cache. `--days N` changes the cutoff, `--all` removes every page and video, and `--dry-run` only shows what would go. Your settings are always kept. If `pages`, `videos` or `cache` is itself a symlink, it is skipped: `am clean` never touches the files it points to, and the size count and cleanup hint ignore it. A folder that cannot be read is skipped too: its files are left out of the size count and the cleanup hint, so the size you see can be lower than the real use, and `am clean` does not delete them.

## Background

Andrej Karpathy [posted](https://x.com/karpathy/status/2105819303471976479) that as LLMs do more of the work, keeping up with their output becomes the hard part. A diagram or a web page is far easier to take in than a long block of text.

I tried asking agents to answer in HTML directly. The pages were good. They were also slow.

A decent page took a minute or two. Most of that time went into hundreds of lines of CSS that were nearly the same every time. Diagrams were worse: the model had to compute SVG coordinates by hand, and arrows often pointed at nothing.

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

- **Fewer tokens, less waiting:** The model writes a short draft, about 900 output tokens, instead of 7,000 tokens of HTML, CSS and SVG. See the [benchmark](bench/README.md).
- **Layout by code:** Panel placement and diagram coordinates are computed, not guessed. Labels don't get cut off, and there are no gaps in the grid.
- **Fixes its own mistakes:** When a draft has an error, the CLI returns the line number, the component and a correct example. The agent fixes it in one try.
- **Two themes:** `blueprint` looks like an engineering drawing. `shadcn` uses clean cards. Both have light and dark modes.
- **One file, no dependencies:** Each page is a single `.html` with no CDN links or web fonts. It opens offline and is easy to share.
- **Writing check:** Drafts are checked against rules adapted from ASD-STE100: long sentences, wordy phrases, passive voice. It only warns unless you ask for strict mode.
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
| `sequence` | Messages going back and forth between several parties over time |
| `tree` | Folders, modules, taxonomies |
| `timeline` | History, releases, phases |
| `limits` | A value against its limit |
| `annot` | Word-by-word notes on a sentence |
| `kv` | Metadata, a drawing's title block |
| `callout` | A conclusion, a tip, a warning |
| Table | Multi-way comparison. Write `ok` / `no` / `warn` in a cell to get ✓ ✗ ! |

<details>
<summary>Draft format (if you want to write drafts yourself)</summary>

````markdown
---
template: sheet        # sheet = grid of panels (default), doc = one column with a table of contents
theme: blueprint       # blueprint or shadcn
title: Page title
subtitle: One line
cols: 3                # columns for sheet
source: RFC 9293       # any other field shows under the title
---
A sentence or two with the main point.

## A Panel title {span=2 meta="small text, top right"}
Plain Markdown: paragraphs, lists, tables.

```flow LR
A -> B: label
```
````

- Every `## ` heading is a panel. The letters A, B, C are optional and added for you.
- `span=2` makes a panel two columns wide, `rows=2` makes it two rows tall, and `bare` removes its title bar.
- When no component fits, use a ```` ```html ```` or ```` ```svg ```` block to embed raw markup.

Full syntax for a component: `am help <component>`.

</details>

<details>
<summary>Use the CLI directly, without an agent</summary>

The CLI is `scripts/am.mjs` inside the skill folder.

````bash
AM=skills/answer-me-with-html/scripts/am.mjs

node $AM render examples/tcp.en.md                # render and open in the browser
node $AM render notes.md -o out.html --no-open    # choose the output file, don't open
node $AM render notes.md --theme shadcn           # pick a theme for this run
node $AM patch page.html --panel "Why three messages" < panel.md   # replace one ## panel, overwrite the same file
node $AM lint notes.md                            # writing check only
node $AM list                                     # list components
node $AM config                                   # view settings

# Read from stdin. This is how agents call it.
node $AM render - <<'AM_EOF'
## A One panel
```flow
A -> B: hello
```
AM_EOF
````

Pages go to `~/.answer-me-with-html/pages/` by default. Set `AM_HOME` to move them.

</details>

## The STE writing check

[ASD-STE100](https://www.asd-ste100.org/) is a controlled form of English first used for aircraft maintenance manuals. Its rules are concrete: keep sentences short, give each word one meaning, write steps as commands. Karpathy noted that asking an LLM to follow these rules makes its writing much easier to read.

Answer me with HTML turns the parts a machine can check into an English and Chinese rule set, and runs it on every render:

- **Length:** Steps stay under 20 English words or 35 Chinese characters. Descriptions stay under 25 words or 45 characters. Paragraphs have at most 6 sentences.
- **Words:** Prefer common words: "use", not "utilize"; "before", not "prior to". In Chinese, drop empty verbs: write 优化, not 进行优化.
- **Style:** Flags English passive voice, three or more 的 in one sentence, and stock phrases such as 赋能 and 闭环.
- **Japanese:** A draft with kana is treated as Japanese: the page buttons are in Japanese and the page gets `lang="ja"`. Only the length rules apply, with the Chinese character limits. Write `lang: ja` in the draft to force it.

Set the strictness with `/answer-me-with-html:config style strict`, or per page with `style:` in the draft.

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

To refresh the demo video: serve [docs/demo/demo.html](docs/demo/demo.html) next to the rendered [examples/tcp.en.md](examples/tcp.en.md) (`tcp.html`), open it at 1920×1080, wait for `window.ready`, then call `window.render(i / 30)` and screenshot `frame-0000.jpg` … `frame-0719.jpg`. Run `node docs/demo/make-demo.mjs <frames-dir>` to add the music and encode. The MP4 and GIF are not committed, because plugin installs copy the whole repository. Upload the MP4 to a GitHub comment and use that link in the README. The animation is deterministic, and the music from [docs/demo/music.mjs](docs/demo/music.mjs) is synthesized at 120 BPM, so every scene change lands on a beat.

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
