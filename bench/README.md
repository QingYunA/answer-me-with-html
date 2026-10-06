# Benchmark: ask for HTML directly vs Answer me with HTML

Same question, same model, one page each. Each cell is the median of 3 runs (Claude Sonnet 5.5). We ran it twice, because the cost depends on how much context the setup loads.

## Plain setup (2026-10-05)

Claude Code with project settings only, no MCP servers, and the skill from this repo installed in the work folder (`BENCH_LEAN=1`). A bare "say ok" prompt reads about 22,000 tokens here and costs about $0.09.

| Topic | Output tokens | Time | Cost per answer |
| :--- | :--- | :--- | :--- |
| TCP handshake & teardown | 4,957 → **941** (5.3×) | 31 s → **12 s** (2.7×) | $0.087 → $0.068 |
| Redis vs Memcached | 5,531 → **849** (6.5×) | 35 s → **12 s** (2.8×) | $0.095 → $0.067 |
| git merge vs rebase | 5,534 → **820** (6.7×) | 34 s → **12 s** (2.9×) | $0.095 → $0.067 |
| **Average** | 5,341 → **870** (6.1×) | 33 s → **12 s** (2.8×) | $0.092 → **$0.067** (27% less) |

The skill was cheaper in all 9 paired runs ($0.066 to $0.071 against $0.083 to $0.106). Raw rows are in [results/lean/results.json](results/lean/results.json). The generated pages stay out of git; run the script to get them.

## Loaded setup (2026-10-02)

Our own Claude Code setup, with many plugins, rules and skills. A bare "say ok" prompt reads about 51,000 tokens here and costs about $0.21.

| Topic | Output tokens | Time | Cost per answer |
| :--- | :--- | :--- | :--- |
| TCP handshake & teardown | 8,968 → **972** (9.2×) | 56 s → **11 s** (5.1×) | $0.25 → $0.26 |
| Redis vs Memcached | 6,092 → **935** (6.5×) | 43 s → **16 s** (2.8×) | $0.21 → $0.26 |
| git merge vs rebase | 5,560 → **862** (6.5×) | 40 s → **12 s** (3.3×) | $0.20 → $0.26 |
| **Average** | 6,873 → **923** (7.4×) | 46 s → **13 s** (3.6×) | $0.22 → $0.26 |

The skill was more expensive in all 9 runs. Raw rows are in [results/results.json](results/results.json).

Numbers come straight from `claude -p --output-format json`: `modelUsage.outputTokens`, `duration_ms` and `total_cost_usd`.

## What the numbers mean

- **Output tokens and time drop a lot.** The model writes a short Markdown draft. The CLI writes the CSS, the layout and every SVG coordinate.
- **Cost depends on the context.** The skill adds two short turns: loading the skill and running the CLI. Every turn re-reads the conversation context. With a small context the saved output tokens win (27% cheaper). With a large one the two extra turns cost more than the tokens you save (about 20% more). The speed-up holds in both.
- **The pages differ.** Asking for HTML directly gives a longer article with more prose. The skill gives a compact page, usually one or two screens. See [docs/images/plain-vs-skill.png](../docs/images/plain-vs-skill.png).

## Explainer videos

Same loaded setup as the first run, one topic (the TCP handshake), no voice. The plain prompt asks for a self-contained, self-playing 3Blue1Brown-style page with title and diagram scenes, step-by-step captions, play/pause and a progress bar. The skill prompt asks for `am video` with the 3b1b theme and `--voice off`. Claude Sonnet 5.5, 2026-10-05.

| Run | Plain: tokens / time | `am video`: tokens / time |
| :--- | :--- | :--- |
| 1 | 27,839 / 202 s | 1,564 / 16 s |
| 2 | 27,375 / 199 s | 1,567 / 19 s |
| 3 | 34,402 / 270 s | n/a |
| **Median** | **27,839 / 202 s** | **1,566 / 17 s** |

- Run 3 comes from an earlier run of the same script; the rest of that run hit a rate limit, so only this row is kept. The `am video` side has two runs.
- Output tokens and time: 17.8× fewer and 11.8× faster.
- We do not report cost for videos: it varied too much between runs of the same setup.
- All pages were opened in Chrome. The three hand-written pages autoplay with scenes, captions and a progress bar. The `am video` pages also have camera focus and scene morphs, which the prompt for the plain pages did not ask for.
- Five runs on one topic are a rough size, not a precise ratio.

Reproduce: `BENCH_LEAN=1 node bench/run.mjs sonnet bench/results/lean 3` for the plain setup, and `BENCH_KIND=video BENCH_TOPICS=tcp node bench/run.mjs sonnet bench/results/video 2`. Raw rows are in [results/video/results.json](results/video/results.json). The generated pages stay out of git.

## Run it yourself

You need Claude Code and this skill installed.

```bash
node bench/run.mjs sonnet bench/results 3          # 3 topics × 2 ways × 3 runs, in your own setup
BENCH_LEAN=1 node bench/run.mjs sonnet /tmp/b 3     # a small context: project settings only, no MCP servers
BENCH_TOPICS=tcp node bench/run.mjs sonnet /tmp/b 1  # one topic, one run
```

Your own setup decides how much context every turn re-reads, so it also decides the cost. Each row records `inputTokens`, `cacheWriteTokens` and `cacheReadTokens` next to the output tokens, so you can see where the cost comes from.

Each run happens in a fresh temp folder. The "direct" runs may only use the Write tool; the "skill" runs may use the skill and Bash.

---

# 基准测试：直接要 HTML vs Answer me with HTML

同一个问题、同一个模型，各出一页。每格是 3 次运行的中位数（Claude Sonnet 5.5，2026-10-02）。上表即结果。

- **输出 token 和耗时大幅下降：** 模型只写简短的 Markdown 稿件，CSS、版面和所有 SVG 坐标都由 CLI 生成。
- **花费取决于上下文：** 用 skill 会多两轮很短的对话（加载 skill、运行 CLI），每一轮都要重读一遍上下文。普通环境里（一句只回答 ok 的提示读约 2.2 万个 token，花约 $0.09）省下的输出 token 更划算：每次 $0.092 → $0.067，便宜 27%，9 次里 skill 每次都更便宜。加载很重的环境里（同样的提示读约 5.1 万个 token，花约 $0.21）多出的两轮更贵：$0.22 → $0.26，约贵 20%，9 次里每次都更贵。提速在两种环境里都成立。
- **页面风格不同：** 直接要 HTML 得到的是更长、文字更多的长文；用 skill 得到的是一到两屏的紧凑页面。

**两次测试：** 普通环境（2026-10-05，`BENCH_LEAN=1`）输出 token 5,341 → 870（少 6.1 倍），耗时 33 秒 → 12 秒（快 2.8 倍）；加载很重的环境（2026-10-02）见上表。

**解释视频：** 同样的方法，一个题目（TCP 握手），不配音。手写要求是一个自包含、自动播放的 3Blue1Brown 风格页面，含标题与图表场景、逐步字幕、播放/暂停和进度条；skill 一侧用 `am video`，3b1b 主题，`--voice off`。Claude Sonnet 5.5，2026-10-05。

- 输出 token 中位数 27,839 → 1,566（少 17.8 倍），耗时 202 秒 → 17 秒（快 11.8 倍）。
- 手写 3 次、`am video` 2 次。第 3 次手写来自同一脚本的更早一次运行，那次其余的运行遇到限流，只保留了这一行。
- 视频不报花费：同一种方式在不同次之间波动太大。
- 所有页面都在 Chrome 里打开检查过：3 个手写页面会自动播放，有分场景、字幕和进度条。`am video` 的页面还有镜头聚焦和场景间的变形，这是手写提示里没要求的。
- 一个题目、5 次运行，只能看大概量级，不是精确倍数。

复现：普通环境用 `BENCH_LEAN=1 node bench/run.mjs sonnet bench/results/lean 3`（原始数据在 [results/lean/results.json](results/lean/results.json)）；视频用 `BENCH_KIND=video BENCH_TOPICS=tcp node bench/run.mjs sonnet bench/results/video 2`。原始数据在 [results/video/results.json](results/video/results.json)，生成的页面不入库。

复现方法见上方 "Run it yourself"。
