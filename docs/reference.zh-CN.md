# 参考

[English](reference.md)

## 稿件格式

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
- `span=2` 让面板占两列，`rows=2` 让面板占两行，`bare` 会去掉面板的标题栏。`span` 只是提示：页面会按内容调整每个面板的大小，宽表格和宽图不需要写 `span`。只有想让某个面板更突出时才写 `span`。`rows` 只对普通网格生效（关闭 JavaScript、打印和窄屏时）；浏览器里的对齐排版会忽略它。
- 组件覆盖不到的情况，可以用 ```` ```html ```` 或 ```` ```svg ```` 直接嵌入原始代码。

每个组件的完整写法：`am help <组件名>`。

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
