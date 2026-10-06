# Trigger evals

These cases measure one thing: does the agent load the `answer-me-with-html` skill for a prompt, using only the skill's `description`? Each case is one prompt. A `should-*` case passes when the skill is loaded, a `should-not-*` case passes when it is not.

```bash
caffeinate -i claude plugin eval . --ablation none --trust-plugin --no-publish -j 2 --max-cost-usd 10
```

Needs Claude Code 2.1.269 or newer. The full suite (40 cases, 3 runs each) costs about $8 at list price and uses your own credentials. Use `--runs 2` or `--tag <tag>` for a cheaper run. Use `-j 2` on a busy machine, and `caffeinate` so the Mac does not sleep: a run that is starved of CPU times out and scores as a miss, which looks like a regression.

What is measured:

- The skill should fire liberally. A page that is a little too eager costs little, a missed page costs the reader. So `should-trigger` cases are the goal and `should-not-trigger` cases are a floor, not a target. Only the cases tagged `gate` (small talk and an explicit plain-text request) must stay quiet. The other `should-not-*` cases are informational.
- Each run is isolated: only this skill is loaded, with no `CLAUDE.md` and no other skills. A real session has many skills competing, so the absolute rate here is an upper bound. Compare before and after a change to the `description`, not against a target number.
- Prompts are phrased the way a user would type them and never name the skill. They must not point at files the agent cannot see ("our repo"), because the agent then explores instead of answering.
- Cases tagged `holdout` were not used while tuning the description. Keep it that way: check a new description on them, do not tune on them.
- A run stops after 2 turns: loading the skill is the signal, and what the agent does next is not graded. The "reached maximum number of turns" note on those runs is expected.
