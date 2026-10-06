---
description: View or change Answer me with HTML settings — auto-open browser, default theme, light/dark, STE strictness, video voice, update notices
argument-hint: "[open|theme|mode|style|voice|update_check <value>] | reset [key]"
allowed-tools: Bash(node *)
---

## Current settings

!`node "${CLAUDE_PLUGIN_ROOT}/skills/answer-me-with-html/scripts/am.mjs" config`

## What to do

User arguments: `$ARGUMENTS`

CLI: `node "${CLAUDE_PLUGIN_ROOT}/skills/answer-me-with-html/scripts/am.mjs" config …`

- **No arguments**: use AskUserQuestion to let the user choose. Ask at most 4 settings at a time, these first: auto-open the browser (open), default theme (theme), light/dark (mode), writing check (style). Mark the current value in the options. After the user chooses, run `config set` for each setting.
- **`<key> <value>`** (for example `open off`): run `config set <key> <value>` directly.
- **`reset` or `reset <key>`**: run `config reset [key]`.
- **Natural language** (for example "stop opening the browser"): convert it to the matching key and value, then run it.

After the change, say in one or two sentences what changed. Settings take effect immediately. Do not generate an explainer page.
