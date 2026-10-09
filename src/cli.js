// am CLI: render / patch / video / lint / theme / list / help. main() takes injected streams and environment variables, for testing.

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { VERSION } from './assets.js';
import { join, resolve, dirname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { renderDoc, RenderError, LintError } from './render.js';
import { parseDoc, ParseError, CHOICES, VOICES } from './parse.js';
import { lintDoc, formatWarning } from './lint/ste.js';
import { resolveLanguage } from './language.js';
import { COMPONENTS } from './components/index.js';
import { themeNames, getTheme, loadThemes } from './themes/registry.js';
import { readThemeFile } from './themes/user.js';
import { checkColors, COLOR_TOKENS } from './themes/check.js';
import { renderVideo } from './video/render.js';
import { pickProvider, TtsError } from './video/tts.js';
import { exportMp4, exportWebm, ExportError } from './video/export.js';
import { afterRender, clean, usage, mb, CLEAN } from './housekeeping.js';
import { runUpdateCheck } from './update.js';
import { amHome, readConfig, setConfig, resetConfig, configChoices, CONFIG_KEYS, ConfigError } from './config.js';
import { hasCommand } from './sys.js';
import { replacePanel, PatchError } from './patch.js';
import { readPage } from './page.js';
import { readEmbeddedImages } from './images.js';
import { readEmbeddedCode, MAX_CODE_LINES, LONG_CODE_LINES } from './code.js';
import { languageIds } from './languages/registry.js';

const MAX_LISTED_WARNINGS = 20;

const USAGE = `Answer me with HTML ${VERSION} — renders a Markdown draft into a single-file HTML explainer page

Usage:
  am render <file|->  [-o <path>] [--no-open] [--theme ${['auto', ...themeNames('page')].join('|')}]
                      [--template sheet|doc] [--style off|80|strict] [--mode auto|light|dark]
  am patch  <html> --panel <title> [file|-] [--from file] [--theme …] [--no-open]
                                                  replace one ## panel of an existing page and overwrite that HTML in place
  am video  <file|->  [-o <path>] [--voice auto|elevenlabs|local|system|off] [--mp4] [--webm] [--no-open]
                      [--theme ${['auto', ...themeNames('video')].join('|')}] [--mode light|dark]
                                                  render a video draft into a 3b1b-style explainer video player page (--mp4 / --webm also save a video file)
  am lint   <file|->  [--style off|80|strict]     run only the STE controlled-writing check
  am config [set <key> <value> | get <key> | reset [key]]  show or change settings
  am clean  [--days 30] [--all] [--dry-run]       delete old pages, old videos and the voice-over cache
  am theme check <name|file.json> [--no-open]     check a theme's colors and contrast, and render specimen pages
  am list                                         list templates, themes and components
  am help [component|format|code|image|video|patch|theme]  show component syntax / page draft format / code block / image syntax / video draft format / patch / theme usage

- A file argument of - reads from stdin (good for heredoc: am render - <<'EOF' ... EOF).
- Output goes to ~/.answer-me-with-html/pages/ by default (change it with the AM_HOME environment variable).
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

- "## " starts a panel; the letter ID is optional (A, B, C... are assigned automatically). span is a hint: the page sizes panels to fit their content, so wide tables and diagrams need no span. Write span only for a panel that must stand out.
- An image on its own line, ![what it shows](path), becomes a captioned figure and is embedded in the page; see am help image.
- A placeholder such as <host> is shown as text. Inside a sentence only text-level tags stay (b, i, kbd, sup, a, span, br, img ...), and tags that break the page (script, style, iframe ...) are shown as text too. Put raw markup in an html or svg fence and code in backticks.
- Any other fence language is a code block; \`\`\`ts src=path lines=18-30 quotes real code from a file; see am help code.
- For the component list see am list; for one component's syntax see am help <component>.`;

const IMAGE_HELP = `Images: a screenshot, photo or render that already exists as a file

![What the picture shows](/absolute/path/to/screenshot.png)

- Put the image alone on its line; the alt text becomes its caption, so write what the picture shows (the STE check reads it).
- Use the absolute path. A relative path is read from the draft file's folder, or from the current folder when the draft comes from stdin. A space in the path is fine.
- PNG, JPG, GIF, WebP, AVIF and SVG files up to 5 MB. The file is embedded in the page, which stays one file that opens offline.
- http(s) URLs and data: URIs are left as they are. A URL needs the network when the page is opened.
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
  timeline, limits, table rows, list items and paragraphs step item by item. With more steps than narration lines, the steps are spread across the lines;
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
        all: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
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
    case 'render': return withSource(arg, io, fail, (src, baseDir) => cmdRender(src, opts, ctx, baseDir));
    case 'patch': return cmdPatch(arg, rest[0], opts, ctx);
    case 'video': return withSource(arg, io, fail, (src) => cmdVideo(src, opts, ctx));
    case 'lint': return withSource(arg, io, fail, (src) => cmdLint(src, opts, { print, fail }));
    case 'config': return cmdConfig([arg, ...rest].filter((x) => x !== undefined), ctx);
    case 'theme': return cmdTheme(arg, rest[0], opts, ctx);
    case 'clean': return cmdClean(opts, { print, fail, env });
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
  return fn(src, arg === '-' ? cwd : dirname(resolve(cwd, arg)));
}

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// Whether to open automatically: --open forces it > --no-open > AM_NO_OPEN (not 0) > CI environment > config open.
export function shouldOpen(opts, env, config) {
  if (opts.open) return true;
  if (opts['no-open']) return false;
  if (env.AM_NO_OPEN && env.AM_NO_OPEN !== '0') return false;
  if (env.CI) return false;
  return config.open !== false;
}

function cmdRender(src, opts, ctx, baseDir) {
  const { fail } = ctx;
  const config = loadConfig(ctx);
  const { theme, mode, style } = config.values;
  let result;
  try {
    result = renderDoc(src, { theme: opts.theme, template: opts.template, style: opts.style, mode: opts.mode }, { theme, mode, style }, { themes: ctx.themes, baseDir, codeDir: ctx.io.cwd ?? process.cwd() });
  } catch (e) {
    return reportError(e, fail);
  }
  const file = outputPath('pages', result.meta.title, opts, ctx);
  emit(result, file, ctx);
  return finish(file, opts, config, ctx);
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

const THEME_HELP = `Your own theme: one JSON file per theme in ~/.answer-me-with-html/themes/ (AM_HOME moves it)

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
- Fonts: name installed fonts only; the default font stack is added as the fallback. No font files are embedded.
- css (optional): start every selector with &, which stands for the theme's root, so the rules apply only under this theme.
- video (optional): video-only variables (--v-stage, --v-title-font, --v-cap-fg, --v-cap-bg, --v-glow) and & css for am video.
- A page carries the built-in themes plus its own theme, so it opens anywhere; readers without your fonts see the fallback.
- A file with problems is skipped with a warning; am theme check <name|file.json> tells you why.

am theme check <name|file.json> [--no-open]
- Reports invalid colors, missing variables and contrast below WCAG AA in light and dark (text 4.5:1; status badges 3:1, warning below 4.5:1).
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
      result = renderDoc(patched, overrides, { theme, mode, style }, { themes: ctx.themes, previousLanguage: page.lang, baseDir: cwd, codeDir: cwd, knownImages: readEmbeddedImages(html), knownCode: readEmbeddedCode(html) });
    }
  } catch (e) {
    if (e instanceof TtsError) {
      fail(`✗ Voice-over failed: ${e.message}. Add --voice off for captions only`);
      return 1;
    }
    return reportError(e, fail);
  }
  emit(result, file, ctx, video ? ' (an MP4 or WebM with the same name is not updated; run am video --mp4 or --webm again if you need it)' : '');
  return finish(file, opts, config, ctx);
}

async function cmdVideo(src, opts, ctx) {
  const { fail } = ctx;
  const config = loadConfig(ctx);
  const voice = opts.voice ?? config.values.voice;
  if (!validVoice(voice, fail)) return 2;
  let result;
  try {
    result = await buildVideo(src, voice, opts, config, ctx);
  } catch (e) {
    if (!(e instanceof TtsError)) return reportError(e, fail);
    fail(`✗ Voice-over failed: ${e.message}. Add --voice off for captions only`);
    return 1;
  }
  const file = outputPath('videos', result.meta.title, opts, ctx);
  emit(result, file, ctx);
  for (const format of ['mp4', 'webm']) {
    if (opts[format] && !(await exportVideo(file, result.wav, format, ctx))) return 1;
  }
  return finish(file, opts, config, ctx);
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
    cacheDir: join(amHome(env), 'cache', 'tts'),
    defaults: { style: config.values.style, theme: config.values.theme, mode: config.values.mode },
    overrides: { style: opts.style, theme: opts.theme, mode: opts.mode },
    previousLanguage: opts.previousLanguage,
    onProgress: (msg) => fail(`  ${msg}`),
    themes,
  });
  return { ...result, voiceName: voiceSummary(provider, result.captionsOnly) };
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
function outputPath(dir, title, opts, { env, io }) {
  if (opts.out) return resolve(io.cwd ?? process.cwd(), opts.out);
  return join(amHome(env), dir, `${slug(title)}-${stamp(new Date(io.now?.() ?? Date.now()))}.html`);
}

// Write the page, print the path, a one-line summary (note follows the summary) and writing warnings. Shared by render / video / patch.
function emit(result, file, { print }, note = '') {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, result.html);
  print(`✓ ${file}`);
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
  printWarnings(result.warnings, print, result.meta.style);
}

// What a component noticed in its own block (a group box that would be empty after a change). The page is still written.
function printComponentWarnings(notes = [], print) {
  if (!notes.length) return;
  print(`  diagram ${count(notes.length, 'warning')} (the page is written; fix the draft if that is not what you meant):`);
  notes.toSorted((a, b) => a.line - b.line).slice(0, MAX_LISTED_WARNINGS).forEach((w) => print(`  L${w.line} [${w.component}] ${w.message}`));
  if (notes.length > MAX_LISTED_WARNINGS) print(`  … ${notes.length - MAX_LISTED_WARNINGS} more`);
}

// Raw HTML the render changed (a placeholder shown as text, a tag or attribute removed). Not STE warnings: they never fail style: strict.
function printHtmlWarnings(notes = [], print) {
  const lines = [...new Set(notes.toSorted((a, b) => a.line - b.line).map((w) => `L${w.line} [html] ${w.message}`))];
  if (!lines.length) return;
  print(`  html ${count(lines.length, 'warning')} (the page differs from the draft here; fix the draft if that is not what you meant):`);
  lines.slice(0, MAX_LISTED_WARNINGS).forEach((l) => print(`  ${l}`));
  if (lines.length > MAX_LISTED_WARNINGS) print(`  … ${lines.length - MAX_LISTED_WARNINGS} more`);
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
  const dry = Boolean(opts['dry-run']);
  const r = clean(home, { days, all: Boolean(opts.all), dryRun: dry });
  const scope = opts.all ? 'all pages and videos' : `pages and videos older than ${count(days, 'day')}`;
  print(`Data directory: ${home} (${mb(before.total)} in total: ${count(before.pages.count, 'page')}, ${count(before.videos.count, 'video')}, ${mb(before.cache.bytes)} voice-over cache)`);
  print(dry
    ? `Would delete ${count(r.files, 'file')}, freeing ${mb(r.bytes)} (${scope} + voice-over cache). Run without --dry-run to delete.`
    : `✓ Deleted ${count(r.files, 'file')}, freeing ${mb(r.bytes)} (${scope} + voice-over cache). Settings were kept.`);
  return 0;
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

function reportError(e, fail) {
  if (e instanceof RenderError) {
    fail(`✗ L${e.line} [${e.component}] ${e.message}`);
    if (e.example) fail(`  Correct example:\n${e.example.replace(/^/gm, '    ')}`);
    fail(`  Full syntax: am help ${e.component}`);
    return 1;
  }
  if (e instanceof ParseError) {
    fail(`✗ ${e.line ? `L${e.line} ` : ''}Cannot parse the draft: ${e.message}`);
    return 1;
  }
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
    const options = spec.type === 'bool' ? 'on | off' : configChoices(k, themes).join(' | ');
    print(`${mark} ${k.padEnd(13)}${showValue(values[k]).padEnd(10)}${spec.label} (${options})`);
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
  const { print, fail, env, io } = ctx;
  if (action !== 'check' || !target) {
    fail('✗ Usage: am theme check <name|file.json>');
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
  const all = [...errors, ...colors.errors];
  all.forEach((e) => print(`✗ ${e}`));
  colors.warnings.forEach((w) => print(`! ${w}`));
  print(`${name}: ${all.length} error${all.length === 1 ? '' : 's'}, ${colors.warnings.length} warning${colors.warnings.length === 1 ? '' : 's'}`);
  if (all.length) return 1;
  if (!theme.scope.includes('page')) return 0;

  const themes = isFile ? loadThemes(amHome(env), { extra: path }) : ctx.themes;
  const files = ['light', 'dark'].map((mode) => {
    const result = renderDoc(specimenDraft(name, mode), { theme: name, mode, style: 'off' }, {}, { themes });
    const file = outputPath('pages', `theme-${name}-${mode}`, {}, ctx);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, result.html);
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
