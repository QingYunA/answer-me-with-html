// am CLI: render / patch / video / lint / theme / list / help. main() takes injected streams and environment variables, for testing.

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { VERSION } from './assets.js';
import { join, resolve, dirname, basename, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { renderDoc, RenderError, LintError } from './render.js';
import { parseDoc, ParseError, DraftErrors, CHOICES, VOICES } from './parse.js';
import { lintDoc, formatWarning } from './lint/ste.js';
import { resolveLanguage } from './language.js';
import { COMPONENTS } from './components/index.js';
import { themeNames, getTheme, loadThemes } from './themes/registry.js';
import { readThemeFile } from './themes/user.js';
import { cmdThemeMarket, THEME_MARKET_USAGE } from './theme-market.js';
import { checkColors, externalResourceWarnings, COLOR_TOKENS } from './themes/check.js';
import { FONT_NAMES } from './themes/font-list.js';
import { THEME_SELECTORS } from './themes/selectors.js';
import { renderVideo } from './video/render.js';
import { pickProvider, TtsError } from './video/tts.js';
import { exportMp4, exportWebm, ExportError } from './video/export.js';
import { afterRender, clean, usage, mb, CLEAN } from './housekeeping.js';
import { runUpdateCheck, pageUpdate } from './update.js';
import { amHome, readConfig, setConfig, resetConfig, configChoices, CONFIG_KEYS, ConfigError } from './config.js';
import { ensureHome, tempHome, checkedTempHome, UnsafeTempHome } from './home.js';
import { hasCommand, renameOver, isDenied } from './sys.js';
import { loadMath } from './math-load.js';
import { replacePanel, PatchError } from './patch.js';
import { readState } from './state.js';
import { readPage } from './page.js';
import { readEmbeddedImages } from './images.js';
import { readEmbeddedCode, MAX_CODE_LINES, LONG_CODE_LINES } from './code.js';
import { languageIds } from './languages/registry.js';
import { runServe, serveLink, DEFAULT_PORT } from './serve.js';

const MAX_LISTED_WARNINGS = 20;

const USAGE = `Answer me with HTML ${VERSION} — renders a Markdown draft into a single-file HTML explainer page

Usage:
  am render <file|->  [-o <file>] [--replace <page>] [--no-open] [--theme ${['auto', ...themeNames('page')].join('|')}]
                      [--template sheet|doc] [--style off|80|strict] [--mode auto|light|dark]
  am patch  <html> --panel <title> [file|-] [--from file] [--theme …] [--no-open]
                                                  replace one ## panel of an existing page and overwrite that HTML in place
  am video  <file|->  [-o <file>] [--voice auto|elevenlabs|local|system|off] [--mp4] [--webm] [--no-open]
                      [--theme ${['auto', ...themeNames('video')].join('|')}] [--mode light|dark]
                                                  render a video draft into a 3b1b-style explainer video player page (--mp4 / --webm also save a video file)
  am lint   <file|->  [--style off|80|strict]     run only the STE controlled-writing check
  am config [set <key> <value> | get <key> | reset [key]]  show or change settings
  am serve  [--port 8765] [--lan | --tailscale | --public-url <origin>] [--secret-file <path>]  serve pages over http on 127.0.0.1 (--lan: on the local network; --tailscale: on your tailnet only); am render then prints a link:
  am clean  [--days 30] [--all] [--dry-run]       delete old pages, videos and saved drafts, and the voice-over cache
  am theme check <name|file.json> [--no-open]     check a theme's colors and contrast, and render specimen pages
  am theme add <name> [--use] [--force]           install a theme from the catalog (answer-me-with-html.com/themes/); --use makes it the default
  am theme list [--remote] | update [name] | remove <name>  show, update or delete the themes in your themes folder
  am list                                         list templates, themes and components
  am help [component|format|code|image|video|patch|theme]  show component syntax / page draft format / code block / image syntax / video draft format / patch / theme usage

- A file argument of - reads from stdin (good for heredoc: am render - <<'EOF' ... EOF).
- -o names an output file, for example -o page.html; it does not name a folder.
- Output goes to ~/.answer-me-with-html/pages/ by default (change it with the AM_HOME environment variable).
- A page with STE or code warnings does not open. Fix the draft and render again with --replace <page>: the earlier page is deleted once the new one is written.
- Set auto-open, the default theme and more with am config; --open / --no-open apply to this run only.
- am patch reads the source draft from the page's hidden #am-source, changes only the ## section that --panel names, and writes the page back to the same path.`;

const FORMAT = `Draft format (extended Markdown)

---
template: sheet        # sheet: blueprint board (default, multi-panel grid) | doc: linear explainer (one column + contents)
theme: auto            # auto (default): paper for the doc template or text only, blueprint with diagrams | blueprint | shadcn | paper; switchable in the page
title: Page title      # or use "# Title" as the first line of the body
subtitle: Subtitle     # optional
cols: 3                # number of sheet grid columns, default 3
style: 80              # STE check strictness: off | 80 (default, warn only) | strict (no page if it fails)
mode: auto             # auto follows the system | light | dark
source: asd-ste100.org # any other key shows in the page header meta line
---
Intro (optional, shown below the title)

## A Panel title {span=2 meta="top-right note"}
Plain Markdown: paragraphs, lists, tables, quotes, inline code...
Write ok / no / warn in a table cell (text may follow, e.g. "ok approved") to get a ✓ / ✗ / ! badge.

\`\`\`flow LR          ← fence language = component name, followed by component arguments
A -> B
\`\`\`

\`\`\`html             ← html / svg fences are embedded as-is (escape hatch)
<div>any content</div>
\`\`\`

- "## " starts a panel; the ID is optional (A to Z are assigned automatically, then P27, P28 ...). A capital letter and a space before a capitalized word is read as the ID: write "## B A Miss Goes Unseen" to keep the word "A". An ID you write yourself must be unique: a panel that declares P27 takes the ID an automatic P27 would get, so write one or the other. span is a hint: the page sizes panels to fit their content, so wide tables and diagrams need no span. Write span only for a panel that must stand out.
- An image on its own line, ![what it shows](path), becomes a captioned figure and is embedded in the page; see am help image.
- Math in text: $x^2$ is inline; a block is a line with only $$, the TeX, and a line with only $$ (or one line: $$ E = mc^2 $$). Put a long formula in a block: a block scrolls
  inside its panel, and an inline formula may wrap after = or +. \\$ writes a dollar sign. The TeX is typeset when the page is made (Temml): no script, no network.
  $5 and $10 stay text (a closing $ has no space before it and no digit after it), and so does $PATH:$HOME (a closing $ with a letter or _ after it does not close; write $n$-th, not $n$th).
  Code, diagrams and video take no math. In a table cell write \\vert x \\vert, not |x|. \\ref, \\eqref and \\label are not supported (they give a warning; \\tag{1} works in a block).
  TeX that cannot be read stays as raw TeX in red, with a warning and its line: fix it and render again with --replace.
- A placeholder such as <host> is shown as text. Inside a sentence only text-level tags stay (b, i, kbd, sup, a, span, br, img ...), and tags that break the page (script, style, iframe ...) are shown as text too. Put raw markup in an html or svg fence and code in backticks.
- Any other fence language is a code block; \`\`\`ts src=path lines=18-30 quotes real code from a file; see am help code.
- For the component list see am list; for one component's syntax see am help <component>.`;

const IMAGE_HELP = `Images: a screenshot, photo or render that already exists as a file

![What the picture shows](/absolute/path/to/screenshot.png)

- Put the image alone on its line; the alt text becomes its caption, so write what the picture shows (the STE check reads it).
- Use the absolute path. A relative path is read from the draft file's folder, or from the current folder when the draft comes from stdin. A space in the path is fine.
- PNG, JPG, GIF, WebP, AVIF and SVG files up to 5 MB. The file is embedded in the page, which stays one file that opens offline.
- Remote images do not load: the page blocks every remote request, so an http(s) or // URL shows nothing and the render warns about it. Save the image and use its local path. data: URIs work.
- The page keeps the path of each image. am patch embeds the image again from the file, or from the page when the file is gone.
- Images are for things a diagram cannot show, such as a real screen. Do not generate or invent images.`;

const CODE_HELP = `Code blocks: real code from a file, or code you type

\`\`\`ts src=server/routes.ts lines=18-30 hl=22
\`\`\`

\`\`\`ts title="limits.ts · sketch"
export const LIMIT = 50
\`\`\`

- A fence whose language is not a component is a code block. Each block gets a header and a Copy button.
- src= quotes a file: the CLI reads the lines, so you do not type them, and the code is the real code. Leave the block empty.
  The path is read from the current folder, and only files inside it are quoted. lines=18-30 (or lines=18) picks the lines; without it the whole file is quoted.
- The header shows path:lines, or title= when you set it. Write "sketch" in the title of code that does not exist yet.
- hl=22 or hl=20-22,25 highlights lines by their shown number. start=38 numbers a typed block from 38.
- A diff: a fence with the language diff holds a unified diff you paste, and the CLI draws it (see below).
- 10 to ${LONG_CODE_LINES} lines make the point best: a longer block gets a warning, and more than ${MAX_CODE_LINES} lines is an error.
- Files that hold keys by convention (.env, *.pem, id_rsa, .ssh/, .git/ …) and files with anything that looks like a key or a token are refused.
- The render lists every embedded file. The page keeps the path; am patch reads the file again, or keeps the page's copy when the file has moved.

Diff blocks: show a change

\`\`\`diff file=src/code.js
@@ -60,3 +60,3 @@
 export function parseCodeArgs(args) {
-  const attrs = parseAttrs(args);
+  const attrs = parseAttrs(args, { diff: true });
   const opts = {};
\`\`\`

- Paste the unified diff. Each line starts with + (added, green), - (removed, red) or a space (context); a line with nothing on it counts as context.
- @@ -60,3 +60,3 @@ starts a hunk: the CLI shows it as a thin row and numbers the lines from it, with two gutters, old and new. Without @@, start=N numbers from N; with neither, the block has no numbers.
- file= names the file in the header, and the language label comes from its extension. A +++ b/path line names it when file= is missing; title= wins over both.
- The header shows a stat after the title: +1 −1. Copy copies the diff as written.
- hl= uses new-side numbers and needs numbers (@@ or start=).
- diff --git, index, ---, +++ and "\\ No newline at end of file" lines are accepted and not drawn.
- Cut lines (a line with only ... or …) are an error: the gutter cannot know how many lines were skipped. Split the diff into two hunks, each with its own @@ header.
- A hunk whose line counts do not match its @@ header is a warning. src= is not supported for a diff yet: paste the diff.
- The limits are the same as for other code blocks: a warning above ${LONG_CODE_LINES} lines, an error above ${MAX_CODE_LINES}, and the key and token check.`;

const RAW_HELP = `LANG — embed as-is (escape hatch)

When the fence language is LANG, the content goes into the page unprocessed. Use it only when no component can show the content;
use theme variables for colors (such as var(--ink), var(--accent)) so the content stays readable across themes and light/dark modes.

Example:
\`\`\`LANG
<div style="color: var(--accent)">any content</div>
\`\`\``;

const VIDEO_FORMAT = `Video draft format (am video)

---
title: TCP three-way handshake
subtitle: Why three steps      # optional, subtitle on the title card
theme: blueprint               # blueprint: drawing style (auto picks it; follows the theme in am config) | shadcn: cards | 3b1b: dark
mode: light                    # light | dark (blueprint + dark is a dark-blue drawing)
---
> Title-card narration (optional; without it the title card stays for 2.4 seconds)

## Both ends are waiting
\`\`\`sequence
Client -> Server: SYN
Server -> Client: SYN-ACK
Client -> Server: ACK
\`\`\`
> The client sends SYN first to ask for a connection.
> [Server] replies with SYN-ACK.
> The client sends ACK, and the connection is open.

- "## " starts a scene; a scene holds components or Markdown (the picture), and lines that start with > are narration (one beat per line).
- When narration line N plays, step N of the picture appears: in flow / er / sequence / tree each source line is one step;
  timeline, limits, chart rows, table rows, list items and paragraphs step item by item. With more steps than narration lines, the steps are spread across the lines;
  with more narration lines than steps, the extra first lines act as an opening and show nothing new.
- Write [name] in narration: the camera zooms in on the element with that name and highlights it, and the word turns yellow in the caption.
- Nodes / participants with the same name in adjacent scenes move smoothly from the old position to the new one (cross-scene morph).
- Voice-over: --voice auto (default: ElevenLabs if ELEVENLABS_API_KEY is set, otherwise system TTS) | elevenlabs | local | system | off.
  The system voice is picked for each line from the languages installed on the machine: macOS say takes the installed voice of
  the line's language (a Taiwan voice for Traditional Chinese), Linux takes the espeak-ng voice for it.
  A line whose language has no installed voice keeps its caption without narration, and the run says which language that was.
  Set the ElevenLabs voice with ELEVENLABS_VOICE_ID and the model with ELEVENLABS_MODEL_ID (default eleven_v4_turbo).
  local calls a local OpenAI-compatible speech service (POST /v1/audio/speech, returns 16-bit PCM WAV):
  AM_TTS_URL (required, service base URL), AM_TTS_MODEL, AM_TTS_VOICE (required when the service has no default),
  AM_TTS_API_KEY is sent as a Bearer token when set; AM_TTS_EXTRA holds model-specific parameters (a JSON object); AM_TTS_MODEL / AM_TTS_VOICE override the same fields in it,
  and am always sets input, response_format and stream. A line whose duration is clearly wrong is synthesized again,
  up to AM_TTS_ATTEMPTS times per line (default 3; set 1 to turn this off).
  Example: AM_TTS_URL=http://127.0.0.1:8000 AM_TTS_MODEL=mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit \
      AM_TTS_VOICE=vivian am video draft.md --voice local
- Output goes to ~/.answer-me-with-html/videos/. The player carries a chapter strip (a chip jumps into that scene), a
  speed button (0.5x to 2x) and an export button that saves the same video through the browser, without a terminal.
- --mp4 also saves a 1080p .mp4 next to the page (H.264 + AAC; needs ffmpeg; about 1.3 times the video length).
  --webm saves a 1080p .webm that the page encodes itself (VP9 + Opus; no ffmpeg; the time follows how much of the page moves).
  Both need Chrome and Node 22+; give both to save both. The export button needs a secure context (a local file or
  localhost): WebCodecs is not available to a page served over plain HTTP.`;

export async function main(argv, io = {}) {
  const out = io.stdout ?? process.stdout;
  const err = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;
  const print = (s = '') => out.write(`${s}\n`);
  const fail = (s) => err.write(`${s}\n`);

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        replace: { type: 'string' },
        'no-open': { type: 'boolean' },
        open: { type: 'boolean' },
        theme: { type: 'string' },
        template: { type: 'string' },
        style: { type: 'string' },
        mode: { type: 'string' },
        voice: { type: 'string' },
        mp4: { type: 'boolean' },
        webm: { type: 'boolean' },
        panel: { type: 'string' },
        from: { type: 'string' },
        days: { type: 'string' },
        port: { type: 'string' },
        lan: { type: 'boolean' },
        tailscale: { type: 'boolean' },
        'public-url': { type: 'string' },
        'secret-file': { type: 'string' },
        all: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        use: { type: 'boolean' },
        force: { type: 'boolean' },
        remote: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (e) {
    fail(`✗ ${e.message}\n\n${USAGE}`);
    return 2;
  }
  const { values: opts, positionals: [cmd, arg, ...rest] } = parsed;

  if (opts.version) return print(VERSION), 0;
  if (opts.help || !cmd) return print(USAGE), 0;

  // The built-in themes plus the user's theme files, read once per command.
  const themes = loadThemes(amHome(env));
  const ctx = { print, fail, env, io, themes };
  switch (cmd) {
    case 'render': return withSource(arg, io, fail, (src, baseDir, from) => cmdRender(src, opts, ctx, baseDir, from));
    case 'patch': return cmdPatch(arg, rest[0], opts, ctx);
    case 'video': return withSource(arg, io, fail, (src, _baseDir, from) => cmdVideo(src, opts, ctx, from));
    case 'lint': return withSource(arg, io, fail, (src) => cmdLint(src, opts, { print, fail }));
    case 'config': return cmdConfig([arg, ...rest].filter((x) => x !== undefined), ctx);
    case 'theme': return cmdTheme(arg, rest[0], opts, ctx);
    case 'clean': return cmdClean(opts, { print, fail, env });
    case 'serve': return cmdServe(opts, ctx);
    case '__update-check': return (await runUpdateCheck(amHome(env))) ? 0 : 1;
    case 'list': return cmdList(ctx), 0;
    case 'help': return cmdHelp(arg, { print, fail });
    default:
      fail(`✗ Unknown command "${cmd}"\n\n${USAGE}`);
      return 2;
  }
}

async function withSource(arg, io, fail, fn) {
  if (!arg) {
    fail('✗ Missing the draft argument: pass a file path, or - to read from stdin');
    return 2;
  }
  const cwd = io.cwd ?? process.cwd();
  let src;
  try {
    src = arg === '-' ? await readStream(io.stdin ?? process.stdin) : readFileSync(resolve(cwd, arg), 'utf8');
  } catch (e) {
    fail(`✗ Cannot read the draft: ${e.message}`);
    return 2;
  }
  if (!src.trim()) {
    fail('✗ The draft is empty');
    return 2;
  }
  // Relative image paths are read from the draft file's folder, or from the current folder for a draft on stdin.
  // from says where the draft came from: a stdin draft is kept in drafts/ when it needs fixing (keepDraft below), a file is not.
  return fn(src, arg === '-' ? cwd : dirname(resolve(cwd, arg)), arg === '-' ? { stdin: true } : { file: resolve(cwd, arg) });
}

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// The line bin/am.js adds to an internal error on a Node.js older than 20, so the user knows to update Node rather than report a bug.
export function oldNodeHint(version = process.version) {
  if (Number(version.slice(1).split('.')[0]) >= 20) return '';
  return `Answer me with HTML needs Node.js 20 or newer (found ${version}). Update Node.js: https://nodejs.org/`;
}

// Whether to open automatically: --open forces it > --no-open > AM_NO_OPEN (not 0) > CI environment > config open.
export function shouldOpen(opts, env, config) {
  if (opts.open) return true;
  if (opts['no-open']) return false;
  if (env.AM_NO_OPEN && env.AM_NO_OPEN !== '0') return false;
  if (env.CI) return false;
  return config.open !== false;
}

async function cmdRender(src, opts, ctx, baseDir, from) {
  const { fail, print } = ctx;
  const replaced = opts.replace === undefined ? null : pagePath(opts.replace, ctx);
  if (replaced === false) {
    fail(`✗ --replace takes a page that am render wrote (a .html file in ${join(amHome(ctx.env), 'pages')} or ${join(tempHome(), 'pages')})`);
    return 2;
  }
  const config = loadConfig(ctx);
  const { theme, mode, style } = config.values;
  await loadMath(src);
  let result;
  try {
    result = renderDoc(src, { theme: opts.theme, template: opts.template, style: opts.style, mode: opts.mode }, { theme, mode, style }, { themes: ctx.themes, baseDir, codeDir: ctx.io.cwd ?? process.cwd(), update: updateFor(config, ctx), closeAfter: config.values.close_after_reply, scale: config.values.scale });
  } catch (e) {
    return reportDraftError(e, src, from, ctx);
  }
  const file = outputPath('pages', result.meta.title, opts, ctx);
  if (!file) return 2;
  const written = emit(result, file, ctx, { fallback: opts.out ? undefined : 'pages' });
  if (!written) return 1;
  if (opts.out && !extname(file)) print('! -o names a file without an extension; use .html for an HTML page');
  // Delete the earlier attempt only now: a render that fails above keeps it.
  if (replaced && replaced !== resolve(written)) removeEarlier(replaced, ctx);
  keepDraft(result, src, from, ctx);
  // A page with STE, code or math warnings is likely to be rendered again, so it opens only when --open asks for it.
  const held = !opts.open && hasRetryWarnings(result) && shouldOpen(opts, ctx.env, config.values);
  if (held) print(`  Not opened because of the warnings; to render again, add --replace ${written}`);
  return finish(written, held ? { ...opts, 'no-open': true } : opts, config, ctx);
}

// The new-version button for the page, from the version the background check last saw (src/update.js).
const updateFor = (config, { env, io }) => pageUpdate(readState(amHome(env)), VERSION, io.scriptPath, env, config.values);

// Any note that asks the author to fix the draft: STE, code, math, diagram and raw-HTML warnings.
const hasWarnings = (result) => hasRetryWarnings(result) || (result.stats.componentWarnings ?? []).length > 0 || (result.stats.htmlWarnings ?? []).length > 0;

// A draft that needs fixing is edited in a file, and the line numbers of every message must match that file. A draft read from stdin
// is saved verbatim in drafts/ of the data directory and its path is printed; a draft given as a file already is that file.
const draftsDir = (home) => join(resolve(home), 'drafts');

function draftTitle(src) {
  const m = src.match(/^title:\s*["']?(.+?)["']?\s*$/m) ?? src.match(/^#\s+(.+)$/m);
  return m?.[1] ?? '';
}

// The absolute path of the saved draft, or null when neither the data directory nor the temporary folder can take it. Saving is a side
// step: a page may already be written, so any file-system error only moves on to the next folder.
function saveDraft(src, { env, io }) {
  const name = `${slug(draftTitle(src))}-${stamp(new Date(io.now?.() ?? Date.now()))}.md`;
  const home = amHome(env);
  const folders = [() => { ensureHome(home); return draftsDir(home); }, () => draftsDir(checkedTempHome({ create: true }))];
  for (const folder of folders) {
    try {
      const dir = folder();
      mkdirSync(dir, { recursive: true });
      return writeNew(dir, name, src);
    } catch {
      // Try the next folder.
    }
  }
  return null;
}

// Write a file that does not exist yet: a second draft in the same second gets -2, -3 … before the extension.
function writeNew(dir, name, text) {
  for (let n = 1; ; n++) {
    const file = join(dir, n === 1 ? name : name.replace(/\.md$/, `-${n}.md`));
    try {
      writeFileSync(file, text, { flag: 'wx' });
      return file;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
}

// After a render that wrote a page: a stdin draft with warnings is saved for the fix-and-render-again round; a draft file in drafts/
// that renders clean is deleted (the page keeps the source in #am-source).
function keepDraft(result, src, from, ctx) {
  const warned = hasWarnings(result);
  if (from?.stdin && warned) {
    const saved = saveDraft(src, ctx);
    if (saved) ctx.print(`  draft: ${saved}`);
  } else if (from?.file && !warned && isKeptDraft(from.file, ctx)) {
    try {
      rmSync(from.file, { force: true });
    } catch (e) {
      ctx.fail(`! Kept the draft ${from.file} (${e.code ?? e.message})`);
    }
  }
}

// A .md file directly inside drafts/ of the data directory or of the temporary folder.
function isKeptDraft(path, { env }) {
  return [draftsDir(amHome(env)), draftsDir(tempHome())].includes(dirname(path)) && basename(path).endsWith('.md');
}

// Errors that name a place in the draft: a stdin draft is saved so the agent edits only the flagged lines.
const isDraftError = (e) => e instanceof DraftErrors || e instanceof RenderError || e instanceof LintError || (e instanceof ParseError && e.line > 0);

function reportDraftError(e, src, from, ctx) {
  const code = reportError(e, ctx.fail);
  if (from?.stdin && isDraftError(e)) {
    const saved = saveDraft(src, ctx);
    if (saved) ctx.fail(`  draft: ${saved}`);
  }
  return code;
}

const hasRetryWarnings = (result) => result.warnings.length > 0 || (result.stats.codeWarnings ?? []).length > 0 || (result.stats.mathWarnings ?? []).length > 0;

// The absolute path of a page, or false when arg does not name a .html file directly inside pages/ of the data directory or of the
// temporary folder (where a page goes when the data directory is not writable). The file may be gone.
function pagePath(arg, { env, io }) {
  const path = resolve(io.cwd ?? process.cwd(), arg);
  const folders = [resolve(amHome(env), 'pages'), resolve(tempHome(), 'pages')];
  return folders.includes(dirname(path)) && basename(path).endsWith('.html') ? path : false;
}

const PATCH_HELP = `Replace one panel of a rendered page in place

Usage:
  am patch <html-file> --panel <title> < new-panel.md
  am patch <html-file> --panel <title> --from new-panel.md
  am patch <html-file> --panel <title> -

- Reads the source draft from the hidden <textarea id="am-source"> in <html-file>.
- --panel matches a ## section's title, its letter ID, or "ID title".
- The new draft comes from stdin or from --from / a second file argument: it may include the ## heading or only the panel body.
- Renders again with the current renderer and overwrites the same HTML path; it writes no new timestamped file.
- Keeps the page's template, theme, light/dark mode and STE style (recorded on the page's root tag when it was made). Later config changes do not apply to patched pages; to change them add --theme / --mode / --style.
- If the panel is not found, or the page has no #am-source, the exit code is non-zero and the file is not changed.`;

const THEME_HELP = `Install a ready-made theme from the catalog at answer-me-with-html.com/themes/

am theme add <name> [--use] [--force]
- Reads the catalog, downloads themes/<name>.json, checks its size, sha256, colors and links, and saves it to ~/.answer-me-with-html/themes/<name>.json.
  Only catalog names work, not URLs or paths. --use also makes it the default theme (the same as am config set theme <name>).
- A file of that name that is not the catalog's is never overwritten (it may be your own theme): add --force to replace it.
- It asks nothing else. The catalog address can be moved with the AM_CATALOG_URL environment variable (an https URL of an index.json; http only for localhost).
am theme list [--remote]     built-in themes, then your themes with version and source (catalog, catalog edited, local) and files that cannot be used; --remote also reads the catalog and marks updates and themes you do not have
am theme update [name]       update themes installed from the catalog; a file you changed is skipped (am theme add <name> --force replaces it)
am theme remove <name>       delete a theme file (not a built-in theme); if it was the default theme, the default is auto again
- Where each theme came from is recorded in state.json (catalogThemes). Needs Answer me with HTML 0.5.3 or newer; before that, save the file by hand (see the catalog page).

Your own theme: one JSON file per theme in ~/.answer-me-with-html/themes/ (AM_HOME moves it)

The file name is the theme name: themes/notes.json is theme "notes" (lowercase letters, digits and -; not a built-in name).
Pick it like a built-in theme: theme: notes in the draft, --theme notes, or am config set theme notes. The draft does not change.

{
  "label": "Notes",
  "tokens": {
    "common": { "--radius": "6px", "--font-sans": "\\"IBM Plex Sans\\", \\"Noto Sans CJK SC\\"" },
    "light": { "--bg": "#f7f5ef", "--paper": "#fffdf8", "--ink": "#1f1d1a", ... },
    "dark": { "--bg": "#14130f", "--paper": "#1c1b17", "--ink": "#eeeae0", ... }
  },
  "css": "& .am-panel-head { letter-spacing: 0.01em; }",
  "video": { "tokens": { "light": { "--v-stage": "#fffdf8" } }, "css": "& .amv-title { font-weight: 500; }" }
}

- label: the name on the page's theme button: a string, or an object with ${languageIds().join(' / ')} strings.
- tokens: light and dark must each set every color: ${COLOR_TOKENS.join(' ')}.
  common holds values shared by both; --radius --shadow --bw --head-font --font-sans --font-mono are optional.
- Fonts: name installed fonts only; the default font stack is added as the fallback.
- font (optional): a font this tool ships, embedded in a page rendered with the theme: ${FONT_NAMES.join(' | ')}. Use it in css, for example & .am-head h1 { font-family: "Bangers", Impact, sans-serif; }.
  An older version ignores the field and shows the fallback font.
- requires (optional): the oldest version of this tool the theme supports, as x.y.z. A newer requirement makes this tool skip the theme.
- css (optional): start every selector with &, which stands for the theme's root, so the rules apply only under this theme.
  Target these classes (they stay stable): ${THEME_SELECTORS.join(' ')}.
  Keep the file self-contained: no url() or image-set() to http(s) or //, no @import, no @font-face, no backslash escapes. A link would send a request each time a page opens.
  am theme check warns about them; the catalog and am theme add reject them.
- Diagram tokens (optional): node-fill node-stroke node-width node-radius node-shadow node-text, hi-fill hi-stroke hi-text, edge-color edge-width edge-label, actor-fill actor-stroke actor-text, note-fill note-stroke note-width note-radius, cluster-fill cluster-stroke, lifeline-color, series-1 series-2 series-3 series-4 series-5 series-6 (each with a -- prefix).
  They restyle what is inside flow, sequence and er diagrams and tree boxes, and each defaults to today's look. The series tokens color the bars, lines and slices of a chart: a fixed palette is the default (a light set and a dark set); a series color below 3:1 against --paper in light or dark gives a warning. Widths and radii are a number or px / em (a bare number is px);
  --node-shadow is none or drop-shadow(...), like drop-shadow(3px 3px 0 #111). Do not write diagram selectors in css. There is no token for fonts: diagram text is measured for the sans font.
- video (optional): video-only variables (--v-stage, --v-title-font, --v-cap-fg, --v-cap-bg, --v-glow) and & css for am video.
- A page carries the built-in themes plus its own theme, so it opens anywhere; readers without your fonts see the fallback.
- A file with problems is skipped with a warning; am theme check <name|file.json> tells you why.

am theme check <name|file.json> [--no-open]
- Reports invalid colors, missing variables and contrast below WCAG AA in light and dark (text 4.5:1; status badges 3:1, warning below 4.5:1),
  and diagram text on its fill (node, highlighted node, actor, note, edge label) when the theme sets a diagram token for it. A width, radius or shadow token with a bad value is an error.
- Warns about external resources in css, video.css and token values (url() or image-set() to http(s) or //, @import, @font-face, backslash escapes).
- Exits with 1 when there is an error. Without errors it renders two specimen pages (light, dark) with every component.`;

async function cmdPatch(htmlArg, fromArg, opts, ctx) {
  const { fail, io } = ctx;
  if (!htmlArg || htmlArg === '-') {
    fail(htmlArg ? '✗ patch needs the path of an existing HTML file; it cannot read the page from stdin' : '✗ Missing the HTML file path');
    return 2;
  }
  if (!opts.panel || !String(opts.panel).trim()) {
    fail('✗ Missing --panel <title>');
    return 2;
  }
  const cwd = io.cwd ?? process.cwd();
  const file = resolve(cwd, htmlArg);
  let html;
  try {
    html = readFileSync(file, 'utf8');
  } catch (e) {
    fail(`✗ Cannot read the HTML: ${e.message}`);
    return 2;
  }
  const page = readPage(html);
  const { source, video } = page;
  if (source == null) {
    fail('✗ The page has no #am-source, so the source draft cannot be recovered');
    return 1;
  }
  const from = opts.from ?? fromArg;
  let replacement;
  try {
    replacement = !from || from === '-' ? await readStream(io.stdin ?? process.stdin) : readFileSync(resolve(cwd, from), 'utf8');
  } catch (e) {
    fail(`✗ Cannot read the new panel draft: ${e.message}`);
    return 2;
  }
  let patched;
  try {
    patched = replacePanel(source, opts.panel, replacement);
  } catch (e) {
    if (!(e instanceof PatchError)) return reportError(e, fail);
    fail(`✗ ${e.message}`);
    return 1;
  }
  // A page made with a user theme that is no longer installed is not restyled silently.
  const problem = ctx.themes.problem(page.theme, video ? 'video' : 'page');
  if (problem && !opts.theme) {
    fail(`✗ The page uses theme "${page.theme}", which is not installed or cannot be used (${problem}); add --theme <name> to pick another`);
    return 1;
  }
  const config = loadConfig(ctx);
  const { theme, mode, style } = config.values;
  // Keep the original page's template, theme, mode and STE strictness (it may have been made with --theme / --style etc.); this command's arguments win.
  // Video pages must go through renderVideo, not renderDoc.
  const overrides = {
    template: video ? undefined : (opts.template ?? page.template),
    theme: opts.theme ?? page.theme,
    mode: opts.mode ?? page.mode,
    style: opts.style ?? page.style,
  };
  if (!video) await loadMath(patched);
  let result;
  try {
    if (video) {
      // A voiced page keeps its original voice (data-voice; config when an old page has none); a silent video made with --voice off stays silent.
      // An explicit --voice from the user wins.
      const voice = opts.voice ?? (page.voiced ? page.voice ?? config.values.voice : 'off');
      if (!validVoice(voice, fail)) return 2;
      // Video pages also keep the original page's theme, mode and STE strictness (e.g. 3b1b / --style off); this command's arguments win.
      result = await buildVideo(patched, voice, { ...opts, theme: overrides.theme, mode: overrides.mode, style: overrides.style, previousLanguage: page.lang }, config, ctx);
    } else {
      result = renderDoc(patched, overrides, { theme, mode, style }, { themes: ctx.themes, previousLanguage: page.lang, baseDir: cwd, codeDir: cwd, knownImages: readEmbeddedImages(html), knownCode: readEmbeddedCode(html), update: updateFor(config, ctx), closeAfter: config.values.close_after_reply, scale: page.scale });
    }
  } catch (e) {
    if (e instanceof TtsError) {
      fail(`✗ Voice-over failed: ${e.message}. Add --voice off for captions only`);
      return 1;
    }
    return reportError(e, fail);
  }
  if (!emit(result, file, ctx, { note: video ? ' (an MP4 or WebM with the same name is not updated; run am video --mp4 or --webm again if you need it)' : '', inPlace: true })) return 1;
  return finish(file, opts, config, ctx);
}

async function cmdVideo(src, opts, ctx, from) {
  const { fail, print } = ctx;
  const config = loadConfig(ctx);
  const voice = opts.voice ?? config.values.voice;
  if (!validVoice(voice, fail)) return 2;
  let file = opts.out ? outputPath('videos', '', opts, ctx) : null;
  if (opts.out && !file) return 2;
  let result;
  try {
    result = await buildVideo(src, voice, opts, config, ctx);
  } catch (e) {
    if (!(e instanceof TtsError)) return reportDraftError(e, src, from, ctx);
    fail(`✗ Voice-over failed: ${e.message}. Add --voice off for captions only`);
    return 1;
  }
  file ??= outputPath('videos', result.meta.title, opts, ctx);
  if (!file) return 2;
  const written = emit(result, file, ctx, { fallback: opts.out ? undefined : 'videos' });
  if (!written) return 1;
  if (opts.out && !extname(file)) print('! -o names a file without an extension; use .html for an HTML page');
  keepDraft(result, src, from, ctx);
  for (const format of ['mp4', 'webm']) {
    if (opts[format] && !(await exportVideo(written, result.wav, format, ctx))) return 1;
  }
  return finish(written, opts, config, ctx);
}

function validVoice(voice, fail) {
  if (VOICES.includes(voice)) return true;
  fail(`✗ Invalid voice value "${voice}". Choose one of: ${VOICES.join(' | ')}`);
  return false;
}

async function buildVideo(src, voice, opts, config, { fail, env, io, themes }) {
  const provider = io.ttsProvider !== undefined ? io.ttsProvider : pickProvider(voice, env);
  const result = await renderVideo(src, {
    provider,
    cacheDir: provider ? narrationCache(amHome(env)) : undefined,
    defaults: { style: config.values.style, theme: config.values.theme, mode: config.values.mode },
    overrides: { style: opts.style, theme: opts.theme, mode: opts.mode },
    previousLanguage: opts.previousLanguage,
    onProgress: (msg) => fail(`  ${msg}`),
    themes,
  });
  return { ...result, voiceName: voiceSummary(provider, result.captionsOnly) };
}

// The narration cache lives in the data directory. A data directory the session may not write to gives no cache: the video is
// still made, and a render after it synthesizes every line again.
function narrationCache(home) {
  try {
    ensureHome(home);
  } catch (e) {
    if (!isDenied(e)) throw e;
    return undefined;
  }
  return join(home, 'cache', 'tts');
}

// The voice line of the one-line summary: the provider, and the languages that kept captions only because no voice is
// installed for them.
function voiceSummary(provider, captionsOnly = []) {
  if (!provider) return 'none (captions only)';
  if (!captionsOnly.length) return provider.name;
  return `${provider.name} (no ${captionsOnly.map((c) => c.language).join(', ')} voice installed: captions only for those lines)`;
}

// A video file next to the page: an MP4 through ffmpeg, or a WebM from the browser's own encoder. Both drive the page's
// render(t) frame by frame, so the picture is the same either way. Each flag writes its own format and nothing else.
async function exportVideo(file, wav, format, { print, fail, env }) {
  const out = `${file.replace(/\.html?$/i, '')}.${format}`;
  const started = Date.now();
  try {
    if (format === 'mp4') await exportMp4(file, out, { wav, env, onProgress: (i, n) => fail(`  Exporting MP4: frame ${i}/${n}`) });
    else await exportWebm(file, out, { env, onProgress: (i, n) => fail(`  Exporting WebM: frame ${i}/${n}`) });
  } catch (e) {
    if (!(e instanceof ExportError)) throw e;
    const hint = format === 'mp4' && !hasCommand('ffmpeg') ? '. Or add --webm for a video file without ffmpeg' : '';
    fail(`✗ Video export failed: ${e.message}${hint}. The player page was written and plays in a browser`);
    return false;
  }
  print(`✓ ${out} (exported in ${((Date.now() - started) / 1000).toFixed(0)}s)`);
  return true;
}

function loadConfig({ fail, env, themes }) {
  themeWarnings({ fail, themes });
  const config = readConfig(env, themes);
  if (config.warning) fail(`! ${config.warning}`);
  return config;
}

// Theme files that were skipped, once per command.
function themeWarnings({ fail, themes }) {
  themes.warnings.forEach((w) => fail(`! ${w}`));
}

// Output path: the -o path when given, otherwise pages/ or videos/ in the data directory. io.now can inject a clock.
function outputPath(dir, title, opts, { env, io, fail }) {
  if (opts.out) {
    const file = resolve(io.cwd ?? process.cwd(), opts.out);
    if (statSync(file, { throwIfNoEntry: false })?.isDirectory()) {
      fail('✗ -o names a folder; give a file path, for example -o page.html');
      return null;
    }
    return file;
  }
  return join(amHome(env), dir, `${slug(title)}-${stamp(new Date(io.now?.() ?? Date.now()))}.html`);
}

// Write a page. A page inside the data directory makes it private first; a page saved elsewhere (-o) leaves its folder alone.
// A page in pages/ is written to a temp file and renamed over the old one, so am serve (src/serve.js) never reloads a half-written
// page. Elsewhere it is written in place: a rename would replace a symlink with a plain file and drop the file's mode and hard links.
function writePage(file, html, env) {
  const home = resolve(amHome(env));
  const path = resolve(file);
  if (path.startsWith(home + sep)) ensureHome(home);
  mkdirSync(dirname(file), { recursive: true });
  if (!path.startsWith(join(home, 'pages') + sep)) return writeFileSync(file, html);
  const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, html);
    renameOver(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}

// Write the page where it was planned. A session that may not write there (a host sandbox that allows writes only in the workspace
// and the temporary folder) gets the page in a private folder of the temporary folder instead, but only when fallback ('pages' or
// 'videos') names the default location's folder: a page the user named with -o, or one patched in place, never moves. Returns
// { file, notice } with the path actually written, or null after one line that says what to run instead.
// inPlace: am patch, which takes no -o, so its hint does not name -o.
function savePage(html, file, { fallback, inPlace }, { fail, env }) {
  const home = amHome(env);
  const inHome = resolve(file).startsWith(resolve(home) + sep);
  const hint = (path) => {
    if (inPlace) return 'Copy the page to a folder this session can write to and patch the copy';
    return inHome
      ? `If this session can write only inside the workspace, run the command again with -o "<workspace>/.tmp/answers/${basename(path)}"`
      : 'Give -o a file in a folder this session can write to';
  };
  const refuse = (path, e) => fail(`✗ Cannot write the page: permission denied (${e.code}) ${path}. ${hint(path)}`);
  try {
    writePage(file, html, env);
    return { file };
  } catch (e) {
    if (!isDenied(e)) throw e;
    if (!(fallback && inHome)) return refuse(file, e), null;
    const spare = join(tempHome(), fallback, basename(file));
    try {
      checkedTempHome({ create: true });
      writePage(spare, html, env);
      return { file: spare, notice: `  ! ${home} is not writable (${e.code}): saved in the temporary folder, which the system may clear` };
    } catch (t) {
      if (t instanceof UnsafeTempHome) fail(`✗ Cannot write the page: ${home} is not writable (${e.code}) and ${t.dir} is not a private folder of this user. Give -o a file in a folder this session can write to`);
      else if (isDenied(t)) refuse(spare, t);
      else throw t;
      return null;
    }
  }
}

// The earlier page of --replace goes away once the new one is written. A folder that cannot be changed keeps it, with one line.
function removeEarlier(file, { fail }) {
  try {
    rmSync(file, { force: true });
  } catch (e) {
    if (!isDenied(e)) throw e;
    fail(`! Kept the earlier page ${file} (permission denied, ${e.code})`);
  }
}

// Write the page, print the path, a one-line summary (note follows the summary) and writing warnings. Shared by render / video / patch.
// Returns the path written, or null when the page could not be written (see savePage).
function emit(result, file, ctx, { note = '', fallback, inPlace } = {}) {
  const { print, env } = ctx;
  const saved = savePage(result.html, file, { fallback, inPlace }, ctx);
  if (!saved) return null;
  print(`✓ ${saved.file}`);
  if (saved.notice) print(saved.notice);
  // With am serve running, a page inside the data directory also gets an http link.
  const link = serveLink(amHome(env), saved.file);
  if (link) print(`  link: ${link}`);
  print(`  ${summaryLine(result)}${note}`);
  // The code the page now holds, so the user can check it before sharing the page.
  if (result.stats.code?.length) print(`  code embedded from: ${result.stats.code.join(', ')}`);
  const long = result.stats.codeWarnings ?? [];
  if (long.length) {
    print(`  code ${count(long.length, 'warning')} (trim the block and run again, or keep it if every line matters):`);
    long.forEach((w) => print(`  L${w.line} [${w.rule}] ${w.message}`));
  }
  printComponentWarnings(result.stats.componentWarnings, print);
  printHtmlWarnings(result.stats.htmlWarnings, print);
  printMathWarnings(result.stats.mathWarnings, print);
  printWarnings(result.warnings, print, result.meta.style);
  return saved.file;
}

// What a component noticed in its own block (a group box that would be empty after a change). The page is still written.
function printComponentWarnings(notes = [], print) {
  if (!notes.length) return;
  print(`  diagram ${count(notes.length, 'warning')} (the page is written; fix the draft if that is not what you meant):`);
  [...notes].sort((a, b) => a.line - b.line).slice(0, MAX_LISTED_WARNINGS).forEach((w) => print(`  L${w.line} [${w.component}] ${w.message}`));
  if (notes.length > MAX_LISTED_WARNINGS) print(`  … ${notes.length - MAX_LISTED_WARNINGS} more`);
}

// Raw HTML the render changed (a placeholder shown as text, a tag or attribute removed). Not STE warnings: they never fail style: strict.
function printHtmlWarnings(notes = [], print) {
  const lines = [...new Set([...notes].sort((a, b) => a.line - b.line).map((w) => `L${w.line} [html] ${w.message}`))];
  if (!lines.length) return;
  print(`  html ${count(lines.length, 'warning')} (the page differs from the draft here; fix the draft if that is not what you meant):`);
  lines.slice(0, MAX_LISTED_WARNINGS).forEach((l) => print(`  ${l}`));
  if (lines.length > MAX_LISTED_WARNINGS) print(`  … ${lines.length - MAX_LISTED_WARNINGS} more`);
}

// A formula Temml could not read (shown as raw TeX) or one that uses \ref, \eqref or \label. The page is written, but it is not what the draft meant, so it does not open.
function printMathWarnings(notes = [], print) {
  if (!notes.length) return;
  print(`  math ${count(notes.length, 'warning')} (the page is written; fix the TeX and render again):`);
  [...notes].sort((a, b) => a.line - b.line).slice(0, MAX_LISTED_WARNINGS).forEach((w) => print(`  L${w.line} [math] ${w.message}`));
  if (notes.length > MAX_LISTED_WARNINGS) print(`  … ${notes.length - MAX_LISTED_WARNINGS} more`);
}

function summaryLine(result) {
  const { meta, stats } = result;
  if (result.beats !== undefined) {
    return `video · ${meta.theme} · ${count(stats.panels, 'scene')} · ${count(result.beats, 'beat')} · ${result.duration.toFixed(1)}s · voice: ${result.voiceName}`;
  }
  const comps = Object.entries(stats.components).map(([k, v]) => `${k}×${v}`).join(' ');
  return `${meta.template} · ${meta.theme} · ${count(stats.panels, 'panel')}${comps ? ` · ${comps}` : ''}`;
}

// "1 file", "2 files".
const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// Wrap-up after a successful render: print maintenance notices, open the browser per config. io.open can inject the opener.
function finish(file, opts, config, ctx) {
  printHints(config, ctx);
  if (shouldOpen(opts, ctx.env, config.values)) (ctx.io.open ?? openFile)(file);
  return 0;
}

// Notices attached after a successful render (cleanup, update), for the Agent, which asks the user.
function printHints(config, { env, io, print }) {
  try {
    const hints = afterRender({
      home: amHome(env), env, config: config.values, current: VERSION,
      scriptPath: io.scriptPath, background: Boolean(io.background),
    });
    hints.forEach((h) => print(h));
  } catch {
    // A maintenance-notice error does not affect the render result.
  }
}

function cmdClean(opts, { print, fail, env }) {
  if (opts.days !== undefined && !/^\d+$/.test(opts.days.trim())) {
    fail('✗ --days needs a non-negative integer');
    return 2;
  }
  const days = opts.days === undefined ? CLEAN.days : Number(opts.days);
  const home = amHome(env);
  const before = usage(home);
  // The temporary folder holds pages written while the data directory was not writable. Only a folder that exists and is private.
  const temp = existingTempHome();
  const tempBefore = temp && usage(temp);
  const dry = Boolean(opts['dry-run']);
  const r = clean(home, { days, all: Boolean(opts.all), dryRun: dry, temp });
  const scope = opts.all ? 'all pages, videos and drafts' : `pages, videos and drafts older than ${count(days, 'day')}`;
  print(`Data directory: ${home} (${mb(before.total)} in total: ${count(before.pages.count, 'page')}, ${count(before.videos.count, 'video')}, ${mb(before.cache.bytes)} voice-over cache)`);
  if (temp) print(`Temporary folder: ${temp} (${mb(tempBefore.total)} in total: ${count(tempBefore.pages.count, 'page')}, ${count(tempBefore.videos.count, 'video')})`);
  print(dry
    ? `Would delete ${count(r.files, 'file')}, freeing ${mb(r.bytes)} (${scope} + voice-over cache). Run without --dry-run to delete.`
    : `✓ Deleted ${count(r.files, 'file')}, freeing ${mb(r.bytes)} (${scope} + voice-over cache). Settings were kept.`);
  return 0;
}

// The temporary folder when it already exists and is private to this user, otherwise null. am clean never creates it.
function existingTempHome() {
  try {
    return checkedTempHome();
  } catch (e) {
    if (e instanceof UnsafeTempHome || isDenied(e)) return null;
    throw e;
  }
}

function cmdServe(opts, { print, fail, env, io }) {
  if (opts.port !== undefined && !(/^\d+$/.test(opts.port.trim()) && Number(opts.port) <= 65535)) {
    fail('✗ --port needs a number from 0 to 65535 (0 picks a free port)');
    return 2;
  }
  if (opts.tailscale && (opts.lan || opts['public-url'] !== undefined)) {
    fail('✗ --tailscale cannot be combined with --lan or --public-url');
    return 2;
  }
  const port = opts.port === undefined ? DEFAULT_PORT : Number(opts.port);
  const secretFile = opts['secret-file'] === undefined ? undefined : resolve(io?.cwd ?? process.cwd(), opts['secret-file']);
  return runServe({ home: amHome(env), port, lan: !!opts.lan, tailscale: !!opts.tailscale, publicUrl: opts['public-url'], secretFile, print, fail });
}

function cmdLint(src, opts, { print, fail }) {
  let doc;
  try {
    doc = parseDoc(src);
  } catch (e) {
    return reportError(e, fail);
  }
  const style = opts.style ?? doc.meta.style;
  if (!CHOICES.style.includes(style)) {
    fail(`✗ Invalid style value "${style}". Choose one of: ${CHOICES.style.join(' | ')}`);
    return 2;
  }
  // The language decides the rule family, exactly as it does in render and video: a draft whose language has no rules of
  // its own must be measured with the language-neutral ones, and must not get the Chinese or English rules.
  const language = resolveLanguage({ declared: doc.meta.lang, text: src });
  const warnings = style === 'off' ? [] : lintDoc(doc, language);
  printWarnings(warnings, print, style);
  return style === 'strict' && warnings.length ? 1 : 0;
}

function printWarnings(warnings, print, style) {
  if (style === 'off') return print('  STE check is off');
  if (!warnings.length) return print('  STE ✓ 0 warnings');
  print(`  STE ${count(warnings.length, 'warning')} (fix the draft and run again):`);
  warnings.slice(0, MAX_LISTED_WARNINGS).forEach((w) => print(`  ${formatWarning(w)}`));
  if (warnings.length > MAX_LISTED_WARNINGS) print(`  … ${warnings.length - MAX_LISTED_WARNINGS} more; run am lint to see all`);
}

// Print one draft error in its format; false when e is not one.
function reportItem(e, fail) {
  if (e instanceof RenderError) {
    fail(`✗ L${e.line} [${e.component}] ${e.message}`);
    if (e.example) fail(`  Correct example:\n${e.example.replace(/^/gm, '    ')}`);
    fail(`  Full syntax: am help ${e.component}`);
    return true;
  }
  if (e instanceof ParseError) {
    fail(`✗ ${e.line ? `L${e.line} ` : ''}Cannot parse the draft: ${e.message}`);
    if (e.example) fail(`  Correct example:\n${e.example.replace(/^/gm, '    ')}`);
    return true;
  }
  return false;
}

function reportError(e, fail) {
  if (e instanceof DraftErrors) {
    e.errors.slice(0, MAX_LISTED_WARNINGS).forEach((item) => reportItem(item, fail));
    if (e.errors.length > MAX_LISTED_WARNINGS) fail(`  … ${e.errors.length - MAX_LISTED_WARNINGS} more`);
    fail(`✗ ${e.errors.length} errors in the draft; no page was written`);
    return 1;
  }
  if (reportItem(e, fail)) return 1;
  if (e instanceof LintError) {
    fail(`✗ ${e.message}; no page was written:`);
    e.warnings.forEach((w) => fail(`  ${formatWarning(w)}`));
    return 1;
  }
  throw e;
}

const showValue = (v) => (typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));

function cmdConfig(args, { print, fail, env, themes }) {
  const [action, key, value] = args;
  try {
    if (action === 'set') {
      if (key === undefined || value === undefined) throw new ConfigError('Usage: am config set <key> <value>');
      print(`✓ ${key} = ${showValue(setConfig(key, value, env, themes))}`);
      return 0;
    }
    if (action === 'get') {
      if (!CONFIG_KEYS[key]) throw new ConfigError(`No setting named "${key}". Available: ${Object.keys(CONFIG_KEYS).join(' | ')}`);
      print(showValue(readConfig(env, themes).values[key]));
      return 0;
    }
    if (action === 'reset') {
      resetConfig(key, env);
      print(key ? `✓ ${key} reset to default` : '✓ All settings reset to default');
      return 0;
    }
    if (action !== undefined) throw new ConfigError(`Unknown action "${action}". Usage: am config [set <key> <value> | get <key> | reset [key]]`);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    fail(`✗ ${e.message}`);
    return 2;
  }
  themeWarnings({ fail, themes });
  const { values, stored, warning, path } = readConfig(env, themes);
  if (warning) fail(`! ${warning}`);
  print(`Config file: ${path}`);
  for (const [k, spec] of Object.entries(CONFIG_KEYS)) {
    const mark = k in stored ? '*' : ' ';
    const options = spec.type === 'bool' ? 'on | off'
      : spec.type === 'number' ? `${spec.min}–${spec.max}, step ${spec.step}`
        : configChoices(k, themes).join(' | ');
    print(`${mark} ${k.padEnd(19)}${showValue(values[k]).padEnd(10)}${spec.label} (${options})`);
  }
  if (env.AM_NO_OPEN && env.AM_NO_OPEN !== '0') print('Note: the AM_NO_OPEN environment variable is set and overrides the open setting.');
  print('* marks a value you changed. Change: am config set <key> <value>; reset to default: am config reset [key]');
  return 0;
}

function cmdList({ print, fail, themes }) {
  themeWarnings({ fail, themes });
  print('Templates (template):');
  print('  sheet   blueprint board: a grid of letter-numbered panels, for a one-screen overview (default)');
  print('  doc     linear explainer: one-column reading, with contents when there are 3+ panels');
  print('  video   explainer video: render with am video, see am help video');
  print('\nThemes (theme):');
  const note = (t) => (t.user ? ' (yours)' : t.scope.includes('page') ? '' : ' (video only)');
  for (const t of themes.list('video')) print(`  ${t.name.padEnd(10)}${t.summary}${note(t)}`);
  print('\nComponents (fence language):');
  for (const c of COMPONENTS.values()) print(`  ${c.name.padEnd(10)}${c.summary}`);
  print('  html/svg  embed as-is (escape hatch)');
  print('  <other>   code block; src=path lines=a-b quotes a file (am help code)');
  print('\nSyntax: am help <component>; draft format: am help format');
}

// Every component's example plus a table, so one page shows how a theme looks on all of them.
function specimenDraft(name, mode) {
  const sections = [...COMPONENTS.values()].map((c) => `## ${c.name}\n${c.example}`);
  const table = '## table\n| Check | Status |\n|---|---|\n| Approved | ok passes |\n| Rejected | no fails |\n| Pending | warn needs a look |';
  return `---\ntitle: Theme ${name} (${mode})\nlang: en\n---\n${[...sections, table].join('\n\n')}\n`;
}

function cmdTheme(action, target, opts, ctx) {
  if (['add', 'list', 'update', 'remove'].includes(action)) return cmdThemeMarket(action, target, opts, ctx);
  const { print, fail, env, io } = ctx;
  if (action !== 'check' || !target) {
    fail(`✗ Usage: am theme check <name|file.json> | ${THEME_MARKET_USAGE}`);
    return 2;
  }
  const isFile = /\.json$/i.test(target) || /[\\/]/.test(target);
  const path = isFile ? resolve(io.cwd ?? process.cwd(), target) : join(amHome(env), 'themes', `${target}.json`);
  const name = isFile ? basename(path).replace(/\.json$/i, '') : target;
  let theme;
  let errors = [];
  if (!isFile && getTheme(name)) {
    theme = getTheme(name);
  } else if (existsSync(path)) {
    ({ theme, errors } = readThemeFile(path, themeNames('video')));
  } else {
    fail(`✗ No theme named "${target}": ${path} does not exist`);
    return 2;
  }
  const tokens = theme?.tokens ?? theme?.video?.tokens;
  const colors = tokens ? checkColors({ tokens }) : { errors: [], warnings: [] };
  const warnings = [...colors.warnings, ...externalResourceWarnings(theme)];
  const all = [...errors, ...colors.errors];
  all.forEach((e) => print(`✗ ${e}`));
  warnings.forEach((w) => print(`! ${w}`));
  print(`${name}: ${all.length} error${all.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
  if (all.length) return 1;
  if (!theme.scope.includes('page')) return 0;

  const themes = isFile ? loadThemes(amHome(env), { extra: path }) : ctx.themes;
  const files = ['light', 'dark'].map((mode) => {
    const result = renderDoc(specimenDraft(name, mode), { theme: name, mode, style: 'off' }, {}, { themes });
    const file = outputPath('pages', `theme-${name}-${mode}`, {}, ctx);
    writePage(file, result.html, env);
    print(`✓ ${file}`);
    return file;
  });
  const config = readConfig(env, themes);
  if (shouldOpen(opts, env, config.values)) files.forEach((f) => (io.open ?? openFile)(f));
  return 0;
}

function cmdHelp(name, { print, fail }) {
  if (!name) return print(USAGE), 0;
  if (name === 'format') return print(FORMAT), 0;
  if (name === 'image') return print(IMAGE_HELP), 0;
  if (name === 'code') return print(CODE_HELP), 0;
  if (name === 'video') return print(VIDEO_FORMAT), 0;
  if (name === 'patch') return print(PATCH_HELP), 0;
  if (name === 'theme') return print(THEME_HELP), 0;
  if (name === 'html' || name === 'svg') return print(RAW_HELP.replace(/LANG/g, name)), 0;
  const comp = COMPONENTS.get(name);
  if (!comp) {
    fail(`✗ No component named "${name}". Available: ${[...COMPONENTS.keys()].join(', ')}, html, svg, format, code, image, video, patch, theme`);
    return 2;
  }
  print(`${comp.name} — ${comp.summary}\n\n${comp.syntax}\n\nExample:\n${comp.example}`);
  return 0;
}

function slug(title) {
  const s = String(title || 'page').trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'page';
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function openFile(file) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [file]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]]
      : ['xdg-open', [file]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {
    // Failing to open the browser does not affect the output; the path is already printed.
  }
}
