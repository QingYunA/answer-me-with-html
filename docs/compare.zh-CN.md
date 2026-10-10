# 和同类工具的对比

[English](compare.md)

把 Agent 的输出变成可视内容的工具不止这一个。最常被拿来比较的有两个：[Archify](https://github.com/tt-a1i/archify)，以及 DeepSeek Harness 上的 GenUI 插件，比如 [dsh-genui](https://github.com/omdsh-dev/dsh-genui)。三者做的是不同的事。

| | Answer me with HTML | Archify | dsh-genui |
| :--- | :--- | :--- | :--- |
| 模型写什么 | 一份 Markdown 稿件 | 一份带类型的 JSON 规格 | `dsh-ui` 围栏里的 JSON |
| 得到什么 | 一页回答整个问题的页面 | 一张可交互的图 | 聊天回复里的组件 |
| 能放什么 | 正文、表格、引用自你文件的真实代码、12 种组件（flow、er、sequence、tree、timeline 等） | 5 种图：架构、工作流、时序、数据流、生命周期 | 30 多种组件：卡片、表格、图表、表单、测验、3D 场景 |
| 在哪能用 | 任何能运行 shell 命令的 Agent：Claude Code、Codex、Cursor、OpenCode、Pi | Claude Code、Codex、opencode、Cursor；Claude.ai 需上传 | DeepSeek Harness 的 Web 界面 |
| 产物 | 单个 `.html` 文件，没有 CDN 和网络字体，离线能打开 | 单个 `.html` 文件 | 显示在聊天里；渲染完成的块可导出为 HTML |
| 交互 | 在页面上评论、做决定；一键汇总成一条消息贴回给 Agent | 聚焦、路径追踪、搜索、演示模式，导出 PNG / SVG / WebM | 按钮、表单、测验把事件发回给模型；模型边写边渲染 |
| 检查 | 稿件出错时返回行号和改法；ASD-STE100 写作检查 | 交付前检查规格、版面和连线 | 规格守卫丢掉不合法的节点 |
| 视频 | `am video`：带旁白的 3Blue1Brown 风格 | 导出带动画的图 | 无 |

## 按要做的事选

- **Archify**：你要一张系统图，用来探索、演示，或导出成图片和视频。它在图上的功能比我们多。
- **dsh-genui**：你在 DeepSeek Harness 的 Web 界面里工作，想在聊天里得到一个能操作的工具，比如表单、测验，点击后会回到模型。
- **Answer me with HTML**：你在终端 Agent 里工作，想把整个回答变成一页，里面有解释、对比、代码和图。这一页可以读、可以留着，也可以发给别人。

## 这个 skill 的不同之处

- **一整页，不只是一张图。** 难的问题除了图，旁边还需要文字和表格。Agent 按回答的结构挑组件。
- **模型只写内容。** 版面、颜色和所有坐标都由 CLI 来算。在我们的[基准测试](../bench/README.md)里，一页稿件约 600 个 token，同一个问题直接手写 HTML 约 4,900 个。我们没有测过 Archify 和 dsh-genui。
- **不依赖宿主。** Agent 运行一条 shell 命令就行，不需要聊天应用来渲染。
- **内容可信。** 代码块引用你的真实文件，写作检查让句子保持简短、直白。

关于 Archify 和 dsh-genui 的信息来自它们的 README，核对于 2026-10-07。如果这里有过时的内容，欢迎[提 issue](https://github.com/QingYunA/answer-me-with-html/issues)。
