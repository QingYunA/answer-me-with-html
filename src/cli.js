// am CLI: render / patch / lint / list / help. main() takes injected streams and environment variables, for testing.

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { VERSION } from './assets.js';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { renderDoc, RenderError, LintError } from './render.js';
import { parseDoc, ParseError, CHOICES, VOICES } from './parse.js';
import { lintDoc, formatWarning } from './lint/ste.js';
import { COMPONENTS } from './components/index.js';
import { THEMES } from './themes/index.js';
import { renderVideo } from './video/render.js';
import { pickProvider, TtsError } from './video/tts.js';
import { exportMp4, ExportError } from './video/export.js';
import { afterRender, clean, usage, mb, CLEAN } from './housekeeping.js';
import { runUpdateCheck } from './update.js';
import { amHome, readConfig, setConfig, resetConfig, CONFIG_KEYS, ConfigError } from './config.js';
import { replacePanel, PatchError } from './patch.js';
import { readPage } from './page.js';

const MAX_LISTED_WARNINGS = 20;

const USAGE = `Answer me with HTML ${VERSION} — renders a Markdown draft into a single-file HTML explainer page

Usage:
  am render <file|->  [-o <path>] [--no-open] [--theme blueprint|shadcn]
                      [--template sheet|doc] [--style off|80|strict] [--mode auto|light|dark]
  am patch  <html> --panel <title> [file|-] [--from file] [--theme …] [--no-open]
                                                  replace one ## panel of an existing page and overwrite that HTML in place
  am video  <file|->  [-o <path>] [--voice auto|elevenlabs|local|system|off] [--mp4] [--no-open]
                      [--theme blueprint|shadcn|3b1b] [--mode light|dark]
                                                  render a video draft into a 3b1b-style explainer video player page (--mp4 also saves a video file)
  am lint   <file|->  [--style off|80|strict]     run only the STE controlled-writing check
  am config [set <key> <value> | get <key> | reset [key]]  show or change settings
  am clean  [--days 30] [--all] [--dry-run]       delete old pages, old videos and the voice-over cache
  am list                                         list templates, themes and components
  am help [component|format|video|patch]          show component syntax / page draft format / video draft format / patch usage

- A file argument of - reads from stdin (good for heredoc: am render - <<'EOF' ... EOF).
- Output goes to ~/.answer-me-with-html/pages/ by default (change it with the AM_HOME environment variable).
- Set auto-open, the default theme and more with am config; --open / --no-open apply to this run only.
- am patch reads the source draft from the page's hidden #am-source, changes only the ## section that --panel names, and writes the page back to the same path.`;

const FORMAT = `Draft format (extended Markdown)

---
template: sheet        # sheet: blueprint board (default, multi-panel grid) | doc: linear explainer (one column + contents)
theme: blueprint       # blueprint: drawing style (default) | shadcn: card style; switchable in the page
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
- For the component list see am list; for one component's syntax see am help <component>.`;

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
theme: blueprint               # blueprint: drawing style (default, follows the theme in am config) | shadcn: cards | 3b1b: dark
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
- When narration line N plays, step N of the picture appears: in flow / sequence / tree each source line is one step;
  timeline, limits, table rows, list items and paragraphs step item by item. With more steps than narration lines, the steps are spread across the lines;
  with more narration lines than steps, the extra first lines act as an opening and show nothing new.
- Write [name] in narration: the camera zooms in on the element with that name and highlights it, and the word turns yellow in the caption.
- Nodes / participants with the same name in adjacent scenes move smoothly from the old position to the new one (cross-scene morph).
- Voice-over: --voice auto (default: ElevenLabs if ELEVENLABS_API_KEY is set, otherwise system TTS) | elevenlabs | local | system | off.
  Set the ElevenLabs voice with ELEVENLABS_VOICE_ID and the model with ELEVENLABS_MODEL_ID (default eleven_v4_turbo).
  local calls a local OpenAI-compatible speech service (POST /v1/audio/speech, returns 16-bit PCM WAV):
  AM_TTS_URL (required, service base URL), AM_TTS_MODEL, AM_TTS_VOICE (required when the service has no default),
  AM_TTS_API_KEY is sent as a Bearer token when set; AM_TTS_EXTRA holds model-specific parameters (a JSON object); AM_TTS_MODEL / AM_TTS_VOICE override the same fields in it,
  and am always sets input, response_format and stream. A line whose duration is clearly wrong is synthesized again,
  up to AM_TTS_ATTEMPTS times per line (default 3; set 1 to turn this off).
  Example: AM_TTS_URL=http://127.0.0.1:8000 AM_TTS_MODEL=mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit \
      AM_TTS_VOICE=vivian am video draft.md --voice local
- Output goes to ~/.answer-me-with-html/videos/; --mp4 also saves an .mp4 with the same name (needs Chrome and ffmpeg, Node 22+).`;

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

  switch (cmd) {
    case 'render': return withSource(arg, io, fail, (src) => cmdRender(src, opts, { print, fail, env, io }));
    case 'patch': return cmdPatch(arg, rest[0], opts, { print, fail, env, io });
    case 'video': return withSource(arg, io, fail, (src) => cmdVideo(src, opts, { print, fail, env, io }));
    case 'lint': return withSource(arg, io, fail, (src) => cmdLint(src, opts, { print, fail }));
    case 'config': return cmdConfig([arg, ...rest].filter((x) => x !== undefined), { print, fail, env });
    case 'clean': return cmdClean(opts, { print, fail, env });
    case '__update-check': return (await runUpdateCheck(amHome(env))) ? 0 : 1;
    case 'list': return cmdList(print), 0;
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
  let src;
  try {
    src = arg === '-' ? await readStream(io.stdin ?? process.stdin) : readFileSync(resolve(io.cwd ?? process.cwd(), arg), 'utf8');
  } catch (e) {
    fail(`✗ Cannot read the draft: ${e.message}`);
    return 2;
  }
  if (!src.trim()) {
    fail('✗ The draft is empty');
    return 2;
  }
  return fn(src);
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

function cmdRender(src, opts, ctx) {
  const { fail } = ctx;
  const config = loadConfig(ctx);
  const { theme, mode, style } = config.values;
  let result;
  try {
    result = renderDoc(src, { theme: opts.theme, template: opts.template, style: opts.style, mode: opts.mode }, { theme, mode, style });
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
      result = await buildVideo(patched, voice, { ...opts, theme: overrides.theme, mode: overrides.mode, style: overrides.style }, config, ctx);
    } else {
      result = renderDoc(patched, overrides, { theme, mode, style });
    }
  } catch (e) {
    if (e instanceof TtsError) {
      fail(`✗ Voice-over failed: ${e.message}. Add --voice off for captions only`);
      return 1;
    }
    return reportError(e, fail);
  }
  emit(result, file, ctx, video ? ' (an MP4 with the same name is not updated; run am video --mp4 again if you need it)' : '');
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
  if (opts.mp4 && !(await exportVideoMp4(file, result.wav, ctx))) return 1;
  return finish(file, opts, config, ctx);
}

function validVoice(voice, fail) {
  if (VOICES.includes(voice)) return true;
  fail(`✗ Invalid voice value "${voice}". Choose one of: ${VOICES.join(' | ')}`);
  return false;
}

async function buildVideo(src, voice, opts, config, { fail, env, io }) {
  const provider = io.ttsProvider !== undefined ? io.ttsProvider : pickProvider(voice, env);
  const result = await renderVideo(src, {
    provider,
    cacheDir: join(amHome(env), 'cache', 'tts'),
    defaults: { style: config.values.style, theme: config.values.theme, mode: config.values.mode },
    overrides: { style: opts.style, theme: opts.theme, mode: opts.mode },
    onProgress: (msg) => fail(`  ${msg}`),
  });
  return { ...result, voiceName: provider ? provider.name : 'none (captions only)' };
}

async function exportVideoMp4(file, wav, { print, fail, env }) {
  const mp4 = `${file.replace(/\.html?$/i, '')}.mp4`;
  const started = Date.now();
  try {
    await exportMp4(file, mp4, { wav, env, onProgress: (i, n) => fail(`  Exporting MP4: frame ${i}/${n}`) });
  } catch (e) {
    if (!(e instanceof ExportError)) throw e;
    fail(`✗ MP4 export failed: ${e.message}. The player page was written and plays in a browser`);
    return false;
  }
  print(`✓ ${mp4} (exported in ${((Date.now() - started) / 1000).toFixed(0)}s)`);
  return true;
}

function loadConfig({ fail, env }) {
  const config = readConfig(env);
  if (config.warning) fail(`! ${config.warning}`);
  return config;
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
  printWarnings(result.warnings, print, result.meta.style);
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
  const warnings = style === 'off' ? [] : lintDoc(doc);
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

function cmdConfig(args, { print, fail, env }) {
  const [action, key, value] = args;
  try {
    if (action === 'set') {
      if (key === undefined || value === undefined) throw new ConfigError('Usage: am config set <key> <value>');
      print(`✓ ${key} = ${showValue(setConfig(key, value, env))}`);
      return 0;
    }
    if (action === 'get') {
      if (!CONFIG_KEYS[key]) throw new ConfigError(`No setting named "${key}". Available: ${Object.keys(CONFIG_KEYS).join(' | ')}`);
      print(showValue(readConfig(env).values[key]));
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
  const { values, stored, warning, path } = readConfig(env);
  if (warning) fail(`! ${warning}`);
  print(`Config file: ${path}`);
  for (const [k, spec] of Object.entries(CONFIG_KEYS)) {
    const mark = k in stored ? '*' : ' ';
    const options = spec.type === 'bool' ? 'on | off' : spec.choices.join(' | ');
    print(`${mark} ${k.padEnd(13)}${showValue(values[k]).padEnd(10)}${spec.label} (${options})`);
  }
  if (env.AM_NO_OPEN && env.AM_NO_OPEN !== '0') print('Note: the AM_NO_OPEN environment variable is set and overrides the open setting.');
  print('* marks a value you changed. Change: am config set <key> <value>; reset to default: am config reset [key]');
  return 0;
}

function cmdList(print) {
  print('Templates (template):');
  print('  sheet   blueprint board: a grid of letter-numbered panels, for a one-screen overview (default)');
  print('  doc     linear explainer: one-column reading, with contents when there are 3+ panels');
  print('  video   explainer video: render with am video, see am help video');
  print('\nThemes (theme):');
  for (const [name, t] of Object.entries(THEMES)) print(`  ${name.padEnd(10)}${t.label}`);
  print('\nComponents (fence language):');
  for (const c of COMPONENTS.values()) print(`  ${c.name.padEnd(10)}${c.summary}`);
  print('  html/svg  embed as-is (escape hatch)');
  print('\nSyntax: am help <component>; draft format: am help format');
}

function cmdHelp(name, { print, fail }) {
  if (!name) return print(USAGE), 0;
  if (name === 'format') return print(FORMAT), 0;
  if (name === 'video') return print(VIDEO_FORMAT), 0;
  if (name === 'patch') return print(PATCH_HELP), 0;
  if (name === 'html' || name === 'svg') return print(RAW_HELP.replace(/LANG/g, name)), 0;
  const comp = COMPONENTS.get(name);
  if (!comp) {
    fail(`✗ No component named "${name}". Available: ${[...COMPONENTS.keys()].join(', ')}, html, svg, format, video, patch`);
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
