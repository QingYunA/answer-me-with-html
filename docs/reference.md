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

Full syntax for a component: `am help <component>`.

## Code blocks

Quote code that exists in the project instead of typing it:

````markdown
```ts src=server/routes.ts lines=18-30 hl=22
```
````

- Any fence whose language is not a component is a code block, with a header and a Copy button.
- `src=` reads the file and `lines=18-30` picks the lines, numbered as in the file. Leave the block empty. The path is read from the current folder, and only files inside it are quoted.
- `hl=22` or `hl=20-22,25` highlights lines. For code you type, `title="limits.ts · sketch"` names it and `start=38` numbers it from line 38.
- At most 200 lines in a block. Files that hold keys by convention (`.env`, `*.pem`, `id_rsa` …) and lines that look like a key or a token are refused.
- The render lists every file it embedded. The page keeps the path; `am patch` reads the file again, or keeps the page's copy when the file has moved.

Full syntax: `am help code`.

## Images

For something a diagram cannot show, such as a real screen, use an image that already exists as a file:

```markdown
![The three viewing modes of the game](/absolute/path/to/screenshot.png)
```

- Put the image alone on its line. The alt text becomes its caption, so write what the picture shows. The writing check reads it.
- Use the absolute path. A relative path is read from the draft file's folder, or from the current folder when the draft comes from stdin.
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
| any other tag, such as `fr` or `ko` | as written | English labels |

A tag is written as you declare it: `zh-tw` and `zh_TW` both become `zh-TW`. An empty, `und` or invalid value is ignored and the text decides.

| Script in the text | Detected as |
| :--- | :--- |
| Han | `zh-CN` (Simplified), or `zh-Hant` when more characters are written only in the Traditional form than only in the Simplified form |
| Han with kana | `ja` |
| Hangul | `ko` |
| Cyrillic, Arabic, Hebrew, Thai, Greek | `ru`, `ar`, `he`, `th`, `el` (the most common language of the script) |
| Latin | `en` |

Declare the language when you write a Latin-script language other than English, when a Chinese text is too short or too plain to show Traditional characters (characters both forms share say nothing, and the text stays Simplified), or when the exact language matters: Arabic script also writes Persian, and Cyrillic also Ukrainian.

A patched page keeps the language it had, unless the draft declares one.

The writing check follows the language. Chinese, English and Japanese keep their rules. Any other language gets only the language-neutral ones: sentence length (in words, or in characters for CJK text) and paragraph length.

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
