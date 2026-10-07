# Reference

[简体中文](reference.zh-CN.md)

## Draft format

````markdown
---
template: sheet        # sheet = grid of panels (default), doc = one column with a table of contents
theme: auto            # auto (default) picks paper for long text, blueprint for diagrams; or blueprint, shadcn, paper, your own theme
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
- `span=2` makes a panel two columns wide, `rows=2` makes it two rows tall, and `bare` removes its title bar. `span` is a hint: the page sizes each panel to its content, so wide tables and diagrams need no `span`. Write `span` only for a panel that must stand out. `rows` applies only to the plain grid (without JavaScript, in print and on narrow screens); the justified layout in a browser ignores it.
- When no component fits, use a ```` ```html ```` or ```` ```svg ```` block to embed raw markup.
- A placeholder such as `<host>` is shown as text. Inside a sentence only text-level tags stay (`b`, `kbd`, `sup`, `a`, `span`, `br`, `img` ...), and tags that break the page (`script`, `style`, `iframe` ...) are shown as text too. Put raw markup in an `html` or `svg` block and code in backticks. The render lists every tag it changed.

Full syntax for a component: `am help <component>`.

## Answer on the page

Every page has a **Reply** button. The reader comments on any panel (the speech-bubble button in its title bar) and copies one Markdown reply back to the agent. Answers and comments survive a reload.

For a decision the reader must make, write an `ask` block in the panel it changes:

````markdown
```ask
Which cache do we use?
* Redis | keeps data after a restart
- Memcached | simpler, no disk
```
````

- The first line is the question. Each option starts with `*` (the suggestion, selected at the start) or `-`. Write 2 to 6 options.
- One choice needs exactly one `*`. `ask multi` lets the reader pick several; `*` marks the options that start picked.
- The reply says for each decision whether the reader changed it, confirmed the suggestion, or did not answer it. Comment text comes back quoted with `>`.

Full syntax: `am help ask`.

## Code blocks

Quote code that exists in the project instead of typing it:

````markdown
```ts src=server/routes.ts lines=18-30 hl=22
```
````

- Any fence whose language is not a component is a code block, with a header and a Copy button.
- `src=` reads the file and `lines=18-30` picks the lines, numbered as in the file. Leave the block empty. The path is read from the current folder, and only files inside it are quoted.
- `hl=22` or `hl=20-22,25` highlights lines. For code you type, `title="limits.ts · sketch"` names it and `start=38` numbers it from line 38.
- A block longer than 40 lines gets a warning; more than 200 lines is an error. Files that hold keys by convention (`.env`, `*.pem`, `id_rsa`, `.ssh/`, `.git/` …) and files with anything that looks like a key or a token are refused. The rules follow html-plan's.
- The render lists every file it embedded. The page keeps the path; `am patch` reads the file again, or keeps the page's copy when the file has moved.

To show a change, paste a unified diff in a `diff` fence and the CLI draws it:

````markdown
```diff file=src/code.js
@@ -60,3 +60,3 @@
 export function parseCodeArgs(args) {
-  const attrs = parseAttrs(args);
+  const attrs = parseAttrs(args, { diff: true });
   const opts = {};
```
````

- Lines starting with `+` are added (green), `-` removed (red), a space is context. `@@ -60,3 +60,3 @@` starts a hunk: it shows as a thin row and sets the line numbers, in two gutters (old and new). Without `@@`, `start=N` numbers from N; with neither, the block has no numbers.
- `file=` names the file in the header, and the language label comes from its extension. A `+++ b/path` line names it when `file=` is missing. The header also shows a stat such as `+1 −1`. Copy copies the diff as written.
- `hl=` uses new-side numbers. `diff --git`, `---`, `+++` and `\ No newline at end of file` lines are accepted and not drawn.
- A line that does not start with `+`, `-`, a space or `@@` is an error, and so is a cut (`...`): split the diff into two hunks. A hunk whose counts do not match its `@@` header is a warning. `src=` is not supported with `diff`: paste the diff. The limits are the same as for other code blocks.

Full syntax: `am help code`.

## Images

For something a diagram cannot show, such as a real screen, use an image that already exists as a file:

```markdown
![The three viewing modes of the game](/absolute/path/to/screenshot.png)
```

- Put the image alone on its line. The alt text becomes its caption, so write what the picture shows. The writing check reads it.
- Use the absolute path. A relative path is read from the draft file's folder, or from the current folder when the draft comes from stdin. A space in the path is fine.
- PNG, JPG, GIF, WebP, AVIF and SVG files up to 5 MB. The file is embedded in the page, so the page stays one file that opens offline. A wide image scales down to its panel.
- `http(s)` URLs and `data:` URIs are left as they are. A URL needs the network when the page is opened.
- The page keeps the path of each image. `am patch` embeds the image again from the file, or from the page when the file has moved.
- The tool does not generate images.

Full syntax: `am help image`.

## Use the CLI directly, without an agent

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

## Languages

The language of a draft sets the page's `lang` attribute, the language of the buttons and theme names, the fonts, and the video player labels. A draft can declare it with `lang:` in the header. Without it, the tool detects the language from the script of the text.

| `lang:` | `<html lang>` | Labels and fonts |
| :--- | :--- | :--- |
| `zh`, `zh-CN`, `zh-Hans` | as written (a bare `zh` becomes `zh-CN`) | Simplified Chinese |
| `zh-Hant`, `zh-TW`, `zh-HK`, `zh-MO` | as written | Traditional Chinese, with Traditional fonts first |
| `en`, `en-US` and other English tags | as written | English |
| `ja`, `ja-JP` | as written | Japanese, with Japanese fonts first |
| `he`, `he-IL` | as written | Hebrew, with Hebrew fonts first; the page is right to left |
| any other tag, such as `fr` or `ko` | as written | English labels |

A tag is written as you declare it: `zh-tw` and `zh_TW` both become `zh-TW`. An empty, `und` or invalid value is ignored and the text decides.

A right-to-left language (`he`, `ar`, `fa`, `ur`, `yi`) also gets `<html dir="rtl">`. The page mirrors: text, panels, tables, the table of contents and the toolbar start from the right; `flow` and `sequence` diagrams are drawn as their mirror image, so the first node or participant is on the right and arrows point left; timelines, trees and limits bars start from the right. Code blocks, diffs and inline code stay left to right. Hebrew has its own labels; the other right-to-left languages use English labels.

| Script in the text | Detected as |
| :--- | :--- |
| Han | `zh-CN` (Simplified), or `zh-Hant` when more characters are written only in the Traditional form than only in the Simplified form |
| Han with kana | `ja` |
| Hangul | `ko` |
| Cyrillic, Arabic, Hebrew, Thai, Greek | `ru`, `ar`, `he`, `th`, `el` (the most common language of the script) |
| Latin | `en` |

Declare the language when you write a Latin-script language other than English, when a Chinese text is too short or too plain to show Traditional characters (characters both forms share say nothing, and the text stays Simplified), or when the exact language matters: Arabic script also writes Persian, and Cyrillic also Ukrainian.

A patched page keeps the language it had, unless the draft declares one.

Diagram text wraps by the unit the script uses: one Han, kana or fullwidth character, one word where the script writes spaces, and one dictionary word for the scripts that write none (Thai, Lao, Khmer and Myanmar), so a long word does not push a node wider than its budget. A word that does not fit the line on its own falls back to graphemes, so a combining mark stays with its base character.

The writing check follows the language. Chinese, English and Japanese keep their rules. Any other language gets only the language-neutral ones: sentence length (in words, or in characters for CJK text) and paragraph length. A script that writes no space between words is measured in words found by the word segmenter, the same four scripts the diagrams wrap with.

## Your own theme

Put one JSON file per theme in `~/.answer-me-with-html/themes/`. The file name is the theme name, so `themes/notes.json` is the theme `notes`. Pick it like a built-in theme: `theme: notes` in the draft, `--theme notes`, or `am config set theme notes`. The agent writes the same draft, so a theme adds nothing to each answer.

```json
{
  "label": "Notes",
  "tokens": {
    "common": { "--font-sans": "\"IBM Plex Sans\", \"Noto Sans CJK SC\"" },
    "light": { "--bg": "#f7f5ef", "--paper": "#fffdf8", "--ink": "#1f1d1a" },
    "dark": { "--bg": "#14130f", "--paper": "#1c1b17", "--ink": "#eeeae0" }
  },
  "css": "& .am-panel-head { letter-spacing: 0.01em; }"
}
```

- Light and dark must each set every color variable. `am help theme` lists them and shows the whole format.
- Name installed fonts only. The default fonts are added as the fallback, so a reader without your fonts still gets readable text.
- In `css`, start every selector with `&`. It stands for the theme's root, so the rules apply only under this theme.
- Each page carries the built-in themes plus its own theme, so it still opens on any machine.
- `am theme check notes` reports missing variables, invalid colors and low contrast in light and dark, and renders two specimen pages with every component.

## Updating and cleaning up

**Updating.** Updates are manual, and the tool tells you when one is out. Once a week, a background process downloads this project's `package.json` from GitHub to read the latest version number. Nothing about you or your pages is sent, and the page you asked for never waits on it. When there is a newer version, the next render adds a one-line notice and the agent asks whether you want to update. Turn this off with `/answer-me-with-html:config update_check off`.

| Installed with | Update with |
| :--- | :--- |
| `npx skills add` | `npx skills update answer-me-with-html -y`, or tell your agent "update answer-me-with-html" |
| `git clone` + `npm link` | `git pull && npm install` in the repository |
| Claude Code plugin | In a terminal run `claude plugin update answer-me-with-html@answer-me-with-html` (or open `/plugin` → Installed → Update now), then `/reload-plugins`. To update automatically, turn on auto-update for this marketplace in `/plugin` → Marketplaces. Claude Code leaves it off for third-party marketplaces |

**Cleaning up.** Pages, videos and the narration cache build up in `~/.answer-me-with-html/`. If that folder grows past 200 MB, or passes 20 MB with no cleanup for 30 days, the agent asks once a week whether to clean it. Nothing is deleted without your OK.

- `/answer-me-with-html:clean` (plugin), or say "clean up the pages", previews first and then asks.
- `am clean` deletes pages and videos older than 30 days and empties the narration cache. `--days N` changes the cutoff, `--all` removes every page and video, and `--dry-run` only shows what would go. Your settings and themes are always kept. If `pages`, `videos` or `cache` is itself a symlink, it is skipped: `am clean` never touches the files it points to, and the size count and cleanup hint ignore it. A folder that cannot be read is skipped too: its files are left out of the size count and the cleanup hint, so the size you see can be lower than the real use, and `am clean` does not delete them.

**Old always-on plugin.** It is gone from this repository, but your copy keeps adding the reminder until you remove it. Run `/plugin uninstall answer-me-with-html-always@answer-me-with-html`, then add the always-on rule from the [README](../README.md#always-on-mode-recommended).

## Settings

| Key | Default | What it does |
| :--- | :--- | :--- |
| `open` | `on` | Open each page in the browser after it is made. Turn it off if pop-ups interrupt you |
| `theme` | `auto` | Default theme: `auto` (paper for long text, blueprint for diagrams), `blueprint`, `shadcn`, `paper`, or your own theme |
| `mode` | `auto` | Default color mode: `auto`, `light` or `dark` |
| `style` | `80` | Writing check: `off`, `80` (warn only) or `strict` (refuse to render) |
| `update_check` | `on` | Check GitHub for a new version once a week and mention it. Never updates by itself |
| `voice` | `auto` | Video narration: `auto` (ElevenLabs if `ELEVENLABS_API_KEY` is set, else system voice), `elevenlabs`, `local`, `system` or `off` |

Settings live in `~/.answer-me-with-html/config.json`. A theme written in a draft beats the default. `--open` and `--no-open` affect one run only.

## Less proactive

By default the agent makes a page whenever one would help. If that is too much, pick one of two ways. Do not combine either with always-on mode.

**Only when you ask in words.** Add this rule to your rules file, such as `~/.claude/CLAUDE.md` or `AGENTS.md`:

> Do not use the answer-me-with-html skill unless I ask for a page, a diagram or a visual explanation, or say I don't get it.

The rule survives updates. The agent still sees the skill, so it follows the rule by judgment.

**Only with the slash command (Claude Code).** Add `disable-model-invocation: true` to the frontmatter of the installed `SKILL.md`, such as `~/.claude/skills/answer-me-with-html/SKILL.md`. The agent then never sees the skill, and a page appears only when you type `/answer-me-with-html`. An update replaces the file, so add the line again afterwards. See the [Claude Code skills docs](https://code.claude.com/docs/en/skills).

## Writing check

Answer me with HTML turns the parts a machine can check into an English and Chinese rule set, and runs it on every render:

- **Length:** Steps stay under 20 English words or 35 Chinese characters. Descriptions stay under 25 words or 45 characters. Paragraphs have at most 6 sentences.
- **Words:** Prefer common words: "use", not "utilize"; "before", not "prior to". In Chinese, drop empty verbs: write 优化, not 进行优化.
- **Chinese vocabulary:** Common typos (登陆 → 登录), vague quantities (尽快, 若干, 大概, 多次), 以上 / 以下 / 以内 after a number (the endpoint is ambiguous), and one-meaning-one-word choices (单击 → 点击, 键入 → 输入, 入参 → 参数). Only the entries that are almost never wrong, taken from [Simplified Technical Chinese](https://github.com/mzopedia/simplified-technical-chinese), a controlled Chinese modelled on the STE method.
- **Style:** Flags English passive voice, three or more 的 in one sentence, and stock phrases such as 赋能 and 闭环.
- **Japanese:** A draft with kana is treated as Japanese: the page buttons are in Japanese and the page gets `lang="ja"`. Only the length rules apply, with the Chinese character limits. Write `lang: ja` in the draft to force it.
- **Other languages:** Any other language gets only the length rules: sentences in words (characters for Chinese and Japanese text), paragraphs in sentences. The English and Chinese word lists and the passive-voice rule do not run on it.

Set the strictness with `/answer-me-with-html:config style strict`, or per page with `style:` in the draft.
