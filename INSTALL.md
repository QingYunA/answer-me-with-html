# Answer me with HTML: install guide for AI agents

> This file is written for the AI agent that installs the project. A person can follow it too.

I want you to install Answer me with HTML for me. Execute all the steps below autonomously. Do not ask me anything, except once in Step 1 if Node.js is missing or older than 20. Decide each point yourself with the defaults here, and tell me what you did in one report at the end.

OBJECTIVE: the skill is installed for the agent you are running in, and `am` can render a page.

DONE WHEN: `node <skill dir>/scripts/am.mjs --version` prints a version number, or in Claude Code `claude plugin list` shows `answer-me-with-html` as enabled.

## Rules

- Do not ask me questions. The only exception is Step 1: if Node.js is missing or too old, ask me once whether to install it, because nothing else can work without it.
- Run only the commands in this file. Do not clone the repository or build anything. The CLI is already bundled in the skill.
- Install **one** way per agent. A skill and a plugin with the same name load twice and their instructions conflict.
- Never remove or overwrite an existing install. If one exists, keep it (Step 2).
- Do not add the always-on rule to any rules file yourself. Recommend it in the report and ask (Step 5).
- Put the commands of one step in a single shell call, so I approve as few prompts as possible.

## TODO

- [ ] Check Node.js 20 or newer (offer to install it if missing or older)
- [ ] Check whether it is already installed
- [ ] Install: plugin for Claude Code, skill for every other agent
- [ ] Check that it works
- [ ] Send the final report

## Step 1: Check Node.js

```bash
node --version
```

You need v20 or newer. If it is, go to Step 2.

If it is older or missing, show me the exact command for my system below and ask me once whether to run it. For nvm, also tell me that it adds lines to my shell profile.

| System | Command |
| :--- | :--- |
| macOS with Homebrew | `brew install node` |
| Windows | `winget install OpenJS.NodeJS.LTS` |
| Linux, or macOS without Homebrew | `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh \| bash`, then `. ~/.nvm/nvm.sh && nvm install --lts` |

- I agree: run the command, then run `node --version` again. If the shell does not find the new `node`, run `. ~/.nvm/nvm.sh` first, here and before `node` in later steps (nvm), or use `"C:\Program Files\nodejs\node.exe"` (Windows). If it still fails, stop and tell me what happened.
- I say no: stop here and tell me in one sentence, with the link https://nodejs.org/.

## Step 2: Check for an existing install

```bash
ls -d ~/.agents/skills/answer-me-with-html ~/.claude/skills/answer-me-with-html 2>/dev/null; claude plugin list 2>/dev/null | grep answer-me-with-html
```

Decide without asking:

- Nothing found: go to Step 3.
- Found, and it is the way Step 3 would install for you: update it, then go to Step 4. Use `npx -y skills update answer-me-with-html -y` for a skill, or `claude plugin update answer-me-with-html@answer-me-with-html` for the plugin.
- Found, but a different way (for example a skill, while you are in Claude Code): keep it, skip Step 3, and go to Step 4. In the report, say which way is installed and what the other way would add.

## Step 3: Install

### Claude Code

The plugin carries the skill and also the `/answer-me-with-html:config` and `/answer-me-with-html:clean` commands.

```bash
claude plugin marketplace add QingYunA/answer-me-with-html
claude plugin install answer-me-with-html@answer-me-with-html
```

The plugin loads in the next session, or after I run `/reload-plugins`. Say so in the report.

### Any other agent (Codex, Cursor, OpenCode and more)

```bash
npx -y skills add QingYunA/answer-me-with-html -g -y -a <your agent name>
```

You know which agent you are. Use the name that `npx -y skills add --help` documents for it. For Claude Code it is `claude-code`. If the installer does not know your name, do not guess and do not ask me: stop this step and put the error in the report, with the "Manual install" link from the README.

There is no npm package: `npm install answer-me-with-html` does not work. The command above is the only way to install the skill.

With `-a '*'` (all agents), the installer ends with lines such as `Failed to install 2 - Eve: Eve does not support global skill installation`. That is expected: those agents were skipped, and the skill is still installed. Step 4 decides whether the install works.

This installs the skill only. It works the same way, but there are no slash commands. Settings are changed with `/answer-me-with-html config` (note the space), or `am config` in a terminal. Codex and Cursor have their own plugin systems, but this repository does not ship a plugin for them yet. Do not try to install one.

### DeepSeek Harness (DSH)

If you are running in DeepSeek Harness, install it as a DSH plugin. Use the profile you run in (`web` is the shipped one):

```bash
dsh plugin --profile <profile> add github:QingYunA/answer-me-with-html
```

`dsh plugin add` needs `pnpm` on your `PATH`. The package declares a `dsh.bundle` patch (`cordis.patch.yml`), which mounts its `skills/` directory as a skill provider named `answer-me-with-html`. Nothing is copied into `~/.dsh/skills`. The skill is available in the next DSH session of that profile. If the output says "declares no dsh.bundle", the install did not register the skill: report it.

A copy of the skill in `~/.agents/skills/answer-me-with-html` or `~/.dsh/skills/answer-me-with-html` takes precedence over the plugin, so DSH would keep using that copy. If one exists from an earlier install, ask the user before you move it away.

DSH's default sandbox lets commands write only in the workspace and `/tmp`. When the skill saves a page to `~/.answer-me-with-html/pages`, DSH asks the user to approve the write.

## Step 4: Check that it works

For a skill install:

```bash
dir=$(ls -d ~/.agents/skills/answer-me-with-html ~/.claude/skills/answer-me-with-html 2>/dev/null | head -1)
node "$dir/scripts/am.mjs" --version
```

Claude Code keeps the skill in `~/.claude/skills`; most other agents read `~/.agents/skills`. The first line finds whichever exists. Then use the skill to make a page that explains the TCP three-way handshake, with `--no-open` so no browser window pops up.

For a plugin install, the skill loads after the reload. Run `claude plugin list` and check that it is enabled. Do not wait for the reload.

For a DSH install, check that `dsh plugin add` printed no "declares no dsh.bundle" warning. The skill appears in the next session of that profile.

If a check fails, see Troubleshooting, try the fix once, and report what happened.

## Step 5: The final report

Send one message. Keep it to these lines:

1. What you installed, and the way (plugin or skill).
2. The result of the check, and the path of the TCP page if you made one.
3. What I still need to do, if anything (for example `/reload-plugins`). Say "nothing" if there is nothing.
4. How to change settings: `/answer-me-with-html:config` for the plugin, or `/answer-me-with-html config` for the skill.
5. One line: we recommend always-on mode, which adds a small page to every answer with a conclusion. Ask whether I want it, and do not add it yourself. The rule is in "Always-on mode" in [README.md](README.md).

## Troubleshooting

| Problem | Cause and fix |
| :--- | :--- |
| `Unknown command: /answer-me-with-html:config` | The plugin is not installed. Use `/answer-me-with-html config`. |
| The skill is not found after install | Start a new session. In Claude Code, run `/reload-plugins`. |
| The same instructions appear twice | The skill and the plugin are both installed. Report it; do not remove either. |
| `node: command not found`, or Node older than 20 | Go back to Step 1 and offer to install it. |
| `npx` cannot reach the network | Report it, with the "Manual install" link from the README. |
| `Failed to install N - <agent>: <agent> does not support global skill installation` | Not a failure. With `-a '*'` the installer skips agents that have no global skills. If Step 4 prints a version, the install works. |
| `npm install answer-me-with-html` returns 404 | There is no npm package. Install with `npx -y skills add` (Step 3). |

EXECUTE NOW: complete the TODO list above to achieve: `am --version` prints a version number and the agent can see the skill. Do not ask me anything except the Node.js question in Step 1; send the final report.
