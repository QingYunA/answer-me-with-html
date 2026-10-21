# Settings, clean-up and updates

Read this when SKILL.md section 0 sends you here.

When the arguments for this call (shown in section 0 of SKILL.md) start with `config` (for example `/answer-me-with-html config open off`), this turn handles settings only and produces no page:

- `config`: run `am config` to show the current settings, then let the user choose. Where the agent has a choice tool such as AskUserQuestion, use it: at most 4 settings at a time, these first: `open`, `theme`, `mode`, `style`, with the current value marked in the options. Otherwise ask in plain text.
- `config <key> <value>`: run `am config set <key> <value>`.
- `config reset [key]`: run `am config reset [key]`.

When the user asks in natural language ("stop opening the browser", "use the card theme by default"), also convert it to `am config set`. Settings: `open` (auto-open the browser), `theme`, `mode`, `style`, `scale` (text size on the page; diagrams and charts grow with it), `voice` (video narration), `update_check` (new-version notices), `close_after_reply` (close the page tab after the reply is copied). Run `am config` to see all descriptions.

`update_check` makes the CLI download `package.json` and `highlights.json` from the repository's `main` branch on GitHub (raw.githubusercontent.com) at most once a day; it sends nothing about the user or their pages and never installs anything. To turn it off, run `am config set update_check false`, or set `AM_NO_UPDATE_CHECK`.

When the user asks for a ready-made theme ("use the comic theme", "install the manga theme"): run `am theme add <name> --use`. Names come from the catalog at https://answer-me-with-html.com/themes/ (at the time of writing: `comic`, `manga`, `pop`); if the name is not there, the command lists the available ones. It downloads, checks and saves the theme and makes it the default, and it asks the user nothing else. If it stops because a file of that name already exists, tell the user it may be their own theme and run it again with `--force` only if they agree. `am theme list` shows the installed themes (`--remote` also shows the catalog), `am theme update` updates them, and `am theme remove <name>` deletes one. The command prints only theme names and versions; it needs Answer me with HTML 0.5.3 or newer.

When the arguments start with `clean`, or the user asks to clean up pages / the cache: first run `am clean --dry-run` and tell the user how many items and how much space will be deleted. Run `am clean` only after the user agrees (add `--all` to delete all pages, videos and saved drafts, `--days N` to change how many days to keep).

When the arguments start with `update`, or the user asks to update this skill: update according to how it was installed. Installed with `npx skills`: run `npx skills update answer-me-with-html -y`. Installed as a Claude Code plugin: run `claude plugin update answer-me-with-html@answer-me-with-html` (or ask the user to click Update now in `/plugin` → Installed), then ask the user to run `/reload-plugins`. Installed with git clone: run `git pull && npm install` in the repository directory. Installed as a DSH plugin: run `dsh plugin --profile <name> up <package>`, with the profile and package names read out of the copy's own path (`~/.dsh/profiles/<name>/node_modules/<package>/…`); when the CLI prints an `! Update hint` or the page shows a new-version button, the exact command is already filled in — use it as printed.
