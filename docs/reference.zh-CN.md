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
- 组件覆盖不到的情况，可以用 ```` ```html ```` 或 ```` ```svg ```` 直接嵌入原始代码。页面带有内容安全策略（Content-Security-Policy），代码块里的脚本和内联事件处理器不会运行，也不会从网络加载任何内容。
- `<host>` 这样的占位符会按文字显示。句子里只保留行内标签（`b`、`kbd`、`sup`、`a`、`span`、`br`、`img` 等），会破坏页面的标签（`script`、`style`、`iframe` 等）也按文字显示。原始标记请放进 `html` 或 `svg` 代码块，代码请放进反引号。渲染时会列出被改动的每个标签。

每个组件的完整写法：`am help <组件名>`。

## 在页面上回复

每个页面都有**回复**按钮。读者可以在任意面板上写评论（面板标题栏里的气泡按钮），然后把一段 Markdown 回复复制给 Agent。刷新页面后，选择和评论都还在。读者作答、评论或标注后，页面底部会出现一条栏，显示各项数量，一键复制回复；回复面板默认显示渲染后的回复，将被复制的 Markdown 折叠在下方。

**标注**按钮打开后，读者可以点击段落、列表项、引用、代码块、表格或 $$ 公式块，选一个类型（建议、保留、疑问、关注），也可以写一句批注。标注显示在该块上，刷新后仍在，并在回复的“标注”一节里带上该块开头的引文返回。页面标题和面板标题不能标注，请用面板评论。

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
- 回复会写明每个决定是读者改过的、确认了建议，还是没有作答。评论和标注的批注原文以 `>` 引用的形式返回。

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
- 远程图片不会加载：页面会拦截所有远程请求，`http(s)` 或 `//` 链接只会显示空白，渲染时也会给出警告。请先把图片存成文件，再写它的本地路径。`data:` URI 可以用。
- 页面会记住每张图片的路径。`am patch` 会重新从文件嵌入图片；文件已经移动时，就用页面里已有的那份。
- 本工具不生成图片。

完整写法：`am help image`。

## 公式

正文里的公式，把 LaTeX 写在美元符号之间：

```markdown
顶点权重：$w(v)=\prod_{u\prec v}N_u^{-1}$。

$$
\widehat g=\sum_{i=1}^{n} w_i\widehat A_i\nabla_\theta\log\pi_\theta(a_i\mid s_i)
$$
```

- `$…$` 是行内公式。独立公式是：单独一行 `$$`，后面几行写 TeX，再单独一行 `$$`；也可以写成一行 `$$ E = mc^2 $$`。独立公式里不能有空行。
- 生成页面时由 [Temml](https://temml.org) 排版，输出 MathML，所以页面不需要脚本，也不需要联网。有公式的页面会带上一个小的数学字体（约 9 KB）和相应样式；没有公式的页面不变。公式沿用正文的颜色，所以每个主题和模式都能用。
- 在从右到左的页面上，公式仍然从左到右排。
- 比面板宽的独立公式会在面板内横向滚动。行内公式在 Chrome 和 Firefox 里会在关系符或运算符（`=`、`+`）之后换行；Safari 不会换行。长公式请写成 `$$` 块。
- 不是公式的美元符号保持原样。开头的 `$` 后面是非空格；结尾的 `$` 前面是非空格、后面不是数字，所以 `$5 and $10` 和 `$5-$10` 保持原样。结尾的 `$` 后面是字母（A-Z、a-z）或 `_` 时也不算结尾，所以 `$PATH:$HOME` 保持原样；请写 `$n$-th`，不要写 `$n$th`。要写美元符号，用 `\$`。行内公式必须在一行内。
- 公式可用于段落、列表、表格、引用、标题、`callout`、`kv`、`ask`、`timeline` 和 `tree` 的文字。行内代码、代码块、图示（`flow`、`er`、`sequence` 等）和 `am video` 不支持公式。表格单元格里请写 `\vert x \vert`，不要写 `|x|`。
- Temml 读不懂的 TeX 不会让渲染失败：页面照常写出，公式以红色等宽的原始 TeX 显示（提示文字里有错误信息），渲染时会打印带稿件行号的警告，例如 `L12 [math] $\foo$ is shown as raw TeX: ...`。有公式警告的页面不会自动打开；改好 TeX 后用 `--replace` 重新渲染。
- `\ref`、`\eqref` 和 `\label` 需要页面里没有的脚本，会给出警告，且不显示内容。`\tag{1}` 可以在 `$$` 块里使用。
- 标注和回复引用公式时，写的是你稿件里的 TeX，连同 `$` 或 `$$`，例如 `Energy $E = mc^2$ holds`。
- 写作检查会跳过 TeX。

命令行里的写法：`am help format`。

## 图表

要比较的数字，写一个 `chart` 块。它按表格画出柱状图、折线图或饼图，不用手写 `svg` 块：

````markdown
```chart bar unit=ms
       | p50 | p95
* Redis     | 12  | 40
Memcached   | 9   | 31
Postgres    | 28  | 95
```
````

- 图表类型跟在 `chart` 后面：`bar` 画竖直柱状图，`bar horizontal` 画水平柱状图，`line` 每个系列画一条折线，`pie` 画环形图。每一行是一个标签，加上每个系列各一个数字，单元格之间用 `|` 隔开。
- 第一行如果各个值都不是数字，它就是系列名，标签单元格可以留空。一行里有多个数字时必须写这一行，读者才知道每种颜色是什么。不写这一行时，每行只有一个数字：一个系列，没有图例。`bar` 和 `line` 系列写 1 到 6 个。`bar` 最多 24 行，`line` 最多 60 个点。
- 数字是朴素的写法：可选的 `+` 或 `-`，数字，可选的小数点。`bar` 和 `line` 的负数画在零线下面。`bar` 的坐标轴永远从 0 开始，不会截断，并停在不小于最大值的第一个整齐刻度上。`line` 的坐标轴用整齐的刻度覆盖数据，可以从 0 以上开始，因为折线表示的是位置，不是长度；最小值不超过最大值的三分之一，或者数值碰到或跨过 0 时，它从 0 开始。
- `unit=` 原样加在坐标轴刻度和数值标签后面：`unit=%` 得到 `40%`，`unit=ms` 得到 `40ms`，`unit=" ms"` 得到 `40 ms`。面板标题就是图表标题，所以没有 `title=`。
- 标签前的 `*` 高亮这一行。`bar` 只有一个系列时它的柱子用强调色，有多个系列时保留各系列的颜色，其他柱子变成灰色。`line` 里这一行的点变大并显示数值，再画一条细的虚线参考竖线标出位置；折线保持原来的颜色，不会变灰。有多个系列时，这一行的数值排成一列放在参考线旁边，各用自己系列的颜色。`pie` 里这一块保持自己的颜色，其他块变成灰色。
- 有多个系列时图表带图例。最多 12 根柱子时，柱子上显示数值。竖直图里的长标签会先倾斜，再缩短。
- `line`：每一行是横轴上的一个位置，第一行在最左边。只有一个系列、最多 12 个点时，每个点都显示数值；点更多时只有高亮的那一行显示。点很多时，横轴标签会隔一个、两个或更多个显示一个，避免重叠。
- `pie`：每行只有一个数字，所以第一行最多给一个系列名。数值要大于等于 0，且至少有一个大于 0。最多写 6 块，每块对应一种系列颜色。各块从 12 点钟方向开始，按写的顺序顺时针排列。环形图旁边的列表给出每块的颜色、标签、数值和百分比。百分比取整；某一块小到取整会显示 0% 时，保留一位小数。总数写在环形图中间。写了 `unit=%` 时，数值本身就是占比：列表只显示标签和数值，表格没有占比列，环形图中间留空。
- 图表下面有一张默认折叠的表格，放着所有数字；`pie` 的表格还有一列占比。读屏软件可以读它，读者也可以从里面复制。它的标题跟随页面语言。
- 从右到左的页面会镜像图表：第一行在右边，水平柱子向左长，饼图逆时针排列、列表在左边。数字仍然从左到右。
- 系列颜色是主题变量（`--series-1` 到 `--series-6`，见[图表变量](#图表变量)）。没有图表的页面不带图表样式。
- 在 `am video` 的场景里，图表像 `limits` 一样逐行出现：`line` 每次加上各系列的一个点，`pie` 每次加上一块。
- 单元格个数不对、值不是数字、饼图里有负数或全是 0、超出上限，都会报错，并带上行号和正确的例子。

完整写法：`am help chart`。

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

页面默认保存在 `~/.answer-me-with-html/pages/`。环境变量 `AM_HOME` 可以改位置。`-o` 指定的是文件，不是文件夹；建议写成 `page.html`。明确指定不带扩展名的文件名仍可使用，CLI 会提示建议加上 `.html`。带 STE 或代码警告的页面不会自动在浏览器里打开（加 `--open` 仍可打开）。改好草稿后再渲染，运行 `am render … --replace <页面>`：新页面写好后会删掉上一版，所以每个回答在 `pages/` 里只留一份。默认文件夹只有你自己的用户能进入（权限 0700），共用主机上的其他用户读不到你的页面；已经存在的 `AM_HOME` 文件夹保持原有权限。

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

从右到左书写的语言（`he`、`ar`、`fa`、`ur`、`yi`）还会得到 `<html dir="rtl">`。页面整体镜像：正文、面板、表格、目录和工具栏都从右侧开始；`flow` 和 `sequence` 图按镜像绘制，第一个节点或参与者在右边，箭头指向左边；时间线、树和限制条也从右侧开始。代码块、diff 和行内代码保持从左到右；不含从右到左字母的文字片段（如路径 `src/`、标签开头的键 `lint:`、域名、带符号的数字）也保持从左到右，标点留在原来写的位置。希伯来文有自己的界面文案、常用稿头键（`author`、`date`、`source`、`version` 等）的希伯来文名称，以及“日.月.年”格式的生成日期；其他从右到左的语言使用英文文案。视频页（`am video`）遵循同一规则：标题块、各场景、字幕、和章节条都从右侧开始，整个控制栏（播放键、时钟、进度条、倍速和导出）则像常见播放器那样保持从左到右。导出的 MP4 和 WebM 带有镜像后的画面。

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
- `font`（可选）写本工具自带的字体名。用这个主题生成的页面会内嵌该字体，不需要联网，其他主题的页面也不会变大。目前只有 `bangers`（[Bangers](https://github.com/googlefonts/bangers)，SIL OFL 1.1）；在 `css` 里使用它的字体族，例如 `& .am-head h1 { font-family: "Bangers", Impact, sans-serif; }`。不认识这个字段的旧版本会忽略它，显示回退字体。视频页面不内嵌这个字体。
- `requires`（可选）写主题支持的最低版本，格式 `x.y.z`。版本更低时，这个主题会被跳过，并提示 `needs Answer me with HTML x.y.z or newer`；不认识这个字段的旧版本会忽略它。
- 文件要自成一体：不要写指向 `http:`、`https:` 或 `//` 的 `url()` 或 `image-set()`，不要 `@import`，不要 `@font-face`，也不要用反斜杠转义（转义可以绕过检查）。外链会在每次打开页面时发出请求，而页面要能离线使用。`am theme check` 会对这些情况给出警告，已有的主题仍然可用；主题库和 `am theme add` 会拒收它们。
- 每个页面都内嵌了内置主题和它自己的主题，所以换一台电脑也能打开。
- `am theme check notes` 会检查亮暗两套配色里缺少的变量、无效的颜色值和过低的对比度，对外部资源给出警告，并生成两页包含全部组件的样张。

`css` 可以选中的类名保持稳定：以后的版本会保留其中每一个，也不会再新增必填的颜色变量。

| 部分 | 类名 |
| :--- | :--- |
| 页面头部 | `.am-head`、`.am-head h1`、`.am-head-meta`、`.am-intro` |
| 面板 | `.am-panel`、`.am-panel--bare`、`.am-panel-head`、`.am-panel-head h2`、`.am-panel-id`、`.am-panel-meta`、`.am-panel-body` |
| 内容 | `.am-md`、`.am-callout`、`.am-callout--ok`、`.am-callout--warn`、`.am-callout--err`、`.am-callout-title`、`.am-kv` |
| 绘图框 | `.am-frame`、`.am-ruler` |
| 评论按钮 | `.am-comment-btn`、`.am-comment-btn--on` |

### 图表变量

主题可以用变量（而不是选择器）改变图表内部的样子：flow、sequence、er，tree 的方框，以及 chart 的柱子、折线和扇区。把它们写进 `tokens`，所有图表都会跟着变。这些变量全部可选：一个都不写的主题，图表和以前完全一样；旧版本会忽略它们。

| 部分 | 变量 | 默认值 |
| :--- | :--- | :--- |
| 节点（flow、er、tree 方框） | `--node-fill`、`--node-stroke`、`--node-width`、`--node-radius`、`--node-shadow`、`--node-text` | `--paper`、`--line`、`--bw`、3px（tree 方框：`--radius`）、无、`--ink` |
| 高亮节点（`*`） | `--hi-fill`、`--hi-stroke`、`--hi-text` | `--accent-bg`、`--accent`、`--accent` |
| 连线与消息 | `--edge-color`、`--edge-width`、`--edge-label` | `--ink-2`、1.3、`--accent` |
| 时序图参与者（含 `== 分隔 ==` 的框） | `--actor-fill`、`--actor-stroke`、`--actor-text` | `--node-fill`、`--node-stroke`、`--node-text` |
| 时序图备注 | `--note-fill`、`--note-stroke`、`--note-width`、`--note-radius` | `--warn-bg`、`--warn`、1、2px |
| 分组框（flow） | `--cluster-fill`、`--cluster-stroke` | `--fill`、`--line-2` |
| 生命线 | `--lifeline-color` | `--ink-3` |
| 图表系列（`chart`） | `--series-1`、`--series-2`、`--series-3`、`--series-4`、`--series-5`、`--series-6` | 亮色：`#4e79a7`、`#f28e2b`、`#e15759`、`#76b7b2`、`#59a14f`、`#b07aa1`；暗色：`#7aa6d6`、`#f5a55a`、`#ef7f80`、`#8fd0cb`、`#7cc472`、`#c99bbd` |

- `--node-width`、`--edge-width`、`--node-radius`、`--note-width`、`--note-radius` 写数字或 `px`、`em` 值（单独的数字按 px 算）。`--node-radius` 也会圆角化参与者，不改变胶囊形和菱形。`--node-shadow` 写 `none` 或一个以上的 `drop-shadow(...)`，例如 `drop-shadow(3px 3px 0 #111111)`，参与者也会带这个阴影。其他写法算错误，主题会被跳过。
- 颜色可以是任何 CSS 颜色。亮色和暗色下，`am theme check` 会读下面这些配对，要求 4.5:1，而且只在主题设置了其中一边时才检查：`--node-fill` 上的 `--node-text`、`--hi-fill` 上的 `--hi-text`、`--actor-fill` 上的 `--actor-text`、`--note-fill` 上的 `--ink`、`--paper` 上的 `--edge-label`。暗色模式里没写的变量沿用亮色的值，所以两边都写。
- 系列颜色按图形读取，不按文字读取。当某个 `--series-N` 与 `--paper` 之间不到 3:1（亮色或暗色），`am theme check` 会给出警告，而且只在主题设置了这个变量时才检查。这是警告而不是错误，因为柱子上有数值，图例和数据表也写明了每个系列。一个都不写的主题用默认配色；其中有几种颜色（橙色和青色）在白色的 `--paper` 上低于 3:1。
- 变量的值和 `css` 一样要过外部资源检查：不要指向 `http:`、`https:` 或 `//` 的 `url()`、`image-set()`，也不要反斜杠。`am theme check` 会警告；主题库和 `am theme add` 会拒收。
- 图表里的字体族、字号、字重和字距没有变量。CLI 按无衬线字体测量图表文字，换字体会让文字溢出方框。
- 圆角需要 Safari 17.4 或更新版本；更旧的 Safari 画默认圆角。

### 主题库

[answer-me-with-html.com/zh/themes/](https://answer-me-with-html.com/zh/themes/) 展示现成的主题，每个都在浏览器里实时渲染亮色和暗色，并附上安装命令：`comic`、`manga` 和 `pop`，它们使用 Bangers 字体。主题库里的主题就是主题文件夹里的一个文件，所以没用到它的页面不会带上它。主题清单在 [/themes/index.json](https://answer-me-with-html.com/themes/index.json)（每个文件的名字、版本、大小和 sha256），文件本身在 [`marketplace/themes/`](../marketplace/themes)。想做一个主题并提交到主题库，让你的 agent 按 [/themes/make.md](https://answer-me-with-html.com/themes/make.md) 的步骤做；其他方式（网站编辑器、issue 表单或 PR）见 [CONTRIBUTING.md](../CONTRIBUTING.md#theme-catalog)。


#### 安装主题：`am theme add`

```bash
am theme add comic --use       # 下载、检查并保存主题，同时设为默认主题
am theme list [--remote]       # 内置主题，以及你的主题（带版本和来源）
am theme update [name]         # 更新来自主题库的主题
am theme remove <name>         # 删除一个主题文件
```

- `am theme add <name>` 读取主题库清单（`https://answer-me-with-html.com/themes/index.json`，或环境变量 `AM_CATALOG_URL` 指向的地址：只接受 https，或指向 `localhost`、`127.0.0.1`、`[::1]` 的 http，因为明文 http 下清单和文件可以被一起替换，sha256 就起不到作用；重定向到不符合这条规则的地址会被拒绝），从同一个地址下载 `themes/<name>.json`，并按清单核对大小和 sha256。随后做主题库 CI 的同一套检查：是有效的主题文件、没有对比度错误、没有外部资源。文件先写入临时文件再改名保存到 `~/.answer-me-with-html/themes/<name>.json`，中途中断不会留下半个文件。只接受主题库里的名字，不接受网址或路径。`requires` 高于当前版本的主题会被拒绝，并说明需要哪个版本。网络请求 8 秒超时。
- `--use` 同时设为默认主题，等同 `am config set theme <name>`，不会再问别的。
- 同名文件如果不是主题库给的那份，永远不会被覆盖，因为它可能是你自己的主题：命令会停下并提示 `--force`。完全相同的文件会提示已经安装。如果文件仍然和主题库给的一模一样，新版本会直接替换，不需要 `--force`。
- 每个主题的来源记在数据目录的 `state.json` 里（`catalogThemes`：名字、已安装文件的版本和 sha256）。主题文件夹里只放主题文件。没有记录的文件算你自己的（`local`）。
- `am theme list` 不联网。安装后被你改过的文件显示为 `catalog, edited`。加 `--remote` 会再读取主题库，标出有更新的主题和你还没有的主题。
- `am theme update` 更新每个来自主题库且安装后没改过的主题；你改过的文件会被跳过并给出提示（`am theme add <name> --force` 可替换）。`am theme update <name>` 只更新一个。
- `am theme remove <name>` 删除文件和它的记录（内置主题不能删）。如果它是默认主题，默认值会回到 `auto`。已经生成的页面外观不变，因为页面自带主题。
- 输出里只有主题名和版本号。主题库里的标签和描述是给网站看的，命令不会打印，所以主题库里的文字进不了 agent 的上下文。
- 0.5.3 之前的版本没有 `am theme add`：按主题库页面上的方式手动保存文件（`curl` 或 PowerShell）。

## 在远程机器上打开页面

如果 Agent 跑在远程机器或无界面的机器上，可以用 `am serve` 让你在自己的浏览器里通过 `http://` 打开它生成的页面。在那台机器的终端里运行，并保持运行：

````bash
am serve              # http://127.0.0.1:8765，Ctrl-C 停止；--port N 改端口（0 表示自动选一个空闲端口）
ssh -L 8765:127.0.0.1:8765 user@host   # 在你自己的电脑上运行，然后在浏览器里打开链接
am serve --lan        # 同时监听局域网（0.0.0.0），只在可信网络里使用
am serve --public-url https://pages.example.com   # 链接使用这个地址，用于已加上 TLS 的反向代理或隧道
````

- 运行期间，`am render`、`am patch` 和 `am video` 写入 `~/.answer-me-with-html/pages/` 或 `videos/` 的页面会多打印一行 `link:`，Agent 会把这个链接交给你，而不是 `file://` 链接。
- 默认服务只监听 `127.0.0.1`，推荐通过 SSH 隧道访问。没有密码，也没有 TLS。
- `--lan` 让服务监听 `0.0.0.0`，也就是全部 IPv4 网卡，而不只是链接里的地址，同一网络里的其他电脑就能打开链接。它会打印所有局域网地址并给出警告，链接使用第一个地址：192.168.x.x 优先，其次 10.x.x.x，再其次 172.16-31.x.x。连接是明文 HTTP，链接里的令牌就是持有者凭证，同一网络里能看到流量或链接的人都能打开页面，所以只在有防火墙保护的可信网络里使用。
- `--public-url https://host` 用于你自己放在 `am serve` 前面、并已加上 TLS 的反向代理或隧道。它决定 `link:` 行开头的地址，以及服务接受的 `Host` 名称；它不会创建 TLS，也不会自己开放任何端口。只能给出 origin，不能带路径。不加 `--lan` 时服务仍只监听 `127.0.0.1`，所以代理必须和它在同一台机器上，并且要保留原始的 `Host` 头。
- 不加这些参数时，服务只响应 `localhost`、`127.0.0.1` 和 `[::1]`，请求其他主机名或 IP 一律返回 404。不要把这个端口暴露到公网。
- 链接按页面区分：每个链接只带这一页的令牌，打不开别的页面；服务重启后所有旧链接失效。服务不列目录，只提供 `.html` 文件。
- 把链接当作这一页的密码：能连到这个端口、又拿到链接的人都能打开页面，包括同一台机器上的其他用户。不要把链接发给别人。
- 给隧道单独用一个本地端口。不要复用曾经打开过其他服务或其他主机页面的端口：那些页面可能在浏览器里为这个地址留下了 service worker，之后在这个端口上打开的页面它都能看到。
- 每个页面在浏览器里各自隔离，一个页面的脚本读不到其他页面。因此通过 `http://` 链接打开时，Reply 里的选择、批注和标注只保留到关闭页面为止，关闭前请先复制回复。
- 页面文件变了（比如 `am patch` 之后，或重新渲染到同一个文件），打开着的页面会自动刷新，并停在原来的滚动位置。如果你已经在页面上做了选择、写了批注或做了标注，页面不会自动刷新，而是显示「页面已更新 · 刷新」，让你先复制回复。这是服务在发送页面时加上的，文件本身不变：用 `file://` 打开的页面不会自动刷新。页面用自己链接里的令牌监听 `/e/<令牌>/<文件>`，这个连接只传「已变化」，不传页面内容。

## 更新与清理

**更新**：需要手动更新，但有新版本时会提醒你。工具每天在后台向 GitHub 查询一次最新版本号和这个版本的亮点，不上传任何内容，也不会拖慢你要的页面。有新版本时，下一次出页面会附一行提示，Agent 会问你要不要更新。过时期间生成的每个页面，工具栏最前面还会多一个「新版本」按钮，点开能看到新版本最多 3 条亮点（跟页面同一种语言）、更新命令和复制按钮。用 `am serve --lan` 或 `--public-url` 分享给别的设备时，`am serve` 会把按钮去掉；页面本身也不联网。关掉提醒：`/answer-me-with-html:config update_check off`。

| 安装方式 | 更新方法 |
| :--- | :--- |
| `npx skills add` | `npx skills update answer-me-with-html -y`，或直接对 Agent 说"更新一下 answer-me-with-html" |
| `git clone` + `npm link` | 在仓库目录运行 `git pull && npm install` |
| DeepSeek Harness 插件 | `dsh plugin --profile <profile> up <package>`；更新提示会自动填好 profile 和包名 |
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
| `update_check` | `on` | 每天向 GitHub 查一次新版本并提醒你，不会自己更新 |
| `close_after_reply` | `off` | 复制回复后 3 秒关闭页面标签页，带倒计时和「保持打开」按钮。见下方说明 |
| `voice` | `auto` | 视频配音：`auto`（有 `ELEVENLABS_API_KEY` 用 ElevenLabs，否则用系统语音）、`elevenlabs`、`local`、`system` 或 `off` |

配置保存在 `~/.answer-me-with-html/config.json`。稿件里写明的主题优先于默认值。`--open` 和 `--no-open` 只影响这一次。

`close_after_reply` 只对开启期间生成的页面生效。`am serve` 提供的页面只在标签页关闭前保留你的作答，所以开启后作答会随标签页一起消失，剪贴板里仍有回复。页面里的链接（比如目录链接）跳转过之后，浏览器会拒绝关闭标签页，这时页面会提示你自己关闭。

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
- **句式:** 提示英文步骤里的被动语态（描述句可以用被动）、一句里用了三个以上的"的"、"赋能""闭环"这类套话，以及"下面我来""希望对你有帮助"这类开场白和结尾。
- **中文词表:** 错别字（登陆→登录）、含糊的量词（尽快、若干、大概、多次）、数字后的"以上 / 以下 / 以内"，以及一词多写（单击→点击、键入→输入、入参→参数）。只收几乎不会误报的词，取自[简明技术中文](https://github.com/mzopedia/simplified-technical-chinese)，一套参照 STE 方法整理的中文受控写作规范。
- **日文:** 含假名的稿件按日文处理：页面按钮用日文，页面带 `lang="ja"`。只检查句长和段长，字数上限同中文。要强制指定，在稿件里写 `lang: ja`。
- **其他语言:** 其他语言只检查长度：句子按词数计（中日文按字数计），段落按句数计。英文和中文的词表、被动语态规则都不会作用在它身上。

用 `/answer-me-with-html:config style strict` 调整严格程度，或者在单篇稿件里写 `style:`。
