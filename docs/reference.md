# Reference

[简体中文](reference.zh-CN.md)

## Draft format

````markdown
---
template: sheet        # sheet = grid of panels (default), doc = one column with an outline rail
theme: auto            # auto (default) picks paper for long text, blueprint for diagrams; or blueprint, shadcn, paper, your own theme
title: Page title
subtitle: One line
cols: 3                # columns for sheet (a whole number)
outline: right         # doc with 3 or more sections: the side of the outline rail, left or right (default right)
source: RFC 9293       # any other field shows under the title
---
A sentence or two with the main point.

## A Panel title {span=2 meta="small text, top right"}
Plain Markdown: paragraphs, lists, tables.

```flow LR
A -> B: label
```
````

- Every `## ` heading is a panel. The ID is optional and added for you: A to Z for the first 26 panels, then `P27`, `P28` and so on. An ID you write yourself must be unique, and it is the same ID the automatic series would give: `## P27 Title` declares `P27`, and a later automatic panel cannot also be `P27`.
- `span=2` makes a panel two columns wide, `rows=2` makes it two rows tall, and `bare` removes its title bar. `span` and `rows` are whole numbers; a fraction such as `span=2.5` is an error. `span` is a hint: the page sizes each panel to its content, so wide tables and diagrams need no `span`. Write `span` only for a panel that must stand out. `rows` applies only to the plain grid (without JavaScript, in print and on narrow screens); the justified layout in a browser ignores it.
- When no component fits, use a ```` ```html ```` or ```` ```svg ```` block to embed raw markup. The page carries a Content-Security-Policy, so a script or an inline event handler in the block does not run and nothing loads from the network.
- A placeholder such as `<host>` is shown as text. Inside a sentence only text-level tags stay (`b`, `kbd`, `sup`, `a`, `span`, `br`, `img` ...), and tags that break the page (`script`, `style`, `iframe` ...) are shown as text too. Put raw markup in an `html` or `svg` block and code in backticks. The render lists every tag it changed.
- A `doc` page with 3 or more panels gets an outline rail: one short tick per section beside the body, on the side `outline:` names (`left` or `right`, default `right`; on a right-to-left page the sides mirror). Hover or focus a tick to see its title; dwell on the rail, or click or tap it, to open the full list; the current section is marked as you scroll. Arrow keys move through the list and Esc closes it. Without JavaScript the list still opens and the links still jump. Print hides the rail.

Full syntax for a component: `am help <component>`.

## Answer on the page

Every page has a **Reply** button. The reader comments on any panel (the speech-bubble button in its title bar) and copies one Markdown reply back to the agent. Answers and comments survive a reload. Once the reader answers, comments or remarks, a bar at the bottom of the page shows the counts and copies the reply in one click; the Reply sheet shows the reply drawn, with the copied Markdown under a fold.

The **Remark** button turns on block marking. While it is on, the reader clicks a paragraph, list item, quote, code block, table or $$ formula block, picks a kind (suggestion, keep, question or concern) and may add a note. The mark shows on the block, survives a reload, and comes back in the reply under Remarks with the start of the block quoted. A page title or panel title takes no mark; use the panel comment for it.

While remark mode is on, `Tab` also reaches every block, and `Enter` or `Space` opens its popover. The popover works from the keyboard. Its tags are numbered: `1`–`4` pick one and move the focus to the note (inside the note, digits are text). Until a tag is picked, Save stays off and the popover says so. `Ctrl` / `⌘` + `Enter` saves. Closing the popover without Save (`Esc` or a click outside) keeps its tag and note as a draft for that block until the page reloads; **Clear all remarks** drops drafts too.

For a decision the reader must make, write an `ask` block in the panel it changes:

````markdown
```ask
Which cache do we use?
* Redis | keeps data after a restart
- Memcached | simpler, no disk
```
````

- The first line is the question. Each option starts with `*` (the suggestion, shown with a tag; every option starts unselected) or `-`. Write 2 to 6 options.
- One choice needs exactly one `*`. `ask multi` lets the reader pick several; `*` marks the options you suggest; they start unselected too.
- The reply says for each decision whether the reader changed it, confirmed the suggestion, or did not answer it. Comment text and remark notes come back quoted with `>`.

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
- Remote images do not load: the page blocks every remote request, so an `http(s)` or `//` URL shows nothing, and the render warns about it. Save the image and use its local path. `data:` URIs work.
- The page keeps the path of each image. `am patch` embeds the image again from the file, or from the page when the file has moved.
- The tool does not generate images.

Full syntax: `am help image`.

## Math

For a formula in the text, write LaTeX between dollar signs:

```markdown
The weight of a vertex is $w(v)=\prod_{u\prec v}N_u^{-1}$.

$$
\widehat g=\sum_{i=1}^{n} w_i\widehat A_i\nabla_\theta\log\pi_\theta(a_i\mid s_i)
$$
```

- `$…$` is an inline formula. A block is a line with only `$$`, the TeX on the lines after it, and a line with only `$$`; one line `$$ E = mc^2 $$` also works. A block has no blank line inside it.
- [Temml](https://temml.org) typeset the TeX when the page is made and writes MathML, so the page needs no script and no network. A page with math carries a small math font (about 9 KB) and its styles; a page without math is unchanged. The formula takes the colour of the text, so every theme and mode works.
- A formula stays left to right on a right-to-left page.
- A display formula that is wider than its panel scrolls inside the panel. An inline formula wraps after a relation or an operator (`=`, `+`) in Chrome and Firefox; Safari does not wrap it. Put a long formula in a `$$` block.
- A dollar sign that is not a formula stays text. The opening `$` has a non-space after it. The closing `$` has a non-space before it and no digit after it, so `$5 and $10` and `$5-$10` stay text. A closing `$` with a letter (A-Z, a-z) or `_` after it does not close either, so `$PATH:$HOME` stays text; write `$n$-th`, not `$n$th`. Write `\$` for a dollar sign. An inline formula is on one line.
- Math works in the text of paragraphs, lists, tables, quotes, headings, callouts, `kv`, `ask`, `timeline` and `tree`. Code spans, code blocks, diagrams (`flow`, `er`, `sequence` and the others) and `am video` take no math. In a table cell write `\vert x \vert`, not `|x|`.
- If Temml cannot read the TeX, the page is still written. The formula shows as raw TeX in red and monospace (the message is in its tooltip), and the render prints a warning with the draft line, like `L12 [math] $\foo$ is shown as raw TeX: ...`. A page with a math warning does not open; fix the TeX and render again with `--replace`.
- `\ref`, `\eqref` and `\label` need a script that the page does not have. They give a warning and show nothing. `\tag{1}` works in a `$$` block.
- A Remark or a Reply quotes a formula as the TeX you wrote, with its `$` or `$$`: `Energy $E = mc^2$ holds`.
- The writing check skips the TeX.

Syntax in the CLI: `am help format`.

## Charts

For numbers that you compare, write a `chart` block. It draws bars, a line or a pie from a table, so you do not write an `svg` block by hand:

````markdown
```chart bar unit=ms
       | p50 | p95
* Redis     | 12  | 40
Memcached   | 9   | 31
Postgres    | 28  | 95
```
````

- The type follows `chart`: `bar` draws vertical bars, `bar horizontal` draws horizontal bars, `line` draws a line for each series and `pie` draws a donut. Each line is a label and one number for each series, with `|` between the cells.
- A first line whose values are not numbers names the series. Its label cell may be empty. A row with more than one number needs this line, so the reader can tell what each color is. Without it every row has one number: one series and no legend. `bar` and `line` take 1 to 6 series. A `bar` takes up to 24 rows and a `line` up to 60 points.
- A number is plain: an optional `+` or `-`, digits and an optional decimal point. On `bar` and `line` a negative value draws below the zero line. A bar axis always starts at 0, it is never broken, and it ends on the first round tick at or above the largest value. A line axis covers the data with round ticks and may start above 0, because a line shows position, not length; it starts at 0 when the smallest value is a third of the largest or less, and when values reach or cross 0.
- `unit=` is added to the axis and to the value labels as it is: `unit=%` gives `40%`, `unit=ms` gives `40ms`, and `unit=" ms"` gives `40 ms`. The panel title is the chart title, so there is no `title=`.
- `*` before a label highlights the row. On `bar` with one series its bar uses the accent color, and with several series it keeps its series colors. The other bars turn gray. On `line` the points of the row are larger and show their values, and a thin dashed guide line marks its position; the lines keep their colors and nothing turns gray. With several series the values of the row stand in a column beside the guide, each in its series color. On `pie` the slice keeps its color and the other slices turn gray.
- A chart with more than one series has a legend. Up to 12 bars carry their value. A long label in a vertical chart is slanted before it is shortened.
- `line`: each row is a position on the horizontal axis, the first row on the left. With one series and up to 12 points every point shows its value; with more, only the highlighted row does. With many points the labels on the axis are thinned to every second, third or later one, so they do not overlap.
- `pie`: one number on each row, so a first line may give one series name and no more. Values are 0 or more and at least one is above 0. Write up to 6 slices, one for each series color. The slices start at 12 o'clock and go clockwise in the order written. A list beside the donut shows each slice's color, label, value and percentage. The percentage is a whole number, with one decimal when a slice is so small that it would show 0%. The total is in the middle. With `unit=%` the values are the shares already, so the list shows the label and the value only, the table has no share column and the middle is empty.
- Under the chart, a collapsed table holds every number. A `pie` table also has a share column. A screen reader can read it and a reader can copy from it. Its labels follow the page language.
- A right-to-left page mirrors the chart: the first row is on the right, horizontal bars grow to the left, and a pie goes counterclockwise with its list on the left. Numbers stay left to right.
- The series colors are theme tokens (`--series-1` to `--series-6`, see [Diagram tokens](#diagram-tokens)). A page without a chart does not carry the chart styles.
- In an `am video` scene, a chart steps row by row, like `limits`: a `line` adds one point of each series, a `pie` adds one slice.
- A line that has the wrong number of cells, a value that is not a number, a negative or all-zero pie, and a table over the limits are errors with the line number and a correct example.

Full syntax: `am help chart`.

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

Pages go to `~/.answer-me-with-html/pages/` by default. Set `AM_HOME` to move them. When the session may not write there (a host sandbox that allows writes only in the workspace), `am render` and `am video` without `-o` save the page in a private folder in the system temporary folder instead (`answer-me-with-html-<uid>/pages/`; mode 0700, and a folder that is not private to your user is refused) and say so; the system may clear it. `am clean` and `--replace` cover that folder, `am serve` does not. `am patch` never moves a page. `-o` names a file, not a folder; use a name such as `page.html`. An explicit name without an extension is still a file, and the CLI prints a notice recommending `.html`. A page with STE or code warnings does not open in the browser (add `--open` to open it anyway). To render the fixed draft again, run `am render … --replace <page>`: the earlier page is deleted once the new one is written, so `pages/` keeps one page per answer. A render lists every draft error at once, in line order, and writes no page. When the draft came from stdin (`am render -`) and has errors or warnings, it is saved as `drafts/<title>-<time>.md` in the data directory and the output prints `draft: <path>`; the line numbers match that file, so edit the flagged lines there and run `am render <path>`. A draft in `drafts/` is deleted after a render with no warnings. A draft you give as a file is never copied. The default folder is private to your user (mode 0700), so other users on a shared host cannot read your pages; an existing `AM_HOME` folder keeps its mode.

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

A right-to-left language (`he`, `ar`, `fa`, `ur`, `yi`) also gets `<html dir="rtl">`. The page mirrors: text, panels, tables, the outline rail (`left` and `right` mirror) and the toolbar start from the right; `flow` and `sequence` diagrams are drawn as their mirror image, so the first node or participant is on the right and arrows point left; timelines, trees and limits bars start from the right. Code blocks, diffs and inline code stay left to right, and so does any run of text with no right-to-left letter (a path such as `src/`, a key such as `lint:` at the start of a label, a domain, a signed number), so its punctuation stays where it was written. Hebrew has its own labels, Hebrew names for common frontmatter keys (`author`, `date`, `source`, `version` ...) and a day.month.year render date; the other right-to-left languages use English labels. A video page (`am video`) follows the same rule: the title block, the scenes, the captions, and the chapter strip start from the right, while the controls row (play button, clock, progress bar, speed and export) stays left to right, as in common video players. Exported MP4 and WebM files carry the mirrored picture.

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
- Page font sizes follow the reader's `scale` setting. Use `var(--am-fs-*)` (the page text sizes) or `calc(Npx * var(--am-scale, 1))`; the toolbar keeps its size.
- `font` (optional) names a font this tool ships. A page rendered with the theme embeds it, so it needs no network and the other pages do not grow. The only value for now is `bangers` ([Bangers](https://github.com/googlefonts/bangers), SIL OFL 1.1); use the family in `css`, for example `& .am-head h1 { font-family: "Bangers", Impact, sans-serif; }`. A version that does not know the field ignores it and shows the fallback font. Video pages do not embed the font.
- `requires` (optional) is the oldest version of this tool the theme supports, as `x.y.z`. On an older version the theme is skipped with `needs Answer me with HTML x.y.z or newer`; a version that does not know the field ignores it.
- Keep the file self-contained: no `url()` or `image-set()` to `http:`, `https:` or `//`, no `@import`, no `@font-face` and no backslash escapes (they can hide a link from the check). A link would send a request every time someone opens a page, and pages work offline. `am theme check` warns about them; your existing theme keeps working. The theme catalog and `am theme add` reject them.
- Each page carries the built-in themes plus its own theme, so it still opens on any machine.
- `am theme check notes` reports missing variables, invalid colors and low contrast in light and dark, warns about external resources, and renders two specimen pages with every component.

The classes your `css` may target stay stable: a later version keeps every one of them, and never adds a required color variable.

| Part | Classes |
| :--- | :--- |
| Page head | `.am-head`, `.am-head h1`, `.am-head-meta`, `.am-intro` |
| Panel | `.am-panel`, `.am-panel--bare`, `.am-panel-head`, `.am-panel-head h2`, `.am-panel-id`, `.am-panel-meta`, `.am-panel-body` |
| Content | `.am-md`, `.am-callout`, `.am-callout--ok`, `.am-callout--warn`, `.am-callout--err`, `.am-callout-title`, `.am-kv` |
| Drawing frame | `.am-frame`, `.am-ruler` |
| Comment button | `.am-comment-btn`, `.am-comment-btn--on` |

### Diagram tokens

A theme restyles what is inside a diagram (flow, sequence, er, the boxes of a tree, and the bars, lines and slices of a chart) with tokens, not with selectors: set them in `tokens` and every diagram follows. They are all optional. A theme that sets none draws the diagrams it always did, and an older version ignores them.

| Part | Tokens | Default |
| :--- | :--- | :--- |
| Node (flow, er, tree box) | `--node-fill`, `--node-stroke`, `--node-width`, `--node-radius`, `--node-shadow`, `--node-text` | `--paper`, `--line`, `--bw`, 3px (the tree box: `--radius`), none, `--ink` |
| Highlighted node (`*`) | `--hi-fill`, `--hi-stroke`, `--hi-text` | `--accent-bg`, `--accent`, `--accent` |
| Edge and message | `--edge-color`, `--edge-width`, `--edge-label` | `--ink-2`, 1.3, `--accent` |
| Sequence actor (and the box of a `== divider ==`) | `--actor-fill`, `--actor-stroke`, `--actor-text` | `--node-fill`, `--node-stroke`, `--node-text` |
| Sequence note | `--note-fill`, `--note-stroke`, `--note-width`, `--note-radius` | `--warn-bg`, `--warn`, 1, 2px |
| Group box (flow) | `--cluster-fill`, `--cluster-stroke` | `--fill`, `--line-2` |
| Lifeline | `--lifeline-color` | `--ink-3` |
| Chart series (`chart`) | `--series-1`, `--series-2`, `--series-3`, `--series-4`, `--series-5`, `--series-6` | `#4e79a7`, `#f28e2b`, `#e15759`, `#76b7b2`, `#59a14f`, `#b07aa1` in light mode; `#7aa6d6`, `#f5a55a`, `#ef7f80`, `#8fd0cb`, `#7cc472`, `#c99bbd` in dark mode |

- `--node-width`, `--edge-width`, `--node-radius`, `--note-width` and `--note-radius` take a number or a `px` or `em` value (a bare number means px). `--node-radius` also rounds actors and does not change the pill and diamond shapes. `--node-shadow` is `none` or one or more `drop-shadow(...)`, for example `drop-shadow(3px 3px 0 #111111)`, and also casts the shadow of actors. Any other value is an error, and the theme is skipped.
- Colors are any CSS color. In light and dark mode `am theme check` reads these pairs and needs 4.5:1, only when the theme sets one side: `--node-text` on `--node-fill`, `--hi-text` on `--hi-fill`, `--actor-text` on `--actor-fill`, `--ink` on `--note-fill`, and `--edge-label` on `--paper`. Dark mode keeps the light value of a token it does not set, so set both.
- The series colors are read as graphics, not as text. `am theme check` warns when a `--series-N` has less than 3:1 against `--paper`, in light or dark, only when the theme sets that token. It is a warning, not an error, because the bars carry their value and the legend and the data table name each series. A theme that sets none gets the default palette; some of its colors (the orange and the teal) are below 3:1 on a white `--paper`.
- A token value goes through the same external-resource check as `css`: no `url()` or `image-set()` to `http:`, `https:` or `//`, and no backslash. `am theme check` warns; the catalog and `am theme add` reject.
- There is no token for the font family, size, weight or letter spacing in a diagram. The CLI measures diagram text for the sans font, so a different font would overflow its box.
- The corner radius needs Safari 17.4 or newer; an older Safari draws the default radius.

### Theme catalog

[answer-me-with-html.com/themes/](https://answer-me-with-html.com/themes/) shows ready-made themes, each drawn live in light and dark, with the commands that install it: `comic`, `manga` and `pop`, which use the Bangers font. A catalog theme is one file in your themes folder, so a page that does not use it does not carry it. The catalog list is at [/themes/index.json](https://answer-me-with-html.com/themes/index.json) (name, version, size and sha256 of every file), and the files are in [`marketplace/themes/`](../marketplace/themes). To make a theme and submit it to the catalog, ask your agent to follow [/themes/make.md](https://answer-me-with-html.com/themes/make.md); for the other ways (the website editor, an issue form or a PR), see [CONTRIBUTING.md](../CONTRIBUTING.md#theme-catalog).


#### Install a theme: `am theme add`

```bash
am theme add comic --use       # download, check and save the theme, and make it the default
am theme list [--remote]       # built-in themes, then yours with version and source
am theme update [name]         # update themes that came from the catalog
am theme remove <name>         # delete a theme file
```

- `am theme add <name>` reads the catalog index (`https://answer-me-with-html.com/themes/index.json`, or the URL in the `AM_CATALOG_URL` environment variable: https only, or http for `localhost`, `127.0.0.1` and `[::1]`, because over plain http the index and the file could both be swapped and the sha256 would prove nothing; a redirect to an address that breaks this rule is refused), downloads `themes/<name>.json` from the same address, and checks its size and sha256 against the index. It then runs the checks of the catalog CI: a valid theme file, no contrast error, no external resource. It saves the file to `~/.answer-me-with-html/themes/<name>.json` through a temporary file, so an interrupted run leaves no half file. Only catalog names work, not URLs or paths. A theme that `requires` a newer version is refused with the version it needs. Network calls time out after 8 seconds.
- `--use` also sets the default theme, the same as `am config set theme <name>`. It asks nothing else.
- A file with that name that is not the catalog's is never overwritten, because it may be your own theme: the command stops and suggests `--force`. The identical file is reported as already installed. A file that is still exactly what the catalog gave you is replaced by a newer version without `--force`.
- Where each theme came from is recorded in `state.json` in the data folder (`catalogThemes`: name, version and sha256 of the installed file). The themes folder holds theme files only. Without a record, a file counts as your own (`local`).
- `am theme list` needs no network. A file you changed after installing shows as `catalog, edited`. `--remote` also reads the catalog and marks themes with an update and themes you do not have.
- `am theme update` replaces each theme that came from the catalog and is unchanged since the install; a file you edited is skipped with a note (`am theme add <name> --force` replaces it). `am theme update <name>` does one theme.
- `am theme remove <name>` deletes the file and its record (never a built-in theme). If it was the default theme, the default goes back to `auto`. Pages already made keep their look, because a page carries its own theme.
- The output prints theme names and versions only. Labels and descriptions from the catalog are for the website and are never printed, so the text of a catalog cannot reach an agent through the command.
- Versions before 0.5.3 have no `am theme add`: save the file by hand, as the catalog page shows (`curl` or PowerShell).

## Opening pages from a remote machine

If your agent runs on a remote or headless machine, `am serve` lets you open its pages in your own browser over `http://`. Run it in a terminal on that machine and leave it running:

````bash
am serve              # http://127.0.0.1:8765, Ctrl-C to stop; --port N changes the port (0 picks a free one)
ssh -L 8765:127.0.0.1:8765 user@host   # on your own computer, then open the links in your browser
am serve --lan        # also listen on the local network (0.0.0.0), only on a network you trust
am serve --public-url https://pages.example.com   # links use this address, for a reverse proxy or tunnel that adds TLS
am serve --tailscale  # listen on your Tailscale address only; open the links from any device on your tailnet
````

- While it runs, `am render`, `am patch` and `am video` print a `link:` line for each page they write into `~/.answer-me-with-html/pages/` or `videos/`, and the agent gives you that link instead of a `file://` one.
- By default the server listens on `127.0.0.1` only, and the SSH tunnel is the recommended way to reach it. There is no password and no TLS.
- `--lan` makes the server listen on `0.0.0.0`, every IPv4 interface and not only the address in the links, so another computer on the same network can open the links. It prints every LAN address with a warning, and the links use the first one: 192.168.x.x before 10.x.x.x before 172.16-31.x.x. The connection is plain HTTP and the token in a link is a bearer secret, so anyone on that network who sees the traffic or the link can open the page. Use it only on a trusted network, behind a firewall.
- `--public-url https://host` is for a reverse proxy or tunnel that you run in front of `am serve` and that adds TLS. It sets the address that `link:` lines start with and the `Host` name the server accepts. It does not create TLS or open any port itself. Give it an origin only, with no path. Without `--lan` the server still listens on `127.0.0.1`, so the proxy must run on the same machine, and it must pass on the original `Host` header.
- `--tailscale` listens only on this machine's Tailscale IPv4 address (not `0.0.0.0`, not `127.0.0.1`), so only devices on your tailnet reach it. Links start with the MagicDNS name (`http://<machine>.<tailnet>.ts.net:<port>`) or, when MagicDNS is off, the Tailscale address. The connection is plain `http://`, but traffic inside the tailnet is WireGuard-encrypted. It reads `tailscale status --json` and changes no Tailscale configuration. It needs the `tailscale` CLI on `PATH` (on macOS the app's bundled CLI also works) and a logged-in, running Tailscale. It cannot be combined with `--lan` or `--public-url`. Its links survive restarts: the secret is kept in `~/.answer-me-with-html/serve-secret`, so a bookmark on your phone keeps working; to revoke every link, stop the server, delete that file and start the server again. If the listen fails with "cannot assign requested address" (Tailscale in userspace-networking mode has no interface), use the HTTPS recipe below for tailnet devices; `--lan` reaches only devices on the same local network.
- `--secret-file <path>` keeps the link secret in a file instead of making a new one at each start, so links survive restarts. The file holds 64 lowercase hex characters and only you can read it (mode 0600); it is created when missing. `am serve` refuses a file that group or others can read.
- HTTPS on a tailnet with HTTPS certificates enabled: run `tailscale serve --bg 8765`, then `am serve --public-url https://<machine>.<tailnet>.ts.net`. `tailscale serve` passes the `.ts.net` `Host` through, which is what `--public-url` accepts. Enabling HTTPS publishes your machine names in Certificate Transparency logs ([details](https://tailscale.com/kb/1153/enabling-https)). `tailscale serve --https=443 off` undoes it.
- On a phone, Reply answers and comments on an `http(s)` link last only until the tab closes, and mobile browsers discard background tabs: copy a reply before you switch apps.
- Without those flags the server answers only to `localhost`, `127.0.0.1` and `[::1]`; a request for any other host name or IP is a 404. Do not expose the port to the internet.
- Links are per page: each one carries a token for that one page, and it does not open any other page. They stop working when the server restarts, unless the secret is kept in a file (`--tailscale`, `--secret-file`). The server shows no folder listing and serves only `.html` files.
- Treat a link as the password of its page: anyone who can reach the port and has the link can open the page, including other users of the same machine. Share it only with yourself.
- Give the tunnel a local port of its own. Do not reuse a port where you opened pages from another server or another host: a page from that other server could have left a service worker in your browser for that address, and it would see the pages served there later.
- Each page opens in a browser sandbox of its own, so a script in one page cannot read another. Because of that, Reply answers, comments and remarks on an `http://` link last only until you close the page: copy the reply before you close it.
- An open page reloads by itself when its file changes, for example after `am patch` or a new render to the same file, and keeps its scroll position. If you have already answered, commented or marked something on the page, it does not reload; it shows "Page updated · Reload" instead, so you can copy your reply first. The server adds this to the pages it sends, not to the files: a page opened from `file://` does not reload. The page listens on `/e/<token>/<file>` with the token of its own link, and that link carries only "changed", never the page.

## Updating and cleaning up

**Updating.** Updates are manual, and the tool tells you when one is out. Once a day, a background process downloads this project's `package.json` and `highlights.json` from GitHub to read the latest version number and its highlights. Nothing about you or your pages is sent, and the page you asked for never waits on it. When there is a newer version, the next render adds a one-line notice and the agent asks whether you want to update. Each page made while you are out of date also has a "New version" button at the start of the toolbar; click it for up to three highlights of the new version in the page language, the update command and a copy button. `am serve` takes the button out of a page it sends to another device (`--lan` or `--public-url`), and the page itself never goes online. Turn this off with `/answer-me-with-html:config update_check off`.

| Installed with | Update with |
| :--- | :--- |
| `npx skills add` | `npx skills update answer-me-with-html -y`, or tell your agent "update answer-me-with-html" |
| `git clone` + `npm link` | `git pull && npm install` in the repository |
| DeepSeek Harness plugin | `dsh plugin --profile <profile> up <package>`; the update notice fills in the profile and the package |
| Claude Code plugin | In a terminal run `claude plugin update answer-me-with-html@answer-me-with-html` (or open `/plugin` → Installed → Update now), then `/reload-plugins`. To update automatically, turn on auto-update for this marketplace in `/plugin` → Marketplaces. Claude Code leaves it off for third-party marketplaces |

**Cleaning up.** Pages, videos and the narration cache build up in `~/.answer-me-with-html/`. If that folder grows past 200 MB, or passes 20 MB with no cleanup for 30 days, the agent asks once a week whether to clean it. Nothing is deleted without your OK.

- `/answer-me-with-html:clean` (plugin), or say "clean up the pages", previews first and then asks.
- `am clean` deletes pages, videos and saved drafts older than 30 days and empties the narration cache. `--days N` changes the cutoff, `--all` removes every page, video and draft, and `--dry-run` only shows what would go. Your settings and themes are always kept. If `pages`, `videos` or `cache` is itself a symlink, it is skipped: `am clean` never touches the files it points to, and the size count and cleanup hint ignore it. A folder that cannot be read is skipped too: its files are left out of the size count and the cleanup hint, so the size you see can be lower than the real use, and `am clean` does not delete them.

**Old always-on plugin.** It is gone from this repository, but your copy keeps adding the reminder until you remove it. Run `/plugin uninstall answer-me-with-html-always@answer-me-with-html`, then add the always-on rule from the [README](../README.md#always-on-mode-recommended).

## Settings

| Key | Default | What it does |
| :--- | :--- | :--- |
| `open` | `on` | Open each page in the browser after it is made. Turn it off if pop-ups interrupt you |
| `theme` | `auto` | Default theme: `auto` (paper for long text, blueprint for diagrams), `blueprint`, `shadcn`, `paper`, or your own theme |
| `mode` | `auto` | Default color mode: `auto`, `light` or `dark` |
| `style` | `80` | Writing check: `off`, `80` (warn only) or `strict` (refuse to render) |
| `scale` | `1` | Text size on the page: 0.8–1.5 in steps of 0.05. 1.2 makes text 20% larger; diagrams and charts grow with it. The toolbar's A− / A+ buttons change it too; the choice is remembered in this browser and wins over this setting, but under `am serve` it lasts for the tab only |
| `update_check` | `on` | Check GitHub for a new version once a day and mention it. Never updates by itself |
| `close_after_reply` | `off` | Close the page tab 3 seconds after you copy the reply, with a countdown and a Keep open button. See the note below |
| `voice` | `auto` | Video narration: `auto` (ElevenLabs if `ELEVENLABS_API_KEY` is set, else system voice), `elevenlabs`, `local`, `system` or `off` |

Settings live in `~/.answer-me-with-html/config.json`. A theme written in a draft beats the default. `--open` and `--no-open` affect one run only.

`close_after_reply` applies to pages made while it is on. Pages that `am serve` sends keep your answers only until the tab closes, so with this setting on the answers go with the tab; the clipboard still holds the reply. A browser refuses to close a tab after a link in the page has moved it (for example a contents link), and then the page says that you can close the tab yourself.

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
- **Style:** Flags English passive voice in steps (descriptions may use it), three or more 的 in one sentence, stock phrases such as 赋能 and 闭环, and opening or closing filler such as 下面我来 and 希望对你有帮助.
- **Japanese:** A draft with kana is treated as Japanese: the page buttons are in Japanese and the page gets `lang="ja"`. Only the length rules apply, with the Chinese character limits. Write `lang: ja` in the draft to force it.
- **Other languages:** Any other language gets only the length rules: sentences in words (characters for Chinese and Japanese text), paragraphs in sentences. The English and Chinese word lists and the passive-voice rule do not run on it.

Set the strictness with `/answer-me-with-html:config style strict`, or per page with `style:` in the draft.
