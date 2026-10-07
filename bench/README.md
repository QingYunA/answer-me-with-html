# Benchmark: ask for HTML directly vs Answer me with HTML

Same question, same model, one page each. Each cell is the median of 3 runs (Claude Sonnet 5.5). We ran it in two setups, because the cost depends on how much context the setup loads.

Numbers come straight from `claude -p --output-format json`: `modelUsage.outputTokens`, `duration_ms` and `total_cost_usd`.

## What the model writes (fixed)

The corpus is the 9 hand-written HTML pages and the 9 Markdown drafts from the plain-setup run below. It is a [release download](https://github.com/QingYunA/answer-me-with-html/releases/download/v0.4.14/bench-corpus-2026-10-07.zip), kept out of git because plugin installs copy the whole repository. [count-tokens.mjs](count-tokens.mjs) counted their tokens with the model's own tokenizer (Claude Sonnet 5.5, no API key needed) and saved them in [corpus/tokens.json](corpus/tokens.json). To count again, unzip the download into `bench/corpus/` and run `node bench/count-tokens.mjs`. `node bench/corpus.mjs` reports them:

| | Hand-written HTML | Markdown draft |
| :--- | ---: | ---: |
| Tokens on average | 4,893 | **612** (8.0× fewer) |
| SVG diagrams | 47% | written by the CLI |
| CSS | 15% | written by the CLI |
| HTML tags | 17% | written by the CLI |
| Text | 21% | the draft |

The corpus and its counts do not change, so these numbers do not change. Counting twice gave the same count for every file. The runs below also include tool calls and the closing reply, and they vary from run to run and with the Claude Code version.

## Plain setup (2026-10-07)

Claude Code with project settings only, no MCP servers, and the skill from this repo installed in the work folder (`BENCH_LEAN=1`). Each turn reads about 25,000 tokens of context here.

| Topic | Output tokens | Time | Cost per answer |
| :--- | :--- | :--- | :--- |
| TCP handshake & teardown | 5,399 → **1,120** (4.8×) | 32 s → **13 s** (2.4×) | $0.098 → $0.079 |
| Redis vs Memcached | 4,536 → **979** (4.6×) | 29 s → **12 s** (2.5×) | $0.086 → $0.077 |
| git merge vs rebase | 4,861 → **922** (5.3×) | 31 s → **11 s** (2.8×) | $0.090 → $0.076 |
| **Average** | 4,932 → **1,007** (4.9×) | 31 s → **12 s** (2.6×) | $0.091 → **$0.077** (15% less) |

The skill was cheaper in all 9 paired runs ($0.075 to $0.097 against $0.084 to $0.103). Raw rows are in [results/lean/results.json](results/lean/results.json). The generated pages stay out of git; run the script to get them.

An earlier run on 2026-10-05, with a longer `SKILL.md`, measured 5,341 → 870 output tokens and $0.092 → $0.067. Run-to-run and version-to-version changes are this large, so read the ratios as rough sizes.

## Loaded setup (2026-10-07)

Our own Claude Code setup, with many plugins, rules and skills, and the skill installed as a plugin (0.4.13). Each turn reads about 86,000 tokens of context here.

| Topic | Output tokens | Time | Cost per answer |
| :--- | :--- | :--- | :--- |
| TCP handshake & teardown | 8,194 → **1,149** (7.1×) | 52 s → **14 s** (3.6×) | $0.165 → $0.119 |
| Redis vs Memcached | 8,146 → **1,031** (7.9×) | 54 s → **14 s** (3.8×) | $0.194 → $0.147 |
| git merge vs rebase | 6,627 → **1,031** (6.4×) | 45 s → **14 s** (3.1×) | $0.301 → $0.147 |
| **Average** | 7,656 → **1,070** (7.2×) | 50 s → **14 s** (3.5×) | $0.220 → **$0.138** (37% less) |

The skill was cheaper in 8 of 9 paired runs. Raw rows are in [results/results.json](results/results.json).

Cost in this setup depends mostly on the prompt cache. In 7 of the 18 runs (4 plain, 3 skill) the cache missed, and the whole context was written again: those runs cost $0.28 to $0.54. With a warm cache the plain answer cost $0.159 on average and the skill $0.127. An earlier run on 2026-10-02 measured the skill about 20% more expensive in this setup. It did not record cache tokens, so we cannot tell how many of its runs missed the cache.

## What the numbers mean

- **Output tokens and time drop a lot.** The model writes a short Markdown draft. The CLI writes the CSS, the layout and every SVG coordinate.
- **Cost drops less than output tokens.** Output is only part of the bill, see [where the cost goes](#where-the-cost-goes). The speed-up holds in every setup.
- **The pages differ.** Asking for HTML directly gives a longer article with more prose. The skill gives a compact page, usually one or two screens. See [docs/images/plain-vs-skill.png](../docs/images/plain-vs-skill.png).

## Where the cost goes

`total_cost_usd` fits these prices exactly (every row to $0.0001): output $10 per million tokens, cache read $0.20, cache write $4 in the plain setup and $2.50 in the loaded setup (the two setups keep the cache for different times). Split by these prices, the average plain-setup answer costs:

| | Ask for HTML directly | Answer me with HTML | Difference |
| :--- | ---: | ---: | ---: |
| Output | 5,097 tokens · $0.051 (55%) | 1,123 tokens · $0.011 | −$0.040 |
| Cache write | 7,919 tokens · $0.032 | 12,361 tokens · $0.049 | +$0.018 |
| Cache read | 49,627 tokens · $0.010 | 95,456 tokens · $0.019 | +$0.009 |
| Other input | 960 tokens · $0.001 | 954 tokens · $0.001 | 0 |
| **Total** | **$0.093** | **$0.081** | **−14%** |

These are averages of all 9 runs, so they differ a little from the medians above.

- **Output is 55% of the plain answer.** If the skill wrote zero output tokens, it could still save at most 55%.
- **Cache write goes up.** The plain run writes its own HTML back into the cache when the next turn reads it. The skill run writes its instructions (`SKILL.md`, about 4,000 tokens) instead, and that is bigger. In one session the instructions stay in the cache, so later pages should not pay this again. We have not measured this.
- **Cache read goes up.** The skill run has 4 turns instead of 2, and each turn reads the context again. Cache read is cheap, so this adds about a cent here.
- **A shorter `SKILL.md` costs less.** Moving the settings and video instructions into files the agent reads only when needed cut the skill's cost from $0.083 to $0.077 in the plain setup. The pages stayed the same kind: 3 to 6 panels, the same components, no writing warnings.

## Explainer videos

Our own loaded setup, one topic (the TCP handshake), no voice. The plain prompt asks for a self-contained, self-playing 3Blue1Brown-style page with title and diagram scenes, step-by-step captions, play/pause and a progress bar. The skill prompt asks for `am video` with the 3b1b theme and `--voice off`. Claude Sonnet 5.5, 2026-10-05.

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

同一个问题、同一个模型，各出一页。每格是 3 次运行的中位数（Claude Sonnet 5.5，2026-10-07）。上表即结果。

- **模型要写的 token（固定）：** 语料是下面普通环境那次运行的 9 页手写 HTML 和 9 份 Markdown 稿件，可以[下载](https://github.com/QingYunA/answer-me-with-html/releases/download/v0.4.14/bench-corpus-2026-10-07.zip)，不入库。用模型自己的分词器数过 token，结果存在 [corpus/tokens.json](corpus/tokens.json)。`node bench/corpus.mjs` 输出：手写 HTML 平均 4,893 个 token，其中 SVG 占 47%、CSS 15%、标签 17%、正文 21%；稿件平均 612 个 token，少 8.0 倍。语料和计数都不变，这些数字就不变。
- **输出 token 和耗时大幅下降：** 模型只写简短的 Markdown 稿件，CSS、版面和所有 SVG 坐标都由 CLI 生成。
- **普通环境**（`BENCH_LEAN=1`，每轮读约 2.5 万个 token 的上下文）：输出 token 4,932 → 1,007（少 4.9 倍），耗时 31 秒 → 12 秒（快 2.6 倍），花费 $0.091 → $0.077（便宜 15%），9 次配对里 skill 每次都更便宜。
- **加载很重的环境**（我们自己的 Claude Code 配置，每轮读约 8.6 万个 token）：输出 token 7,656 → 1,070（少 7.2 倍），耗时 50 秒 → 14 秒（快 3.5 倍），花费 $0.220 → $0.138（便宜 37%），9 次里 8 次更便宜。这里花费主要看缓存：18 次里有 7 次缓存没命中，整段上下文被重新写入，单次花费 $0.28–0.54。2026-10-02 那次测到 skill 贵约 20%，但那次没有记录缓存数据，无法判断有几次没命中。
- **花费降得比 token 少：** 按 $10/百万（输出）、$4 或 $2.5/百万（缓存写）、$0.2/百万（缓存读）拆开，直接写 HTML 时输出只占花费的 55%，所以即使 skill 一个输出 token 都不写，最多也只能省 55%。skill 多出的花费主要是缓存写：它要载入约 4,000 token 的 `SKILL.md`。把设置和视频的说明拆到按需读取的文件后，普通环境下 skill 的花费从 $0.083 降到 $0.077，页面质量不变。
- **页面风格不同：** 直接要 HTML 得到的是更长、文字更多的长文；用 skill 得到的是一到两屏的紧凑页面。

**解释视频：** 同样的方法，一个题目（TCP 握手），不配音。手写要求是一个自包含、自动播放的 3Blue1Brown 风格页面，含标题与图表场景、逐步字幕、播放/暂停和进度条；skill 一侧用 `am video`，3b1b 主题，`--voice off`。Claude Sonnet 5.5，2026-10-05。

- 输出 token 中位数 27,839 → 1,566（少 17.8 倍），耗时 202 秒 → 17 秒（快 11.8 倍）。
- 手写 3 次、`am video` 2 次。第 3 次手写来自同一脚本的更早一次运行，那次其余的运行遇到限流，只保留了这一行。
- 视频不报花费：同一种方式在不同次之间波动太大。
- 所有页面都在 Chrome 里打开检查过：3 个手写页面会自动播放，有分场景、字幕和进度条。`am video` 的页面还有镜头聚焦和场景间的变形，这是手写提示里没要求的。
- 一个题目、5 次运行，只能看大概量级，不是精确倍数。

复现：普通环境用 `BENCH_LEAN=1 node bench/run.mjs sonnet bench/results/lean 3`（原始数据在 [results/lean/results.json](results/lean/results.json)）；视频用 `BENCH_KIND=video BENCH_TOPICS=tcp node bench/run.mjs sonnet bench/results/video 2`。原始数据在 [results/video/results.json](results/video/results.json)，生成的页面不入库。

复现方法见上方 "Run it yourself"。
