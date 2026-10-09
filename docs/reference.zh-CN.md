# 参考

[English](reference.md)

## 稿件格式

````markdown
---
template: sheet        # sheet 是多面板网格（默认），doc 是单栏长文加目录
theme: auto            # auto（默认）：长文用 paper，有图表用 blueprint；也可写 blueprint、shadcn、paper 或你自己的主题
title: 页面标题
subtitle: 一句话说明
cols: 3                # sheet 的列数
source: RFC 9293       # 其他任意字段会显示在标题下方
---
导语，写一两句核心结论。

## A 面板标题 {span=2 meta="右上角的小字"}
这里写普通 Markdown，段落、列表、表格都行。

```flow LR
A -> B: 标签
```
````

- 每个 `## ` 开头的标题是一个面板。面板编号 A、B、C 可以不写，会自动补上。
- `span=2` 让面板占两列，`rows=2` 让面板占两行，`bare` 会去掉面板的标题栏。`span` 只是提示：页面会按内容调整每个面板的大小，宽表格和宽图不需要写 `span`。只有想让某个面板更突出时才写 `span`。`rows` 只对普通网格生效（关闭 JavaScript、打印和窄屏时）；浏览器里的对齐排版会忽略它。
- 组件覆盖不到的情况，可以用 ```` ```html ```` 或 ```` ```svg ```` 直接嵌入原始代码。
- `<host>` 这样的占位符会按文字显示。句子里只保留行内标签（`b`、`kbd`、`sup`、`a`、`span`、`br`、`img` 等），会破坏页面的标签（`script`、`style`、`iframe` 等）也按文字显示。原始标记请放进 `html` 或 `svg` 代码块，代码请放进反引号。渲染时会列出被改动的每个标签。

每个组件的完整写法：`am help <组件名>`。

## 在页面上回复

每个页面都有**回复**按钮。读者可以在任意面板上写评论（面板标题栏里的气泡按钮），然后把一段 Markdown 回复复制给 Agent。刷新页面后，选择和评论都还在。

需要读者做决定时，在受影响的面板里写一个 `ask` 块：

````markdown
```ask
用哪个缓存？
* Redis | 重启后数据还在
- Memcached | 更简单，不落盘
```
````

- 第一行是问题。每个选项以 `*`（建议项，默认选中）或 `-` 开头，写 2 到 6 个选项。
- 单选必须有且只有一个 `*`。`ask multi` 允许多选，`*` 标出默认勾选的选项。
- 回复会写明每个决定是读者改过的、确认了建议，还是没有作答。评论原文以 `>` 引用的形式返回。

完整写法：`am help ask`。

## 代码块

项目里已有的代码，直接引用文件，不用手抄：

````markdown
```ts src=server/routes.ts lines=18-30 hl=22
```
````

- 语言名不是组件名的 fence 都是代码块，带标题栏和复制按钮。
- `src=` 读取文件，`lines=18-30` 选出要显示的行，行号与文件一致。代码块里不写内容。路径从当前目录读取，只引用当前目录里的文件。
- `hl=22` 或 `hl=20-22,25` 高亮指定行。手写的代码用 `title="limits.ts · sketch"` 命名，用 `start=38` 让行号从 38 开始。
- 代码块超过 40 行会收到提醒，超过 200 行会报错。按惯例存放密钥的文件（`.env`、`*.pem`、`id_rsa`、`.ssh/`、`.git/` 等），以及任何位置含有疑似密钥或 token 的文件，都会被拒绝。规则与 html-plan 一致。
- 渲染结果会列出嵌入了哪些文件。页面会记住路径；`am patch` 会重新读取文件，文件已经移动时，就用页面里已有的那份。

要展示一处改动，在 `diff` fence 里贴上 unified diff，CLI 负责绘制：

````markdown
```diff file=src/code.js
@@ -60,3 +60,3 @@
 export function parseCodeArgs(args) {
-  const attrs = parseAttrs(args);
+  const attrs = parseAttrs(args, { diff: true });
   const opts = {};
```
````

- 以 `+` 开头的行是新增（绿色），`-` 是删除（红色），空格开头是上下文。`@@ -60,3 +60,3 @@` 开始一个 hunk：显示为一条细分隔行，并决定行号，旧行号和新行号各占一列。没有 `@@` 时，`start=N` 从 N 开始编号；两者都没有，就不显示行号。
- `file=` 写在标题栏里，语言标签取自它的扩展名；没有 `file=` 时，用 `+++ b/path` 那一行的路径。标题栏还会显示统计，例如 `+1 −1`。复制按钮按原样复制 diff。
- `hl=` 用新文件一侧的行号。`diff --git`、`---`、`+++` 和 `\ No newline at end of file` 行可以保留，但不会显示。
- 不以 `+`、`-`、空格或 `@@` 开头的行会报错，`...` 这样的省略行也会报错：请拆成两个 hunk。hunk 的行数与 `@@` 头不符会收到提醒。`diff` 暂不支持 `src=`：请直接贴 diff。限制与其他代码块相同。

完整写法：`am help code`。

## 图片

图表表达不了的内容，比如真实的界面，可以用已经存在的图片文件：

```markdown
![游戏的三种观战视角](/绝对路径/screenshot.png)
```

- 图片单独写一行。alt 文字会成为图注，所以要写这张图显示了什么。写作检查也会读它。
- 请用绝对路径。相对路径从稿件文件所在的目录读取；稿件来自 stdin 时，从当前目录读取。路径里有空格也可以。
- 支持 PNG、JPG、GIF、WebP、AVIF 和 SVG，单个文件不超过 5 MB。图片会嵌入页面，页面仍是一个能离线打开的文件。宽图会缩小到面板的宽度。
- `http(s)` 链接和 `data:` URI 保持原样。链接在打开页面时需要联网。
- 页面会记住每张图片的路径。`am patch` 会重新从文件嵌入图片；文件已经移动时，就用页面里已有的那份。
- 本工具不生成图片。

完整写法：`am help image`。

## 不经过 Agent，直接用命令行

CLI 就是 skill 目录里的 `scripts/am.mjs`：

````bash
AM=skills/answer-me-with-html/scripts/am.mjs

node $AM render examples/tcp.md                  # 渲染并用浏览器打开
node $AM render notes.md -o out.html --no-open   # 指定输出位置，不自动打开
node $AM render notes.md --theme shadcn          # 这一次换主题
node $AM patch page.html --panel "为什么是三次" < panel.md   # 只换一个 ## 面板，覆盖原 HTML
node $AM lint notes.md                           # 只做写作检查
node $AM list                                    # 列出所有组件
node $AM config                                  # 查看配置

# 从 stdin 读取，Agent 就是这样调用的
node $AM render - <<'AM_EOF'
## A 一个面板
```flow
A -> B: 你好
```
AM_EOF
````

页面默认保存在 `~/.answer-me-with-html/pages/`。环境变量 `AM_HOME` 可以改位置。默认文件夹只有你自己的用户能进入（权限 0700），共用主机上的其他用户读不到你的页面；已经存在的 `AM_HOME` 文件夹保持原有权限。

## 语言

稿件的语言决定页面的 `lang` 属性、按钮和主题名的语言、字体，以及视频播放器的文字。可以在稿头用 `lang:` 指定。不写时，工具按正文的文字系统识别语言。

| `lang:` | `<html lang>` | 文案和字体 |
| :--- | :--- | :--- |
| `zh`、`zh-CN`、`zh-Hans` | 按你写的（单独的 `zh` 写成 `zh-CN`） | 简体中文 |
| `zh-Hant`、`zh-TW`、`zh-HK`、`zh-MO` | 按你写的 | 繁体中文，繁体字体排在前面 |
| `en`、`en-US` 等英文标签 | 按你写的 | 英文 |
| `ja`、`ja-JP` | 按你写的 | 日文，日文字体排在前面 |
| `he`、`he-IL` | 按你写的 | 希伯来文，希伯来文字体排在前面；页面从右到左 |
| 其他标签，如 `fr`、`ko` | 按你写的 | 英文文案 |

标签按你写的原样输出：`zh-tw` 和 `zh_TW` 都会写成 `zh-TW`。空值、`und` 或无效的值会被忽略，由正文决定。

从右到左书写的语言（`he`、`ar`、`fa`、`ur`、`yi`）还会得到 `<html dir="rtl">`。页面整体镜像：正文、面板、表格、目录和工具栏都从右侧开始；`flow` 和 `sequence` 图按镜像绘制，第一个节点或参与者在右边，箭头指向左边；时间线、树和限制条也从右侧开始。代码块、diff 和行内代码保持从左到右；不含从右到左字母的文字片段（如路径 `src/`、标签开头的键 `lint:`、域名、带符号的数字）也保持从左到右，标点留在原来写的位置。希伯来文有自己的界面文案、常用稿头键（`author`、`date`、`source`、`version` 等）的希伯来文名称，以及“日.月.年”格式的生成日期；其他从右到左的语言使用英文文案。

| 正文的文字 | 识别为 |
| :--- | :--- |
| 汉字 | `zh-CN`（简体）；只在繁体里出现的字比只在简体里出现的字多时，识别为 `zh-Hant` |
| 汉字加假名 | `ja` |
| 谚文 | `ko` |
| 西里尔、阿拉伯、希伯来、泰、希腊文字 | `ru`、`ar`、`he`、`th`、`el`（取该文字最常见的语言） |
| 拉丁字母 | `en` |

写英文以外的拉丁字母语言时，请显式声明语言。中文太短或太平淡、看不出繁体字时（两种写法共用的字什么都说明不了，会按简体处理），也请声明。需要精确语言时同样要声明：阿拉伯文字也用来写波斯语，西里尔文字也用来写乌克兰语。

打补丁（`am patch`）的页面会保留原来的语言，除非稿件里声明了语言。

图表里的文字按各自文字系统的单位换行：汉字、假名和全角字符一字一单位；用空格分词的文字按词换行；不用空格分词的文字（泰文、老文、高棉文、缅甸文）按词典分词，长句不会把节点撑宽。整行放不下的词会退回到按字形簇（grapheme）拆分，组合符号不会和基字符分开。

写作检查按语言走。中文、英文和日文保持原有规则。其他语言只用语言中立的规则：句长（按词数计，中日文按字数计）和段长。不用空格分词的文字，按分词器找到的词计句长，和图表换行用的是同一份文字列表。

## 自定义主题

在 `~/.answer-me-with-html/themes/` 里放 JSON 文件，一个文件就是一个主题，文件名就是主题名：`themes/notes.json` 对应主题 `notes`。选择方式和内置主题相同：在稿件里写 `theme: notes`，或者用 `--theme notes`、`am config set theme notes`。Agent 写的稿件不变，所以自定义主题不会给每次回答增加成本。

```json
{
  "label": { "zh": "笔记", "en": "Notes", "ja": "ノート" },
  "tokens": {
    "common": { "--font-sans": "\"IBM Plex Sans\", \"Noto Sans CJK SC\"" },
    "light": { "--bg": "#f7f5ef", "--paper": "#fffdf8", "--ink": "#1f1d1a" },
    "dark": { "--bg": "#14130f", "--paper": "#1c1b17", "--ink": "#eeeae0" }
  },
  "css": "& .am-panel-head { letter-spacing: 0.01em; }"
}
```

- 亮色和暗色都要写全所有颜色变量。`am help theme` 会列出这些变量，并给出完整格式。
- 字体只能写本机已安装的字体。系统会自动加上默认字体作为回退，没装这些字体的读者也能正常阅读。
- `css` 里每条选择器都以 `&` 开头。`&` 代表主题的根节点，这样这些规则只在这个主题下生效。
- 每个页面都内嵌了内置主题和它自己的主题，所以换一台电脑也能打开。
- `am theme check notes` 会检查亮暗两套配色里缺少的变量、无效的颜色值和过低的对比度，并生成两页包含全部组件的样张。

## 在远程机器上打开页面

如果 Agent 跑在远程机器或无界面的机器上，可以用 `am serve` 让你在自己的浏览器里通过 `http://` 打开它生成的页面。在那台机器的终端里运行，并保持运行：

````bash
am serve              # http://127.0.0.1:8765，Ctrl-C 停止；--port N 改端口（0 表示自动选一个空闲端口）
ssh -L 8765:127.0.0.1:8765 user@host   # 在你自己的电脑上运行，然后在浏览器里打开链接
````

- 运行期间，`am render`、`am patch` 和 `am video` 写入 `~/.answer-me-with-html/pages/` 或 `videos/` 的页面会多打印一行 `link:`，Agent 会把这个链接交给你，而不是 `file://` 链接。
- 服务只监听 `127.0.0.1`，请通过 SSH 隧道访问；不要把这个端口暴露到公网或共享网络。没有密码，也没有 TLS。
- 链接按页面区分：每个链接只带这一页的令牌，打不开别的页面；服务重启后所有旧链接失效。服务不列目录，只提供 `.html` 文件。
- 把链接当作这一页的密码：能连到这个端口、又拿到链接的人都能打开页面，包括同一台机器上的其他用户。不要把链接发给别人。
- 给隧道单独用一个本地端口。不要复用曾经打开过其他服务或其他主机页面的端口：那些页面可能在浏览器里为这个地址留下了 service worker，之后在这个端口上打开的页面它都能看到。
- 每个页面在浏览器里各自隔离，一个页面的脚本读不到其他页面。因此通过 `http://` 链接打开时，Reply 里的选择和批注只保留到关闭页面为止，关闭前请先复制回复。

## 更新与清理

**更新**：需要手动更新，但有新版本时会提醒你。工具每周在后台向 GitHub 查询一次最新版本号，只读这一个数字，不上传任何内容，也不会拖慢你要的页面。有新版本时，下一次出页面会附一行提示，Agent 会问你要不要更新。关掉提醒：`/answer-me-with-html:config update_check off`。

| 安装方式 | 更新方法 |
| :--- | :--- |
| `npx skills add` | `npx skills update answer-me-with-html -y`，或直接对 Agent 说"更新一下 answer-me-with-html" |
| `git clone` + `npm link` | 在仓库目录运行 `git pull && npm install` |
| Claude Code 插件 | 终端运行 `claude plugin update answer-me-with-html@answer-me-with-html`（或在 `/plugin` → Installed 里点 Update now），再 `/reload-plugins`。想自动更新，就在 `/plugin` → Marketplaces 里给这个插件市场打开自动更新。第三方插件市场默认不自动更新 |

**清理**：页面、视频和配音缓存都存在 `~/.answer-me-with-html/`。目录超过 200 MB，或超过 20 MB 且 30 天没清理过，Agent 会问你要不要清理，每周最多问一次。没有你的同意，什么都不会删。

- `/answer-me-with-html:clean`（插件），或者直接说"清理一下页面"：先预演，再问你。
- `am clean`：删除 30 天前的页面和视频，清空配音缓存。`--days N` 改天数，`--all` 删除全部页面和视频，`--dry-run` 只看不删。配置和主题始终保留。如果 `pages`、`videos` 或 `cache` 本身是软链接，会被跳过：`am clean` 不会碰链接指向的文件，用量统计和清理提示也不再计入。如果这些目录无法遍历（比如没有读权限），同样会被跳过：其中的文件不计入用量统计和清理提示，显示的大小可能低于实际占用，清理也不会删除它们。

**旧的高频模式插件。** 仓库里已经删掉它，但你本机的副本会一直注入提醒，直到你卸载。先执行 `/plugin uninstall answer-me-with-html-always@answer-me-with-html`，再按 [README](../README.zh-CN.md#高频模式推荐) 加上高频模式的规则。

## 配置

| 配置项 | 默认值 | 作用 |
| :--- | :--- | :--- |
| `open` | `on` | 生成后自动用浏览器打开。嫌弹窗打扰就关掉 |
| `theme` | `auto` | 默认主题：`auto`（长文用 paper，有图表用 blueprint）、`blueprint`、`shadcn`、`paper`，或你自己的主题 |
| `mode` | `auto` | 默认明暗：`auto`、`light` 或 `dark` |
| `style` | `80` | 写作检查：`off`、`80`（只提醒）或 `strict`（不达标不生成） |
| `update_check` | `on` | 每周向 GitHub 查一次新版本并提醒你，不会自己更新 |
| `voice` | `auto` | 视频配音：`auto`（有 `ELEVENLABS_API_KEY` 用 ElevenLabs，否则用系统语音）、`elevenlabs`、`local`、`system` 或 `off` |

配置保存在 `~/.answer-me-with-html/config.json`。稿件里写明的主题优先于默认值。`--open` 和 `--no-open` 只影响这一次。

## 少一点主动

默认情况下，只要页面更好懂，agent 就会出页面。嫌太多的话，有两种办法。两种都不要和高频模式同时用。

**只在你用话要求时出。** 把这条规则加到你的规则文件里，例如 `~/.claude/CLAUDE.md` 或 `AGENTS.md`：

> 除非我要求生成页面、图示或可视化讲解，或者说我没看懂，否则不要使用 answer-me-with-html skill。

这条规则在更新后还在。agent 仍然看得到这个 skill，所以靠自己的判断遵守规则。

**只用斜杠命令触发（Claude Code）。** 在已安装的 `SKILL.md` 的 frontmatter 里加一行 `disable-model-invocation: true`，例如 `~/.claude/skills/answer-me-with-html/SKILL.md`。之后 agent 完全看不到这个 skill，只有你输入 `/answer-me-with-html` 才会出页面。更新会替换这个文件，更新后要重新加这一行。见 [Claude Code skills 文档](https://code.claude.com/docs/en/skills)。

## 写作检查

Answer me with HTML 把其中容易用机器检查的部分做成了中英双语版，每次渲染时顺带检查：

- **句长:** 操作步骤不超过 20 个英文词或 35 个汉字，描述性句子不超过 25 词或 45 字。每段最多 6 句。
- **用词:** 英文换成常见词，比如 utilize 改成 use、prior to 改成 before。中文删掉虚动词，比如"进行优化"直接写"优化"。
- **句式:** 提示英文被动语态、一句里用了三个以上的"的"，以及"赋能""闭环"这类套话。
- **中文词表:** 错别字（登陆→登录）、含糊的量词（尽快、若干、大概、多次）、数字后的"以上 / 以下 / 以内"，以及一词多写（单击→点击、键入→输入、入参→参数）。只收几乎不会误报的词，取自[简明技术中文](https://github.com/mzopedia/simplified-technical-chinese)，一套参照 STE 方法整理的中文受控写作规范。
- **日文:** 含假名的稿件按日文处理：页面按钮用日文，页面带 `lang="ja"`。只检查句长和段长，字数上限同中文。要强制指定，在稿件里写 `lang: ja`。
- **其他语言:** 其他语言只检查长度：句子按词数计（中日文按字数计），段落按句数计。英文和中文的词表、被动语态规则都不会作用在它身上。

用 `/answer-me-with-html:config style strict` 调整严格程度，或者在单篇稿件里写 `style:`。
