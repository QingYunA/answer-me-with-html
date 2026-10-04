// am CLI：render / patch / lint / list / help。main() 接收注入的流与环境变量，方便测试。

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { VERSION } from './assets.js';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { renderDoc, RenderError, LintError } from './render.js';
import { parseDoc, ParseError, CHOICES } from './parse.js';
import { lintDoc, formatWarning } from './lint/ste.js';
import { COMPONENTS } from './components/index.js';
import { THEMES } from './themes/index.js';
import { renderVideo } from './video/render.js';
import { pickProvider, TtsError, VOICES } from './video/tts.js';
import { exportMp4, ExportError } from './video/export.js';
import { afterRender, clean, usage, mb, CLEAN } from './housekeeping.js';
import { runUpdateCheck } from './update.js';
import { amHome, readConfig, setConfig, resetConfig, CONFIG_KEYS, ConfigError } from './config.js';
import { extractSource, replacePanel, pageSettings, isVideoPage, PatchError } from './patch.js';

const MAX_LISTED_WARNINGS = 20;

const USAGE = `Answer me with HTML ${VERSION} — 把 Markdown 内容稿渲染成单文件 HTML 解释页

用法:
  am render <file|->  [-o 输出路径] [--no-open] [--theme blueprint|shadcn]
                      [--template sheet|doc] [--style off|80|strict] [--mode auto|light|dark]
  am patch  <html> --panel <标题> [file|-] [--from file] [--theme …] [--no-open]
                                                  替换已有页面中的一个 ## 面板，原地覆盖该 HTML
  am video  <file|->  [-o 输出路径] [--voice auto|elevenlabs|system|off] [--mp4] [--no-open]
                      [--theme blueprint|shadcn|3b1b] [--mode light|dark]
                                                  把视频稿渲染成 3b1b 风格的解释视频播放页（--mp4 另存视频文件）
  am lint   <file|->  [--style off|80|strict]     只做 STE 受控写作检查
  am config [set <键> <值> | get <键> | reset [键]] 查看或修改配置
  am clean  [--days 30] [--all] [--dry-run]       清理旧页面、旧视频和配音缓存
  am list                                         列出模板、主题、组件
  am help [组件名|format|video|patch]              查看组件语法 / 页面稿格式 / 视频稿格式 / patch 用法

- 文件参数写 - 表示从 stdin 读取（适合 heredoc：am render - <<'EOF' ... EOF）。
- 默认输出到 ~/.answer-me-with-html/pages/（可用环境变量 AM_HOME 修改）。
- 是否自动打开浏览器、默认主题等用 am config 设置；--open / --no-open 只影响这一次。
- am patch 从页面隐藏的 #am-source 取回源稿，只改 --panel 对应的 ## 小节，再按原路径写回。`;

const FORMAT = `稿件格式（扩展 Markdown）

---
template: sheet        # sheet 图纸板（默认，多面板网格）| doc 线性讲解（单栏 + 目录）
theme: blueprint       # blueprint 图纸风（默认）| shadcn 卡片风；页面内可切换
title: 页面标题         # 也可以用正文第一行 "# 标题" 代替
subtitle: 副标题        # 可选
cols: 3                # sheet 网格列数，默认 3
style: 80              # STE 检查严格度：off | 80（默认，只警告）| strict（不达标不生成）
mode: auto             # auto 跟随系统 | light | dark
source: asd-ste100.org # 其他任意键会显示在页头元信息行
---
导语（可选，显示在标题下方）

## A 面板标题 {span=2 meta="右上角说明"}
普通 Markdown：段落、列表、表格、引用、行内代码……
表格单元格写 ok / no / warn（可跟文字，如 "ok 已批准"）会渲染成 ✓ / ✗ / ! 徽章。

\`\`\`flow LR          ← 围栏块语言名 = 组件名，后面是组件参数
A -> B
\`\`\`

\`\`\`html             ← html / svg 围栏块原样嵌入（逃生口）
<div>任意内容</div>
\`\`\`

- "## " 开启一个面板；字母 ID 可省略（自动分配 A、B、C…）。span 让面板跨列。
- 组件列表见 am list；单个组件语法见 am help <组件名>。`;

const RAW_HELP = `LANG — 原样嵌入（逃生口）

围栏块语言名写 LANG 时，内容不经处理直接放进页面。只在现有组件表达不了时使用；
颜色请用主题变量（如 var(--ink)、var(--accent)），这样切换主题和明暗时也能看清。

示例：
\`\`\`LANG
<div style="color: var(--accent)">任意内容</div>
\`\`\``;

const VIDEO_FORMAT = `视频稿格式（am video）

---
title: TCP 三次握手
subtitle: 为什么是三次          # 可选，片头副标题
theme: blueprint               # blueprint 图纸风（默认，跟随 am config 的 theme）| shadcn 卡片 | 3b1b 深色
mode: light                    # light | dark（blueprint + dark 是深蓝图纸）
---
> 片头旁白（可选；不写则片头停留 2.4 秒）

## 两端都在等待
\`\`\`sequence
Client -> Server: SYN
Server -> Client: SYN-ACK
Client -> Server: ACK
\`\`\`
> 客户端先发 SYN，请求建立连接。
> [Server] 收到后回 SYN-ACK。
> 客户端再回 ACK，连接建立。

- "## " 开启一个场景；场景里放组件或 Markdown（画面），以 > 开头的行是旁白（每行一拍）。
- 第 N 句旁白播出时，画面出现第 N 步：flow / sequence / tree 每行源码是一步；
  timeline、limits、表格行、列表项、段落按条目自动分步。步数多于旁白时均分到各句；
  旁白多于步数时，多出的前几句当开场白，不出新内容。
- 旁白里写 [名字]：镜头推近同名元素并高亮，字幕里该词变黄。
- 相邻场景里同名的节点 / 参与者会从旧位置平滑移到新位置（跨场景变形）。
- 配音：--voice auto（默认，有 ELEVENLABS_API_KEY 用 ElevenLabs，否则用系统 TTS）| elevenlabs | system | off。
  ElevenLabs 声音可用环境变量 ELEVENLABS_VOICE_ID 指定。
- 输出到 ~/.answer-me-with-html/videos/；--mp4 另存同名 .mp4（需要 Chrome 与 ffmpeg，Node 22+）。`;

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
      fail(`✗ 未知命令 "${cmd}"\n\n${USAGE}`);
      return 2;
  }
}

async function withSource(arg, io, fail, fn) {
  if (!arg) {
    fail('✗ 缺少稿件参数：传入文件路径，或用 - 从 stdin 读取');
    return 2;
  }
  let src;
  try {
    src = arg === '-' ? await readStream(io.stdin ?? process.stdin) : readFileSync(resolve(io.cwd ?? process.cwd(), arg), 'utf8');
  } catch (e) {
    fail(`✗ 无法读取稿件：${e.message}`);
    return 2;
  }
  if (!src.trim()) {
    fail('✗ 稿件为空');
    return 2;
  }
  return fn(src);
}

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// 是否自动打开：--open 强制打开 > --no-open > AM_NO_OPEN（非 0）> CI 环境 > 配置 open。
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

const PATCH_HELP = `原地替换已渲染页面中的一个面板

用法:
  am patch <html-file> --panel <标题> < new-panel.md
  am patch <html-file> --panel <标题> --from new-panel.md
  am patch <html-file> --panel <标题> -

- 从 <html-file> 里隐藏的 <textarea id="am-source"> 取回源稿。
- --panel 匹配 ## 小节的标题、字母 ID，或 "ID 标题"。
- 新稿件从 stdin 或 --from / 第二个文件参数读取：可带 ## 标题，也可只写面板正文。
- 用现有 renderer 重渲后覆盖同一个 HTML 路径，不另写带时间戳的新文件。
- 沿用原页面的模板、主题、明暗和 STE style（生成时记在页面根标签上）。之后改了配置，旧页面 patch 不会跟随；要换就加 --theme / --mode / --style。
- 找不到该面板，或页面没有 #am-source，退出码非 0 且不改文件。`;

async function cmdPatch(htmlArg, fromArg, opts, ctx) {
  const { fail, io } = ctx;
  if (!htmlArg || htmlArg === '-') {
    fail(htmlArg ? '✗ patch 需要已有 HTML 文件路径，不能从 stdin 读页面' : '✗ 缺少 HTML 文件路径');
    return 2;
  }
  if (!opts.panel || !String(opts.panel).trim()) {
    fail('✗ 缺少 --panel <标题>');
    return 2;
  }
  const cwd = io.cwd ?? process.cwd();
  const file = resolve(cwd, htmlArg);
  let html;
  try {
    html = readFileSync(file, 'utf8');
  } catch (e) {
    fail(`✗ 无法读取 HTML：${e.message}`);
    return 2;
  }
  const source = extractSource(html);
  if (source == null) {
    fail('✗ 页面里没有 #am-source，无法取回源稿');
    return 1;
  }
  const from = opts.from ?? fromArg;
  let replacement;
  try {
    replacement = !from || from === '-' ? await readStream(io.stdin ?? process.stdin) : readFileSync(resolve(cwd, from), 'utf8');
  } catch (e) {
    fail(`✗ 无法读取新面板稿件：${e.message}`);
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
  // 沿用原页面的模板、主题、明暗与 STE 严格度（生成时可能用过 --theme / --style 等参数）；本次命令行参数优先。
  // 视频页必须走 renderVideo，不能交给 renderDoc。
  const page = pageSettings(html);
  const video = isVideoPage(html);
  const overrides = {
    template: video ? undefined : (opts.template ?? page.template),
    theme: opts.theme ?? page.theme,
    mode: opts.mode ?? page.mode,
    style: opts.style ?? page.style,
  };
  let result;
  try {
    if (video) {
      // 原页用 --voice off 出的无声视频，patch 时不要按配置重配音，除非用户显式传 --voice。
      const voice = opts.voice ?? (html.includes('<audio id="amv-audio"') ? config.values.voice : 'off');
      if (!VOICES.includes(voice)) {
        fail(`✗ voice 的值 "${voice}" 无效，可选：${VOICES.join(' | ')}`);
        return 2;
      }
      // 视频页同样沿用原页面的主题、明暗与 STE 严格度（例如 3b1b / --style off），本次命令行参数优先。
      result = await buildVideo(patched, voice, { ...opts, theme: overrides.theme, mode: overrides.mode, style: overrides.style }, config, ctx);
    } else {
      result = renderDoc(patched, overrides, { theme, mode, style });
    }
  } catch (e) {
    if (e instanceof TtsError) {
      fail(`✗ 配音失败：${e.message}。可加 --voice off 只出字幕`);
      return 1;
    }
    return reportError(e, fail);
  }
  emit(result, file, ctx, video ? '（同名 MP4 不会自动更新，需要时用 am video --mp4 重新导出）' : '');
  return finish(file, opts, config, ctx);
}

async function cmdVideo(src, opts, ctx) {
  const { fail } = ctx;
  const config = loadConfig(ctx);
  const voice = opts.voice ?? config.values.voice;
  if (!VOICES.includes(voice)) {
    fail(`✗ voice 的值 "${voice}" 无效，可选：${VOICES.join(' | ')}`);
    return 2;
  }
  let result;
  try {
    result = await buildVideo(src, voice, opts, config, ctx);
  } catch (e) {
    if (!(e instanceof TtsError)) return reportError(e, fail);
    fail(`✗ 配音失败：${e.message}。可加 --voice off 只出字幕`);
    return 1;
  }
  const file = outputPath('videos', result.meta.title, opts, ctx);
  emit(result, file, ctx);
  if (opts.mp4 && !(await exportVideoMp4(file, result.wav, ctx))) return 1;
  return finish(file, opts, config, ctx);
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
  return { ...result, voiceName: provider ? provider.name : '无（只出字幕）' };
}

async function exportVideoMp4(file, wav, { print, fail, env }) {
  const mp4 = `${file.replace(/\.html?$/i, '')}.mp4`;
  const started = Date.now();
  try {
    await exportMp4(file, mp4, { wav, env, onProgress: (i, n) => fail(`  导出 MP4：${i}/${n} 帧`) });
  } catch (e) {
    if (!(e instanceof ExportError)) throw e;
    fail(`✗ MP4 导出失败：${e.message}。播放页已生成，可直接在浏览器播放`);
    return false;
  }
  print(`✓ ${mp4}（${((Date.now() - started) / 1000).toFixed(0)}s 导出）`);
  return true;
}

function loadConfig({ fail, env }) {
  const config = readConfig(env);
  if (config.warning) fail(`! ${config.warning}`);
  return config;
}

// 输出路径：-o 指定时用该路径，否则放进数据目录的 pages/ 或 videos/。io.now 可注入时钟。
function outputPath(dir, title, opts, { env, io }) {
  if (opts.out) return resolve(io.cwd ?? process.cwd(), opts.out);
  return join(amHome(env), dir, `${slug(title)}-${stamp(new Date(io.now?.() ?? Date.now()))}.html`);
}

// 写出页面，打印路径、一行摘要（note 接在摘要后）和写作警告。render / video / patch 共用。
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
    return `video · ${meta.theme} · ${stats.panels} 场景 · ${result.beats} 句旁白 · ${result.duration.toFixed(1)}s · 配音：${result.voiceName}`;
  }
  const comps = Object.entries(stats.components).map(([k, v]) => `${k}×${v}`).join(' ');
  return `${meta.template} · ${meta.theme} · ${stats.panels} 面板${comps ? ` · ${comps}` : ''}`;
}

// 渲染成功后的收尾：打印维护提示，按配置打开浏览器。io.open 可注入打开方式。
function finish(file, opts, config, ctx) {
  printHints(config, ctx);
  if (shouldOpen(opts, ctx.env, config.values)) (ctx.io.open ?? openFile)(file);
  return 0;
}

// 渲染成功后附带的提示（清理、更新），给 Agent 看，由 Agent 询问用户。
function printHints(config, { env, io, print }) {
  try {
    const hints = afterRender({
      home: amHome(env), env, config: config.values, current: VERSION,
      scriptPath: io.scriptPath, background: Boolean(io.background),
    });
    hints.forEach((h) => print(h));
  } catch {
    // 维护提示出错不影响渲染结果。
  }
}

function cmdClean(opts, { print, fail, env }) {
  if (opts.days !== undefined && !/^\d+$/.test(opts.days.trim())) {
    fail('✗ --days 需要非负整数');
    return 2;
  }
  const days = opts.days === undefined ? CLEAN.days : Number(opts.days);
  const home = amHome(env);
  const before = usage(home);
  const dry = Boolean(opts['dry-run']);
  const r = clean(home, { days, all: Boolean(opts.all), dryRun: dry });
  const scope = opts.all ? '全部页面和视频' : `${days} 天前的页面和视频`;
  print(`数据目录：${home}（共 ${mb(before.total)}：页面 ${before.pages.count} 个，视频 ${before.videos.count} 个，配音缓存 ${mb(before.cache.bytes)}）`);
  print(dry
    ? `将删除 ${r.files} 个文件，释放 ${mb(r.bytes)}（${scope} + 配音缓存）。去掉 --dry-run 执行。`
    : `✓ 已删除 ${r.files} 个文件，释放 ${mb(r.bytes)}（${scope} + 配音缓存）。配置已保留。`);
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
    fail(`✗ style 的值 "${style}" 无效，可选：${CHOICES.style.join(' | ')}`);
    return 2;
  }
  const warnings = style === 'off' ? [] : lintDoc(doc);
  printWarnings(warnings, print, style);
  return style === 'strict' && warnings.length ? 1 : 0;
}

function printWarnings(warnings, print, style) {
  if (style === 'off') return print('  STE 检查已关闭');
  if (!warnings.length) return print('  STE ✓ 0 条警告');
  print(`  STE ${warnings.length} 条警告（修正稿件后重新执行）：`);
  warnings.slice(0, MAX_LISTED_WARNINGS).forEach((w) => print(`  ${formatWarning(w)}`));
  if (warnings.length > MAX_LISTED_WARNINGS) print(`  … 另有 ${warnings.length - MAX_LISTED_WARNINGS} 条，用 am lint 查看全部`);
}

function reportError(e, fail) {
  if (e instanceof RenderError) {
    fail(`✗ L${e.line} [${e.component}] ${e.message}`);
    if (e.example) fail(`  正确示例：\n${e.example.replace(/^/gm, '    ')}`);
    fail(`  完整语法：am help ${e.component}`);
    return 1;
  }
  if (e instanceof ParseError) {
    fail(`✗ ${e.line ? `L${e.line} ` : ''}稿件解析失败：${e.message}`);
    return 1;
  }
  if (e instanceof LintError) {
    fail(`✗ ${e.message}，未生成页面：`);
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
      if (key === undefined || value === undefined) throw new ConfigError('用法：am config set <键> <值>');
      print(`✓ ${key} = ${showValue(setConfig(key, value, env))}`);
      return 0;
    }
    if (action === 'get') {
      if (!CONFIG_KEYS[key]) throw new ConfigError(`没有配置项 "${key}"。可用：${Object.keys(CONFIG_KEYS).join(' | ')}`);
      print(showValue(readConfig(env).values[key]));
      return 0;
    }
    if (action === 'reset') {
      resetConfig(key, env);
      print(key ? `✓ ${key} 已恢复默认` : '✓ 全部配置已恢复默认');
      return 0;
    }
    if (action !== undefined) throw new ConfigError(`未知操作 "${action}"。用法：am config [set <键> <值> | get <键> | reset [键]]`);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    fail(`✗ ${e.message}`);
    return 2;
  }
  const { values, stored, warning, path } = readConfig(env);
  if (warning) fail(`! ${warning}`);
  print(`配置文件：${path}`);
  for (const [k, spec] of Object.entries(CONFIG_KEYS)) {
    const mark = k in stored ? '*' : ' ';
    const options = spec.type === 'bool' ? 'on | off' : spec.choices.join(' | ');
    print(`${mark} ${k.padEnd(13)}${showValue(values[k]).padEnd(10)}${spec.label}（${options}）`);
  }
  if (env.AM_NO_OPEN && env.AM_NO_OPEN !== '0') print('注意：环境变量 AM_NO_OPEN 生效中，会覆盖 open 配置。');
  print('* 表示你改过的值。修改：am config set <键> <值>；恢复默认：am config reset [键]');
  return 0;
}

function cmdList(print) {
  print('模板 (template):');
  print('  sheet   图纸板：字母编号面板网格，适合一屏总览（默认）');
  print('  doc     线性讲解：单栏阅读，≥3 个面板时带目录');
  print('  video   解释视频：用 am video 渲染，见 am help video');
  print('\n主题 (theme):');
  for (const [name, t] of Object.entries(THEMES)) print(`  ${name.padEnd(10)}${t.label}`);
  print('\n组件（围栏块语言名）:');
  for (const c of COMPONENTS.values()) print(`  ${c.name.padEnd(10)}${c.summary}`);
  print('  html/svg  原样嵌入（逃生口）');
  print('\n语法：am help <组件名>；稿件格式：am help format');
}

function cmdHelp(name, { print, fail }) {
  if (!name) return print(USAGE), 0;
  if (name === 'format') return print(FORMAT), 0;
  if (name === 'video') return print(VIDEO_FORMAT), 0;
  if (name === 'patch') return print(PATCH_HELP), 0;
  if (name === 'html' || name === 'svg') return print(RAW_HELP.replace(/LANG/g, name)), 0;
  const comp = COMPONENTS.get(name);
  if (!comp) {
    fail(`✗ 没有组件 "${name}"。可用：${[...COMPONENTS.keys()].join(', ')}, html, svg, format, video, patch`);
    return 2;
  }
  print(`${comp.name} — ${comp.summary}\n\n${comp.syntax}\n\n示例：\n${comp.example}`);
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
    // 打不开浏览器不影响产物，路径已打印。
  }
}
