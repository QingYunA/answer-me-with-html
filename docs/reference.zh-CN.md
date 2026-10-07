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
- 正文里写在尖括号中的文字会照原样显示：只有文本级标签（`b`、`em`、`code`、`br`、`a`、`span` 等）作为 HTML 保留，其他标签（`<pid>`、`<host>`、`<script>`）都会被转义，按你写的原文显示。页面是一个离线文件，结构和样式由 CLI 负责。

每个组件的完整写法：`am help <组件名>`。

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

页面默认保存在 `~/.answer-me-with-html/pages/`。环境变量 `AM_HOME` 可以改位置。

## 语言

稿件的语言决定页面的 `lang` 属性、按钮和主题名的语言、字体，以及视频播放器的文字。可以在稿头用 `lang:` 指定。不写时，工具按正文的文字系统识别语言。

| `lang:` | `<html lang>` | 文案和字体 |
| :--- | :--- | :--- |
| `zh`、`zh-CN`、`zh-Hans` | 按你写的（单独的 `zh` 写成 `zh-CN`） | 简体中文 |
| `zh-Hant`、`zh-TW`、`zh-HK`、`zh-MO` | 按你写的 | 繁体中文，繁体字体排在前面 |
| `en`、`en-US` 等英文标签 | 按你写的 | 英文 |
| `ja`、`ja-JP` | 按你写的 | 日文，日文字体排在前面 |
| 其他标签，如 `fr`、`ko` | 按你写的 | 英文文案 |

标签按你写的原样输出：`zh-tw` 和 `zh_TW` 都会写成 `zh-TW`。空值、`und` 或无效的值会被忽略，由正文决定。

| 正文的文字 | 识别为 |
| :--- | :--- |
| 汉字 | `zh-CN`（简体）；只在繁体里出现的字比只在简体里出现的字多时，识别为 `zh-Hant` |
| 汉字加假名 | `ja` |
| 谚文 | `ko` |
| 西里尔、阿拉伯、希伯来、泰、希腊文字 | `ru`、`ar`、`he`、`th`、`el`（取该文字最常见的语言） |
| 拉丁字母 | `en` |

写英文以外的拉丁字母语言时，请显式声明语言。中文太短或太平淡、看不出繁体字时（两种写法共用的字什么都说明不了，会按简体处理），也请声明。需要精确语言时同样要声明：阿拉伯文字也用来写波斯语，西里尔文字也用来写乌克兰语。

打补丁（`am patch`）的页面会保留原来的语言，除非稿件里声明了语言。

写作检查按语言走。中文、英文和日文保持原有规则。其他语言只用语言中立的规则：句长（按词数计，中日文按字数计）和段长。

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
