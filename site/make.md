# Make a theme for Answer me with HTML

You are an agent. Your user wants a theme for Answer me with HTML, a tool that turns answers into one-page HTML explainers. A theme is one JSON file. Follow these steps. Ask the user before you submit anything.

## 1. Find the `am` command

- If the Answer me with HTML skill is installed, `am` is `node <skill folder>/scripts/am.mjs`.
- If it is not installed, install it with `npx skills add QingYunA/answer-me-with-html`, or ask the user how they want to install it.
- `am theme check` needs version 0.4.10 or newer. A theme's `font` field needs 0.5.3 or newer; older versions show system fonts.

## 2. Start from the closest catalog theme

1. Read the catalog list: https://answer-me-with-html.com/themes/index.json (name, label, description of each theme).
2. Pick the theme whose look is closest to what the user asked for. Catalog themes already pass every catalog rule, so a start from one of them passes too in most cases.
3. Pick a name for the new theme: lowercase letters, digits and `-`, at most 40 characters. It must not be a built-in theme (`blueprint`, `shadcn`, `paper`, `3b1b`), `index`, `new`, or a name in the catalog list.
4. Download the start and save it as `~/.answer-me-with-html/themes/<name>.json` (`$AM_HOME/themes/` when `AM_HOME` is set):

```bash
curl -fsSL https://answer-me-with-html.com/themes/<start>.json -o ~/.answer-me-with-html/themes/<name>.json --create-dirs
```

The user can use the theme right away: `theme: <name>` in a draft, `--theme <name>`, or `am config set theme <name>`.

## 3. Change the file

The file has these fields. Keep all of them.

| Field | What to do |
| --- | --- |
| `label` | The theme's display name: `{ "en": "...", "zh": "..." }`. |
| `version` | `1.0.0`. |
| `author` | The user's name or handle. Ask if you do not know it. |
| `license` | `MIT` or `CC0-1.0`. |
| `description` | One short sentence: `{ "en": "...", "zh": "..." }`. |
| `font` | Optional. Only `"bangers"` (a comic display font the tool ships). Remove the field for system fonts. |
| `tokens.common` | Values shared by light and dark: `--radius`, `--bw` (border width), `--shadow`, `--head-font`, and the shape tokens of diagrams. |
| `tokens.light`, `tokens.dark` | Every color token, in each mode (below). |
| `css` | Optional decoration. Every selector starts with `&`, the theme's root. |

**Color tokens.** Light and dark must each set all 18: `--bg` `--paper` `--ink` `--ink-2` `--ink-3` `--line` `--line-2` `--fill` `--accent` `--accent-bg` `--ok` `--ok-bg` `--err` `--err-bg` `--warn` `--warn-bg` `--head-bg` `--head-fg`. `--ink` is the main text, `--paper` the panel background, `--bg` the page, `--head-bg`/`--head-fg` the panel title bar. `ok`, `err` and `warn` are status badges; keep them green, red and amber.

**Diagram tokens.** Set at least 8 in each mode (common counts for both): `--node-fill` `--node-stroke` `--node-width` `--node-radius` `--node-shadow` `--node-text` `--hi-fill` `--hi-stroke` `--hi-text` `--edge-color` `--edge-width` `--edge-label` `--actor-fill` `--actor-stroke` `--actor-text` `--note-fill` `--note-stroke` `--note-width` `--note-radius` `--cluster-fill` `--cluster-stroke` `--lifeline-color`. Widths and radii are a number, `px` or `em`.

**Chart series tokens.** Optional, and they do not count toward the 8: `--series-1` `--series-2` `--series-3` `--series-4` `--series-5` `--series-6` color the bars, lines and slices of a `chart`. Leave them out and the chart uses a fixed palette, a light set and a dark set. A token you set should keep contrast 3:1 against `--paper`, in light and dark; a lower contrast is a warning, not an error, because the values are written on the chart and in its data table.

**css.** It may target only these classes: `.am-head` `.am-head h1` `.am-head-meta` `.am-intro` `.am-panel` `.am-panel--bare` `.am-panel-head` `.am-panel-head h2` `.am-panel-id` `.am-panel-meta` `.am-panel-body` `.am-md` `.am-callout` `.am-callout--ok` `.am-callout--warn` `.am-callout--err` `.am-callout-title` `.am-kv` `.am-comment-btn` `.am-comment-btn--on` `.am-frame` `.am-ruler`, plus elements such as `body`. Do not style diagrams with css (`.am-node`, `svg` and so on); use the diagram tokens.

**Rules.**

- The file is at most 16 KB.
- Nothing loads from outside the file: no `url()` or `image-set()` to `http:`, `https:` or `//`, no `@import`, no `@font-face`, no backslash anywhere.
- Text needs contrast 4.5:1 against its background, in light and dark. Status badges need 3:1.

## 4. Check it and show the user

```bash
am theme check <name>
```

It reports errors and contrast problems, and writes two specimen pages, light and dark, with every component. Fix every error and run it again. Then give the user the two page paths and ask what to change. Repeat until the user is happy.

## 5. Submit it to the catalog (only when the user agrees)

Submitting publishes the theme on GitHub, so ask first. Build the prefilled issue URL:

```bash
node -e 'const fs=require("fs"),os=require("os"),path=require("path");const n=process.argv[1];const f=path.join(process.env.AM_HOME||path.join(os.homedir(),".answer-me-with-html"),"themes",n+".json");const u=new URL("https://github.com/QingYunA/answer-me-with-html/issues/new");u.search=new URLSearchParams({template:"theme.yml",title:"Theme: "+n,name:n,theme:JSON.stringify(JSON.parse(fs.readFileSync(f,"utf8")))});console.log(u.href)' <name>
```

Give the URL to the user, or open it in their browser. The user needs a GitHub account. On the page they tick the License box and click "Create". If the URL is longer than 8000 characters, give the URL without the `theme` parameter and ask the user to paste the file into "Theme JSON".

Do not create the issue with the GitHub API or `gh`: an issue made that way by someone outside the project loses its label, and the bot does not check it.

After the user submits, a bot checks the theme on the issue and comments. If it lists problems, fix the file, run `am theme check` again, and have the user paste the new file into the issue (edit). A maintainer reviews every theme before it goes into the catalog at https://answer-me-with-html.com/themes/.
