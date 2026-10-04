---
name: answer-me-with-html
argument-hint: "[config [键 值] | clean | update]"
description: >-
  Renders a complex answer as a one-page visual HTML explainer: the model writes a short Markdown
  draft and the bundled CLI builds a single page (templates, SVG auto-layout, STE writing check).
  Also for explainer videos ("3b1b style video", "make a video", "做个视频", "讲成视频"): the same draft
  plus narration lines renders a narrated player page, optionally an MP4. Also for
  `/answer-me-with-html config` or settings (auto-open, always-on mode, default theme). Use
  proactively, without being asked, when the answer involves: 3+ interrelated concepts; a flow /
  protocol / architecture with branches or multiple actors; a comparison or trade-off across 3+
  dimensions; a hierarchy (directories, modules, taxonomies); an evolution or phases; or the user
  says "explain how it works / I don’t get it / draw a diagram / explain this codebase / explain
  visually / 讲讲原理 / 没看懂 / 画个图 / 用 HTML 讲". Do not use for: short Q&A (clear in under ~150 words),
  commands to copy and run, pure code changes, or plain-text requests.
---

# Answer me with HTML：用一页 HTML 回答复杂问题

你只写**内容稿**（扩展 Markdown）。排版、配色、暗黑模式、图形坐标全部由 `am` CLI 完成。**不要手写 HTML / CSS / SVG。**

## 0. 用户要改配置时

本次调用参数：`$ARGUMENTS`

参数以 `config` 开头时（如 `/answer-me-with-html config open off`），这一轮只处理配置，不出页面：

- `config`：运行 `am config` 显示当前配置，然后问用户想改哪一项。
- `config <键> <值>`：运行 `am config set <键> <值>`。
- `config reset [键]`：运行 `am config reset [键]`。

用户用自然语言提出时（"别再自动弹浏览器了""关掉高频模式""默认用卡片主题"），同样换算成 `am config set`。可配置项：`open`（自动打开浏览器）、`always`（高频模式）、`theme`、`mode`、`style`、`voice`（视频配音）、`update_check`（新版本提示），运行 `am config` 可看全部说明。

参数以 `clean` 开头，或用户说"清理一下页面 / 缓存"时：先运行 `am clean --dry-run`，把将删除的数量和大小告诉用户，用户同意后再运行 `am clean`（加 `--all` 删除全部页面和视频，`--days N` 改保留天数）。

参数以 `update` 开头，或用户说"更新一下这个 skill"时：按安装方式更新——`npx skills` 安装的运行 `npx skills update answer-me-with-html -y`；Claude Code 插件安装的运行 `claude plugin update answer-me-with-html@answer-me-with-html`（或请用户在 `/plugin` → Installed 点 Update now），再请用户 `/reload-plugins`；git clone 安装的在仓库目录 `git pull && npm install`。

## 1. 判断：要不要出页面

满足任一条就出页面：
- 有 ≥3 个相互关联的概念，读者需要看到它们的关系。
- 有流程、协议、调用链、状态迁移（尤其带分支或多个参与者）。
- 有 ≥3 个维度的对比、方案取舍、"能 / 不能"清单。
- 有层级结构或时间演进。

不满足就用普通文字回答。拿不准时，问题越"要看图才懂"，越该出页面。

### 高频模式

如果上下文里出现 `[answer-me-with-html always-on]` 提醒（用户装了 answer-me-with-html-always 插件，或在规则文件里开启了高频模式），门槛放低：

- 只要这一轮给出了结论、总结、方案、对比、评审或讲解，就附一页。
- 不要因为"答案不长"就跳过。有结论就出页。
- 日常结论用 2～4 个面板的小页面：一个 callout 放结论，再配一张表或一张图。不要为了凑数加面板。
- 渲染时加 `--no-open`，不要弹浏览器打断用户。用户点回复末尾的路径就能打开。
- 终端里照常先给文字结论，最后一行附页面路径。
- 闲聊、没有结论的一两句话、纯命令输出、用户要求纯文本时不出页面。

## 2. 工作流（一次 Bash 调用）

CLI 已经打包在本 skill 目录里：`scripts/am.mjs`，单文件、无需安装依赖，只要有 Node.js 20+。下文的 `am` 都指：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/am.mjs"
```

在 Claude Code 里，上面的路径会自动替换成本 skill 的目录。如果你看到的是没有替换的变量（其他 Agent），请换成这个 SKILL.md 所在目录的绝对路径。用户全局安装了 `am` 命令时，也可以直接用 `am`。

1. 先在心里列出 3～8 个面板。每个面板只回答一个子问题。
   稿件语言跟随用户提问的语言：英文提问写英文稿，中文提问写中文稿，日文提问写日文稿。页面按钮文字、`<html lang>` 和 STE 检查规则会根据稿件语言自动切换（含假名的稿件判为日文）；STE 按每句的语言分别套用中英文规则（日文句子只查句长与段长，字数上限同中文）。要强制界面语言，在 frontmatter 写 `lang: en`、`lang: zh` 或 `lang: ja`。
2. 按信息形状选组件（见第 4 节）。
3. 用 heredoc 一次性渲染：

````bash
node "${CLAUDE_SKILL_DIR}/scripts/am.mjs" render - <<'AM_EOF'
---
title: 标题
---
## A 面板标题
```flow
A -> B: 标签
```
AM_EOF
````

4. 读输出：
   - `✓ <路径>`：成功。是否自动打开浏览器由用户配置决定（`am config`）；加 `--no-open` 只影响这一次。
   - `✗ L<行号> [组件] …` + 正确示例：照示例改那一行，再渲染一次。
   - `STE n 条警告`：按建议改写对应行，再渲染一次。最多重试 2 轮，仍有警告就保留页面并说明。
   - `! 清理提示：…` 或 `! 更新提示：…`：在回复末尾用一句话转告用户，问要不要清理 / 更新。**不要自己执行 am clean 或更新命令**，等用户同意。CLI 会节流：清理提示每 7 天最多一次，更新提示每 3 天最多一次。
5. 在终端只回 2～3 行：一句核心结论 + 页面路径。不要把稿件或 HTML 贴回终端。

已经有页面、只需改其中一个面板时，不要整页重写。从该 HTML 的 `#am-source` 取回源稿，只替换对应的 `##` 小节，再原地覆盖：

````bash
node "${CLAUDE_SKILL_DIR}/scripts/am.mjs" patch page.html --panel "面板标题" <<'AM_EOF'
## A 面板标题
新的内容
AM_EOF
````

`--panel` 匹配标题、字母 ID 或 `ID 标题`。找不到该面板或页面没有 `#am-source` 时不要改文件。patch 沿用原页面的主题、明暗和 STE style；要换就加 `--theme` / `--mode` / `--style`。完整用法：`am help patch`。

## 3. 稿件格式速查

```markdown
---
template: sheet     # sheet 图纸板（默认，一屏总览）| doc 线性讲解（逐步阅读）
theme: blueprint    # blueprint 图纸风（默认）| shadcn 卡片风
title: 标题
subtitle: 一句话说明     # 可选
cols: 3             # sheet 列数，默认 3；面板用 span / rows 跨列跨行
source: RFC 9293    # 其他任意键显示在页头元信息行
---
导语：一两句核心结论（可选）。

## A 面板标题 {span=2 meta="右上角小字"}
普通 Markdown：段落、列表、表格、引用。
表格状态词：ok / no / warn（可带文字："ok 已批准"）→ ✓ / ✗ / ! 徽章。

## B {bare}            ← bare：无标题栏（适合放 kv 标题栏块）
```

- 面板字母 ID 可省略，自动分配。
- ```html / ```svg 围栏块原样嵌入，**只在组件确实表达不了时使用**。
- 完整说明：`am help format`；组件语法：`am help <组件名>`；组件列表：`am list`。

## 4. 按信息形状选组件

| 信息形状 | 组件 | 最小写法 |
|---|---|---|
| 谁连向谁、架构、决策分支 | `flow [LR]` | `A -> B: 标签`，`A --> C` 虚线，`A -> B & C` 扇出，`{判断?}` `(开始)` `[(数据库)]`，`*重点`，`group 名: A, B` |
| 参与者之间按时间的消息 | `sequence [num]` | `A -> B: 请求`，`B --> A: 响应`，`note A, B: 说明`，`== 阶段 ==` |
| 层级 / 目录 / 分类 | `tree [list]` | 缩进表达层级，`标签 \| 说明`，`` `编号` 标签 `` |
| 历史 / 阶段 | `timeline [v]` | `时间 \| 标题 \| 说明`，`*` 高亮 |
| 数值与上限 | `limits` | `标签 \| 13 / 20 \| 单位`，只写上限：`标签 \| max 20` |
| 逐词点评一句话 | `annot` | `# 小标题 \| 右注`，`[片段]{注释}`，`[错词]{!红色注释}`，`> 底注` |
| 元信息 / 标题栏 | `kv [cols=2]` | `键: 值`，`* 宽格: 值` |
| 结论 / 警告 | `callout <info\|ok\|warn\|err> 标题` | 正文 Markdown |
| 多维对比、能 / 不能清单 | Markdown 表格 | 状态列写 ok / no / warn |

选型原则：
- 先放结论。第一个面板或导语给出核心答案，后面的面板给证据。
- 一个面板一个问题。超过 8 个面板就拆页或删减。
- 用 `span` 给信息最密的面板更多宽度；等宽句子（annot）至少给 span=2。
- 不编数据。没有真实数字就不用 limits；示意数据要在说明里写明"示意"。

## 5. STE 受控写作（稿件里的文字）

`am render` 会自动检查，默认只警告（`style: 80`）；`style: strict` 不达标不生成；`style: off` 关闭。

- 一句话只说一件事。
- 用主动语态。步骤用祈使句（"关闭阀门"，不写"阀门应被关闭"）。
- 一词一义。同一个东西全文用同一个叫法。
- 句长上限：步骤（有序列表）英文 20 词 / 中文 35 字；描述英文 25 词 / 中文 45 字。
- 每段不超过 6 句。复杂内容用列表。
- 英文用常见短词：use 不用 utilize，start 不用 commence，before 不用 prior to。
- 中文不用虚动词（"进行优化"→"优化"，"加以说明"→"说明"），不连用三个以上"的"，不用套话（赋能、闭环、至关重要……）。
- 故意展示的反例用 `~~删除线~~`，或放进状态为 `no` 的表格行，检查会跳过它们。

## 6. 解释视频（am video，3Blue1Brown 风格）

只在用户明确要视频时使用（"做个视频""讲成视频""3b1b 风格""explainer video"）。高频模式下也不要主动出视频。

视频稿和页面稿格式相同，只多一条规则：以 `>` 开头的行是旁白，每行一拍。

````bash
node "${CLAUDE_SKILL_DIR}/scripts/am.mjs" video - --no-open <<'AM_EOF'
---
title: TCP 三次握手
subtitle: 为什么是三次
---
> 片头旁白（可选）。

## 两端都在等待
```sequence
Client -> Server: SYN
Server -> Client: SYN-ACK
Client -> Server: ACK
```
> 客户端先发 SYN，请求建立连接。
> [Server] 收到后回 SYN-ACK。
> 客户端再回 ACK，连接建立。
AM_EOF
````

- 一个 `## ` 是一个场景。场景里放一个组件（或一张表、一个列表）作为画面，下面写 2～5 行旁白。
- 第 N 句旁白播出时，画面出现第 N 步。flow / sequence / tree 每行源码是一步；timeline、limits、表格行、列表项按条目分步。所以组件的行顺序就是讲解顺序。旁白比步数多时，多出的前几句当开场白，不出新内容。
- 旁白里写 `[名字]`：镜头推近同名的节点或参与者并高亮。名字要和组件里的写法一致。
- 相邻场景里同名的节点会平滑移动到新位置。想让观众跟住一个对象，就在下一场景沿用同一个名字。
- 一个视频 3～6 个场景，每行旁白一两句话。
- 旁白是要念出来的，写成口语，像当面讲给人听：可以用"你看""那问题来了""我们换个角度看"这类过渡，引号里放人物的"台词"。不要写成说明书腔（"客户端发送 SYN 报文以请求建立连接"）。句长仍受 STE 检查约束。
- 外观默认跟随配置里的 theme（通常是 blueprint 图纸风）。用户要"3b1b 那种深色风格"时在 frontmatter 写 `theme: 3b1b`。
- 配音：默认 `--voice auto`，有 `ELEVENLABS_API_KEY` 用 ElevenLabs，否则用系统 TTS（macOS say），都没有就只出字幕。用户说"不要声音"时加 `--voice off`。用户在本地部署了 OpenAI 兼容的语音服务并设置了 `AM_TTS_URL` 时，用 `--voice local`。
- 产物是 `~/.answer-me-with-html/videos/` 下的单文件播放页（音频内嵌）。用户要视频文件时加 `--mp4`，需要本机有 Chrome、ffmpeg 和 Node.js 22+，导出时间约为视频时长的 1.3 倍。
- 完整语法：`am help video`。终端里回一句话加播放页路径（和 MP4 路径）。
