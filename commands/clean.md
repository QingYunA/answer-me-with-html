---
description: Clean up old Answer me with HTML pages, videos and the narration cache
argument-hint: "[--days <days>] | [--all]"
allowed-tools: Bash(node *)
---

## Current usage (dry run, nothing deleted)

!`node "${CLAUDE_PLUGIN_ROOT}/skills/answer-me-with-html/scripts/am.mjs" clean --dry-run`

## What to do

CLI: `node "${CLAUDE_PLUGIN_ROOT}/skills/answer-me-with-html/scripts/am.mjs" clean …`

User arguments: `$ARGUMENTS` (accept only `--days <non-negative integer>` or `--all`; ignore anything else)

- Above is a dry run with the default (30 days). When the user gave `--days N` or `--all`, first run `clean --dry-run` again with those arguments. Then use AskUserQuestion to ask the user whether to proceed, with these options: proceed as in the dry run (recommended) / clean everything (`--all`) / do not clean up for now.
- After the user agrees, run it once more with the same arguments (or `--all`) and without `--dry-run`.
- By default it deletes pages, drafts and videos older than 30 days and empties the narration cache (the next video synthesizes narration again). The config file is always kept.
- When done, say in one sentence how much space was freed. Do not generate an explainer page.
