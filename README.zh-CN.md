<p align="center">
  <img src="docs/logo.svg" width="64" height="64" alt="Answer me with HTML logo">
</p>

<h1 align="center">Answer me with HTML</h1>

<p align="center">
  <b>一个 Agent Skill：遇到复杂问题，Agent 不再甩给你一堵文字墙，而是给你一页能看懂的 HTML。<br>模型要写的 token，只有它直接手写 HTML 的约 1/7。</b>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <a href="https://github.com/QingYunA/answer-me-with-html/actions/workflows/ci.yml"><img src="https://github.com/QingYunA/answer-me-with-html/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/works%20with-Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Cursor%20%C2%B7%20OpenCode-black" alt="Works with Claude Code, Codex, Cursor, OpenCode">
</p>

<p align="center">
  <a href="README.md">English</a> · <b>简体中文</b>
</p>

装好之后，像平时一样提问就行：

```
> 讲讲 TCP 三次握手和四次挥手
> 画一下这个仓库的模块关系
> Redis 和 Memcached 该怎么选
```

Agent 会写一份很短的 Markdown 稿件，交给 skill 自带的 CLI。大约 50 毫秒后，你就得到一页：

https://github.com/user-attachments/assets/1f13b1fe-70a9-4c39-8530-b12e553e17ea

<p align="center"><sub>24 秒演示，打开声音可以听到配乐。</sub></p>

## 为什么不直接让 AI 输出 HTML？

当然可以，现在的模型写 HTML 已经写得不错了。问题在于输出 token 的账：每一行 CSS、每一层 `div`、每一个 SVG 坐标，都得模型一个字一个字地打出来。而你在屏幕前等的，也正是这些输出 token。

用这个 skill，模型只写内容。我们用同一个模型、同样的问题，两种方式各做了一遍（3 个题目 × 每题 3 次，取中位数，Claude Sonnet 5.5）：

| | 直接要 HTML | Answer me with HTML | |
| :--- | ---: | ---: | :--- |
| 输出 token | 6,873 | **923** | **少 7.4 倍** |
| 耗时 | 46 秒 | **13 秒** | **快 3.6 倍** |
| 单次花费 | $0.22 | $0.26 | 基本持平 |

<p align="center">
  <img src="docs/images/plain-vs-skill.png" alt="同一个 TCP 问题的两种做法" width="100%">
</p>

<p align="center"><sub>这是基准测试中的一次运行：同样的提示词、同一个模型，两页都能用。这一次直接写 HTML 花了 9,351 个输出 token，用 skill 只花了 899 个。上表是多次运行的中位数。</sub></p>

为什么花费没有跟着降：用 skill 会多两轮很短的对话（加载 skill、运行 CLI），每一轮都要重读一遍上下文。省下的是等待时间，不是账单。每个题目的详细数据和复现脚本见 [bench/](bench/README.md)。

## 安装

需要本机装有 [Node.js](https://nodejs.org/) 20 或更高版本。不需要 `npm install`，CLI 已经打包在 skill 里了。

### 让 Agent 帮你装（推荐）

把下面这段话粘贴给你的 Agent。Claude Code、Codex、Cursor、OpenCode 都可以：

> 帮我安装 Answer me with HTML 这个 skill：运行 `npx -y skills add QingYunA/answer-me-with-html -g -y`，用 `-a` 参数指定你自己这个 Agent（比如 Claude Code 是 `-a claude-code`）。装好后读一遍它的 SKILL.md，然后用它生成一页"TCP 三次握手"的解释页，确认能正常生成。

### Claude Code 插件

在 Claude Code 里执行：

```
/plugin marketplace add QingYunA/answer-me-with-html
/plugin install answer-me-with-html@answer-me-with-html
```

### 一条命令

```bash
npx skills add QingYunA/answer-me-with-html
```

它会问你装到哪个 Agent。安装器来自 [vercel-labs/skills](https://github.com/vercel-labs/skills)，支持 70 多种 Agent。

<details>
<summary>手动安装</summary>

把 `skills/answer-me-with-html` 这个目录放进你的 Agent 的 skill 目录就行。以 Claude Code 为例：

```bash
git clone --depth 1 https://github.com/QingYunA/answer-me-with-html.git /tmp/answer-me-with-html
cp -R /tmp/answer-me-with-html/skills/answer-me-with-html ~/.claude/skills/answer-me-with-html
```

其他 Agent 的 skill 目录：Codex 是 `~/.codex/skills/`，Cursor 是 `~/.cursor/skills/`，OpenCode 是 `~/.config/opencode/skill/`。

</details>

装好后不需要任何配置。

## 你说什么，会得到什么

| 你说 | 你会得到 |
| :--- | :--- |
| "讲讲 TCP 三次握手" | 时序图、状态迁移图、标志位对照表 |
| "这个仓库的模块是怎么组织的" | 目录结构树，加一张模块调用关系图 |
| "Redis 和 Memcached 怎么选" | 多维对比表，用 ✓ ✗ 标出差异，最后给结论 |
| "这段文案哪里写得不好" | 逐句标注，标出问题词和改法 |
| "Kubernetes 是怎么发展起来的" | 时间线，关键节点高亮 |
| "`ls` 怎么看隐藏文件" | 不出页面。一句话能说清的问题照常回答 |

要不要出页面由 Agent 判断：概念之间关系复杂、有多步流程、要做多维对比，才会出页面。你也可以直接说"用 HTML 讲一下……"。

页面保存在 `~/.answer-me-with-html/pages/`。页面右上角可以切换主题、切换亮暗，也可以复制生成这一页的 Markdown 原稿。

## 解释视频（3Blue1Brown 风格）

Karpathy 说的"理解 LLM 输出"阶梯，最后一级是解释视频。直接说"给 TCP 握手做个 3b1b 风格的视频"就行。

<p align="center"><img src="docs/images/video-zh.png" alt="blueprint 风格解释视频中的四帧：片头、高亮 Server 的时序图、流程图、对比表" width="820"></p>

Agent 写的稿件和页面稿一样，只是多了旁白，每行一拍：

````markdown
## 两端都在等待
```sequence
Client -> Server: SYN
Server -> Client: SYN-ACK
```
> 先是客户端开口，发一个 SYN，意思是"我想跟你建个连接"。
> [Server] 听到了，回一个 SYN-ACK："收到，我这边也没问题。"
````

`am video` 把它做成一个播放页：

- **逐步构建**：第 N 句旁白播出时，图上出现第 N 步，箭头会一笔画出来。旁白比步数多时，多出的前几句当开场白。
- **口语旁白**：旁白是要念出来的，Agent 会写成当面讲解的口吻，而不是说明书腔。
- **镜头聚焦**：旁白里写 `[Server]`，镜头推向这个节点并高亮。整张图始终留在画面里，不会被裁掉。
- **跨场景变形**：下一个场景里同名的节点，会从旧位置平滑移到新位置，而不是硬切。
- **配音**：设置了 `ELEVENLABS_API_KEY` 就用 ElevenLabs，否则用系统语音（macOS `say`：中文用婷婷，英文用 Samantha，日文用 Kyoko），都没有就只出字幕。每一拍的时长等于这句音频的长度，所以音画同步。
- **本地配音**：`--voice local` 调用你自己部署的 OpenAI 兼容 `POST /v1/audio/speech` 服务，要求返回 16 位 PCM WAV，比如用 [mlx-audio](https://github.com/Blaizzy/mlx-audio) 运行 Qwen3-TTS。`AM_TTS_URL` 填服务根地址；服务没有默认值时还要设 `AM_TTS_MODEL` 和 `AM_TTS_VOICE`，服务要求密钥时设 `AM_TTS_API_KEY`。`AM_TTS_EXTRA` 是模型专用参数（JSON 对象），并入每个请求；`AM_TTS_MODEL`、`AM_TTS_VOICE` 覆盖其中的同名字段，`input`、`response_format`、`stream` 总由 `am` 决定。某句音频比文字应有的时长短得多或长得多时，重新生成，每句最多 `AM_TTS_ATTEMPTS` 次（默认 3，设为 1 关闭检查）。`am patch` 沿用视频原来的配音方式。例：`AM_TTS_URL=http://127.0.0.1:8000 AM_TTS_MODEL=mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit AM_TTS_VOICE=vivian am video draft.md --voice local`。
- **和页面同一套外观**：默认是 blueprint 图纸风，带刻度外框和字母编号的图纸标题栏。稿件里写 `theme: 3b1b` 换成深色的 3Blue1Brown 风格；也支持 `theme: shadcn` 和 `mode: dark`。
- **单个文件**：音频内嵌在页面里，离线也能播。加 `--mp4` 另存 1080p 视频文件，需要本机有 Chrome、ffmpeg 和 Node.js 22+，导出时间约为视频时长的 1.3 倍。

示例视频（[examples/video-tcp.md](examples/video-tcp.md)）时长约 80 秒，稿件只有 835 个字符，也就是几百个输出 token。不配音时渲染不到 1 秒，用系统语音配音约 3 秒。只有你要视频时 Agent 才会做视频；高频模式仍然只出页面。完整语法：`am help video`。

## 配置

用斜杠命令改配置，不用手动编辑配置文件。

| 在哪里 | 怎么改 |
| :--- | :--- |
| Claude Code（插件安装） | `/answer-me-with-html:config` 会问你要改什么；`/answer-me-with-html:config open off` 直接改 |
| 任意 Agent | `/answer-me-with-html config open off`，或者直接说"别再自动弹浏览器了" |
| 终端 | `am config` 查看，`am config set open off` 修改，`am config reset` 恢复默认 |

| 配置项 | 默认值 | 作用 |
| :--- | :--- | :--- |
| `open` | `on` | 生成后自动用浏览器打开。嫌弹窗打扰就关掉 |
| `always` | `on` | 高频模式开关（见下一节），只在装了高频插件时有用 |
| `theme` | `blueprint` | 默认主题：`blueprint` 或 `shadcn` |
| `mode` | `auto` | 默认明暗：`auto`、`light` 或 `dark` |
| `style` | `80` | 写作检查：`off`、`80`（只提醒）或 `strict`（不达标不生成） |
| `update_check` | `on` | 每周向 GitHub 查一次新版本并提醒你，不会自己更新 |
| `voice` | `auto` | 视频配音：`auto`（有 `ELEVENLABS_API_KEY` 用 ElevenLabs，否则用系统语音）、`elevenlabs`、`local`、`system` 或 `off` |

配置保存在 `~/.answer-me-with-html/config.json`。稿件里写明的主题优先于默认值。`--open` 和 `--no-open` 只影响这一次。

## 高频模式（可选）

默认情况下，只有问题需要时 Agent 才会出页面。如果你希望它**每次给结论都附一页**，可以打开高频模式。

打开后，Agent 每轮都会收到一句很短的提醒（约 90 个 token）。只要这一轮给出了结论、总结、方案或对比，哪怕回答很短，它也会顺手出一页 2～4 个面板的小页面，并在回复最后附上路径。这些页面只生成、不弹出，不会打断你手上的事。闲聊、没有结论的一两句话不受影响。Claude Code 处于 plan 模式时不会出页面。

**Claude Code：** 再装一个插件就行。

```
/plugin marketplace add QingYunA/answer-me-with-html
/plugin install answer-me-with-html-always@answer-me-with-html
```

想暂停，执行 `/answer-me-with-html:config always off`，不用卸载。

**其他 Agent：** 把下面这段话粘贴给你的 Agent，让它写进自己的规则文件（比如 `AGENTS.md`）：

> 帮我打开 Answer me with HTML 的高频模式：在你的全局规则文件里加一条规则——"[answer-me-with-html always-on] 只要回复里给出了结论、总结、方案、对比、评审或讲解，就同时用 answer-me-with-html skill 生成一页 HTML（日常结论用 2～4 个面板），并在回复最后附上页面路径。哪怕回答很短也要出，不要因为答案不长就跳过。渲染时加 --no-open，不要弹出浏览器。闲聊、没有结论的一两句话、纯命令输出、我要求纯文本时除外。"

## 更新与清理

**更新**：需要手动更新，但有新版本时会提醒你。工具每周在后台向 GitHub 查询一次最新版本号，只读这一个数字，不上传任何内容，也不会拖慢你要的页面。有新版本时，下一次出页面会附一行提示，Agent 会问你要不要更新。关掉提醒：`/answer-me-with-html:config update_check off`。

| 安装方式 | 更新方法 |
| :--- | :--- |
| `npx skills add` | `npx skills update answer-me-with-html -y`，或直接对 Agent 说"更新一下 answer-me-with-html" |
| `git clone` + `npm link` | 在仓库目录运行 `git pull && npm install` |
| Claude Code 插件 | 终端运行 `claude plugin update answer-me-with-html@answer-me-with-html`（或在 `/plugin` → Installed 里点 Update now），再 `/reload-plugins`。想自动更新，就在 `/plugin` → Marketplaces 里给这个插件市场打开自动更新。第三方插件市场默认不自动更新 |

**清理**：页面、视频和配音缓存都存在 `~/.answer-me-with-html/`。目录超过 200 MB，或超过 20 MB 且 30 天没清理过，Agent 会问你要不要清理，每周最多问一次。没有你的同意，什么都不会删。

- `/answer-me-with-html:clean`（插件），或者直接说"清理一下页面"：先预演，再问你。
- `am clean`：删除 30 天前的页面和视频，清空配音缓存。`--days N` 改天数，`--all` 删除全部页面和视频，`--dry-run` 只看不删。配置始终保留。如果 `pages`、`videos` 或 `cache` 本身是软链接，会被跳过：`am clean` 不会碰链接指向的文件，用量统计和清理提示也不再计入。如果这些目录无法遍历（比如没有读权限），同样会被跳过：其中的文件不计入用量统计和清理提示，显示的大小可能低于实际占用，清理也不会删除它们。

## 为什么做这个

Karpathy 发过[一条推文](https://x.com/karpathy/status/2105819303471976479)。大意是 LLM 干的活越来越多，人反而越来越难跟上它的输出。比起读一大段文字，看一张图、一页网页要轻松得多。

我试过让 Agent 直接用 HTML 回答问题。效果不错，就是太慢。

一页像样的网页要等一两分钟。大半时间花在输出几百行 CSS 上，而这些 CSS 每次都差不多。画流程图更麻烦：模型得自己算 SVG 坐标，连线经常歪掉，箭头指到空白处。

所以 Answer me with HTML 把这些活从模型手里拿走了。模型只写内容，排版、配色、画图都交给 CLI。

## 原理

模型只需要写这样一份稿件：

````markdown
---
title: TCP 三次握手与四次挥手
---
## A 三次握手 {span=2}
```sequence num
客户端 -> 服务器: SYN, seq=x
服务器 -> 客户端: SYN+ACK, seq=y, ack=x+1
客户端 -> 服务器: ACK, ack=y+1
note 客户端, 服务器: ESTABLISHED
```

## C 状态迁移 {span=2}
```flow LR
(CLOSED) -> LISTEN: 被动打开
LISTEN -> SYN_RCVD: 收 SYN / 发 SYN+ACK
SYN_RCVD -> *ESTABLISHED: 收 ACK
```
````

剩下的都由 CLI 完成：选模板、排面板、套主题，用 [dagre](https://github.com/dagrejs/dagre) 算流程图坐标，按标签宽度拉开时序图间距。完整稿件 [examples/tcp.md](examples/tcp.md) 会生成这一页：

<p align="center">
  <img src="docs/images/tcp.png" alt="TCP 示例页面" width="100%">
</p>

## 特性

- **省 token、少等待:** 模型只写一份约 900 token 的简短稿件，不用输出 7,000 token 的 HTML、CSS 和 SVG。详见[基准测试](bench/README.md)。
- **版面由代码计算:** 面板位置和图形坐标都是算出来的，不靠模型猜。文字不会被截断，网格里也不会留空洞。
- **出错能自己改:** 稿件写错时，CLI 会给出行号、组件名和一段正确示例。Agent 照着改一次就行。
- **两套主题:** blueprint 是图纸风，shadcn 是卡片风。都带亮色和暗色，页面上可以随时切换。
- **单文件、零依赖:** 产物是一个 `.html`，不引用任何 CDN 或外部字体。断网也能打开，发给别人也能看。
- **写作检查:** 按 ASD-STE100 的思路检查稿件里的文字。句子太长、用词太绕、被动语态都会提醒。默认只提醒，不拦着。
- **能找回原稿:** 每页都内嵌了生成它的 Markdown。点"复制源稿"就能拿回来改。

<table>
  <tr>
    <td width="50%"><img src="docs/images/ste100.png" alt="blueprint 图纸风"></td>
    <td width="50%"><img src="docs/images/architecture-dark.png" alt="单栏模板，shadcn 暗色"></td>
  </tr>
  <tr>
    <td align="center"><sub>blueprint 图纸风（<a href="examples/ste100.md">examples/ste100.md</a>）</sub></td>
    <td align="center"><sub>单栏长文模板 + 暗色（<a href="examples/architecture.md">examples/architecture.md</a>）</sub></td>
  </tr>
</table>

## 组件

Agent 会按信息的形状挑组件：

| 组件 | 适合什么 |
| :--- | :--- |
| `flow` | 架构、调用链、决策分支。自动布局，支持分组、判断框、数据库 |
| `sequence` | 几方之间按时间顺序来回发消息 |
| `tree` | 目录、模块、分类体系 |
| `timeline` | 历史、版本、阶段 |
| `limits` | 当前值和上限的对比 |
| `annot` | 逐词点评一句话 |
| `kv` | 元信息、图纸标题栏 |
| `callout` | 结论、提示、警告 |
| 表格 | 多维对比。单元格写 `ok` / `no` / `warn` 会变成 ✓ ✗ ! |

<details>
<summary>稿件格式（想自己写稿件时看）</summary>

````markdown
---
template: sheet        # sheet 是多面板网格（默认），doc 是单栏长文加目录
theme: blueprint       # blueprint 或 shadcn
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
- `span=2` 让面板占两列，`rows=2` 让面板占两行，`bare` 会去掉面板的标题栏。
- 组件覆盖不到的情况，可以用 ```` ```html ```` 或 ```` ```svg ```` 直接嵌入原始代码。

每个组件的完整写法：`am help <组件名>`。

</details>

<details>
<summary>不经过 Agent，直接用命令行</summary>

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

</details>

## STE 受控写作检查

[ASD-STE100](https://www.asd-ste100.org/) 是一套受控英语，最早用来写飞机维修手册。它的规定很具体：句子不能太长，一个词只表达一个意思，操作步骤要用祈使句。Karpathy 提到，让 LLM 按这套规则写，读起来会清楚很多。

Answer me with HTML 把其中容易用机器检查的部分做成了中英双语版，每次渲染时顺带检查：

- **句长:** 操作步骤不超过 20 个英文词或 35 个汉字，描述性句子不超过 25 词或 45 字。每段最多 6 句。
- **用词:** 英文换成常见词，比如 utilize 改成 use、prior to 改成 before。中文删掉虚动词，比如"进行优化"直接写"优化"。
- **句式:** 提示英文被动语态、一句里用了三个以上的"的"，以及"赋能""闭环"这类套话。
- **日文:** 含假名的稿件按日文处理：页面按钮用日文，页面带 `lang="ja"`。只检查句长和段长，字数上限同中文。要强制指定，在稿件里写 `lang: ja`。

用 `/answer-me-with-html:config style strict` 调整严格程度，或者在单篇稿件里写 `style:`。

## 开发

```bash
git clone https://github.com/QingYunA/answer-me-with-html.git && cd answer-me-with-html
npm install
npm test          # 跑测试
AM_E2E=1 npm test # 连同视频端到端测试一起跑（需要系统 TTS、Chrome、ffmpeg）
npm run smoke:install # 用 npx skills 真实安装一次，并校验插件清单（需要联网）
npm run build     # 改了 src/ 之后，重新打包 skills/answer-me-with-html/scripts/am.mjs
npm run snapshot  # 与 origin/main 对比生成的 HTML（重构不能改变它）
```

维护约定（生成的打包文件、页面格式、快照比对、审 PR、发版）见 [CONTRIBUTING.md](CONTRIBUTING.md)。

运行时依赖只有两个：[marked](https://github.com/markedjs/marked) 负责解析 Markdown，[@dagrejs/dagre](https://github.com/dagrejs/dagre) 负责流程图布局。打包时它们会被一起打进 `am.mjs`。

更新演示视频：把 [docs/demo/demo.html](docs/demo/demo.html) 和渲染好的 [examples/tcp.en.md](examples/tcp.en.md)（`tcp.html`）放在一起通过 HTTP 提供，用 1920×1080 打开，等待 `window.ready` 后，依次调用 `window.render(i / 30)` 并截图为 `frame-0000.jpg` … `frame-0719.jpg`，再执行 `node docs/demo/make-demo.mjs <帧目录>` 配乐并编码。生成的 MP4 和 GIF 不入库，因为插件安装会拷贝整个仓库。把 MP4 上传到 GitHub 评论里，再在 README 里引用那个链接。动画由时间唯一决定，背景音乐由 [docs/demo/music.mjs](docs/demo/music.mjs) 按 120 BPM 合成，每个镜头切换都落在节拍上。

## Star 历史

<a href="https://star-history.com/#QingYunA/answer-me-with-html&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=QingYunA/answer-me-with-html&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=QingYunA/answer-me-with-html&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=QingYunA/answer-me-with-html&type=Date" />
  </picture>
</a>

## License

[MIT](LICENSE)
