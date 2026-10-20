---
description: View or change Answer me with HTML settings — auto-open browser, default theme, light/dark, STE strictness, text size, video voice, update notices
argument-hint: "[open|theme|mode|style|scale|voice|update_check|close_after_reply <value>] | reset [key]"
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
- **Text size** (`scale`): a number from 0.8 to 1.5 in steps of 0.05; 1.2 makes text 20% larger. Diagrams and charts grow with it.
- **Natural language** (for example "stop opening the browser"): convert it to the matching key and value, then run it.

After the change, say in one or two sentences what changed. Settings take effect immediately. Do not generate an explainer page.
