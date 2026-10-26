# Contributing

Setup and test commands are in the README's [Development](README.md#development) section.

## Ground rules

- **`skills/answer-me-with-html/scripts/am.mjs` is generated.** Edit `src/`, then run `npm run build` and commit both. CI fails when the bundle is stale. `.gitattributes` makes git stop at a conflict in `am.mjs` instead of merging it line by line: take either side and rebuild; never merge it by hand.
- **The page format lives in `src/page.js`.** It writes the root `<html>` settings, the narration `<audio>` and the trailing `#am-source`, and `readPage()` reads them back for `am patch`. A new page setting goes in both places. Other modules read a page through `readPage()`, and server-side code escapes HTML with `esc` from `src/svg/text.js`; `test/page-format.test.js` fails on a page regex or an `&amp;` escape chain outside those files (`src/runtime/` scripts run in the page and are exempt).
- **A theme is one file in `src/themes/`** (`blueprint.js` shows the format), listed in `src/themes/registry.js`. Everything else reads themes from the registry, and `base.css` / `video.css` never name a theme.
- **Theme compatibility.** A theme file is written once and must keep working. (1) The required color tokens (`COLOR_TOKENS` in `src/themes/check.js`) never grow: a new token always has a default, so a file that does not set it still renders. (2) The classes in `THEME_SELECTORS` (`src/themes/selectors.js`, documented in `docs/reference.md`) are not removed or renamed in `base.css`; add to the list when a theme needs a new hook. The diagram tokens (`--node-*`, `--hi-*`, `--edge-*`, `--actor-*`, `--note-*`, `--cluster-*`, `--lifeline-color`, `--series-1` to `--series-6`, listed in `DIAGRAM_TOKENS` in `src/themes/check.js`) are optional and each defaults to the look diagrams had before it existed, so a theme that sets none renders the same; a new diagram part gets a token with a default, and a theme never writes diagram selectors. Diagram text has no font tokens, because it is measured for the sans font. A new optional theme field is ignored by an older version, so `normalizeTheme` never rejects a field only because it is unknown. `test/theme-files.test.js` pins both lists.
- **A catalog theme is one file in `marketplace/themes/`**, not in `src/`. See [Theme catalog](#theme-catalog).
- **A language is one file in `src/languages/`**, listed in `src/languages/registry.js`. `src/language.js` is the only place that decides the language of a draft; the page and the video read its result and never decide themselves. A language without a file still renders: `<html lang>` is the tag the draft declares and the labels are English. To add a language, copy `src/languages/en.js`, translate the labels, list the file in the registry and add the language to the `label` of each built-in theme; `test/languages-registry.test.js` names what is missing. A language that needs its own fonts adds `langs` and `fonts` (see `src/languages/zh-Hant.js`). Direction comes from the language tag, not the file: a right-to-left page gets `dir="rtl"` and `src/themes/rtl.css`; `base.css` uses logical properties (`inset-inline-start`, `margin-inline-end`, `text-align: start`) so it serves both directions, and diagrams take the page direction from the component context (`dir`). `src/bidi.js` keeps left-to-right runs (paths, `term:` prefixes, domains, signed numbers) in order inside right-to-left text: `render.js` runs it over the page body, and diagram text goes through `svgLine`.
- **Refactors keep the HTML byte-identical.** `npm run snapshot [ref]` renders every render / video / patch combination with a fixed clock and compares them with `ref` (default `origin/main`). Any difference must be intended and called out in the PR. On a PR, the CI `test (ubuntu-latest, 22)` job runs the same comparison against the base and shows it in its job summary.
- **The repository speaks English; the product speaks the reader's language.** Skill and command instructions, CLI output, comments and test names are English. Only viewer-facing page and video UI is localized (zh / en / ja / he); Chinese stays where it is the subject (writing-check word lists, Chinese fixtures and examples, README.zh-CN.md). `test/language.test.js` enforces this.
- End a JavaScript line with `// lang-ok: <reason>` only when its Chinese is input the code accepts or a known gap with an open issue (name the issue in the reason); exempt larger legitimate blocks in `EXCEPTIONS` in `test/language.test.js`.
- **Plugin installs copy the whole repository.** Keep large or personal files (videos, GIFs, `docs/social/`) out of git.

## Pull requests

- **Open an issue first, and wait for a maintainer to accept it.** Describe the problem and the change you plan; for new syntax, show the syntax. An issue is accepted when a maintainer agrees in a comment or labels it `ready-for-human`. Then open the PR and link the issue (`Fixes #123`). Only typo and broken-link fixes may skip the issue, and so may a PR that only adds a catalog theme (see [Theme catalog](#theme-catalog)). We close a PR without an accepted issue, and you can reopen it once the issue is accepted.
- One topic per PR. Commit messages follow Conventional Commits (`fix:`, `feat:`, `refactor:`, `test:`, `docs:`, `chore:`).
- Write the PR description in English: what changed, why, and how you verified it.
- `npm test` must pass and the bundle must be rebuilt.

### Reviewing a contributor PR (maintainers)

1. Check that the PR links an accepted issue. If it does not, close it with a link to "Pull requests" above.
2. Check out the PR head in a separate worktree: `git fetch origin pull/<n>/head:pr-<n> && git worktree add /tmp/pr-<n> pr-<n>`.
3. Review the diff against the PR base (`git diff origin/main...pr-<n>`), never against your current branch.
4. In the worktree: `npm ci`, `npm run build` (the bundle must not change), `npm test`, and `npm run snapshot` when `src/` changed. CI runs all of these; when you review without a checkout, read the CI results and the snapshot in the `test (ubuntu-latest, 22)` job summary instead.
5. To finish a PR on the contributor's branch, push to their fork. GitHub rejects the push if the PR touches `.github/workflows/` and your token lacks the `workflow` scope; open a carrier PR from a branch in this repository instead.
6. Comment in English, then remove the worktree.

## Theme catalog

The catalog is the set of theme files in `marketplace/themes/`. The website publishes them at `answer-me-with-html.com/themes/` (a wall of themes, a page for each theme, `index.json` and one JSON file per theme), and each one is a theme file that `am theme add <name>` checks and saves into `~/.answer-me-with-html/themes/` (`src/themes/catalog.js`; the same checks as the catalog CI, and only catalog names). A page that does not use a catalog theme does not carry it.

There are four ways to submit a theme. **A catalog theme needs no accepted issue first.** A maintainer reviews every theme before it goes in.

- **An agent** is the main way. The wall's "Copy for your agent" prompt points the agent at [/themes/make.md](https://answer-me-with-html.com/themes/make.md) (`site/make.md`): start from the closest catalog theme, change it, check it with `am theme check`, show the user both specimen pages, and give the user the prefilled issue URL. It needs no new command, so it works from 0.4.10. `/llms.txt` (`site/llms.txt`) points at the same guide. When a catalog rule changes, change `site/make.md` too; `test/site.test.js` checks that it names every token and selector.
- **The website editor** at [answer-me-with-html.com/themes/new/](https://answer-me-with-html.com/themes/new/) is for editing by hand. You start from a built-in or catalog theme (or upload a file), change it in a form or as JSON, see it live in light and dark, and check it with the catalog rules as you edit. Submit opens the issue form below with your theme filled in; Download gives you the file for a PR.
- **The issue form** is what the guide and the editor fill in. Open [Submit a theme](https://github.com/QingYunA/answer-me-with-html/issues/new?template=theme.yml), type the name and paste the theme file. A bot checks the theme and comments with what to fix. Edit the issue and it checks again.
- **A PR** adds `marketplace/themes/<name>.json`. One theme per PR is easiest to review.

Whichever way you submit, the theme must follow these rules:

- The file is a theme file ([docs/reference.md](docs/reference.md#your-own-theme)) plus the catalog fields `version` (`x.y.z`), `author`, `license`, and `description` (`{ "en": "one short sentence", "zh": "..." }`). `label` should have `en` and `zh`. The catalog fields are for the website; the CLI ignores them when it renders.
- The file name is the theme name: lowercase letters, digits and `-`, and not the name of a built-in theme, `index` or `new`.
- At most 16 KB. No `url()` or `image-set()` to `http:`, `https:` or `//`, no `@import`, no `@font-face`, no backslash. A theme names a font the CLI ships with `font` (only `bangers` for now); it does not bring its own.
- `css` targets only the classes in `THEME_SELECTORS` (`src/themes/selectors.js`). If your theme needs a class that is not there, add it to the list in the same PR, with the reason.
- Set `requires` only when the theme fails on an older version. A version that does not know a field ignores it, so a theme that uses `font` still works on 0.4.10 and newer; it shows system fonts there.
- Every color token in light and dark, and the contrast that `am theme check` asks for.
- `catalogProblems` in `src/themes/catalog-rules.js` holds these rules: name, size, `normalizeTheme`, colors, links, metadata, selectors and diagram tokens. `test/marketplace.test.js` runs it on every file, the website build runs it, and so do the issue Action and the website editor, so they cannot disagree. The test also renders `examples/tcp.en.md` with the font embedded once. `npm test` must pass. `npm run site` builds the website; open `/themes/` to see your theme on the wall and on its own page, in light and dark.
- **A catalog name is reserved forever.** A name that was in the catalog is never given to a built-in theme or to another theme, even after the theme is removed.

### Approving a submission

1. Read the issue. The bot comment must say that the theme passes the checks, and ends with a "See it rendered" link: `answer-me-with-html.com/themes/new/?issue=<number>` loads the theme of the issue into the editor (it reads the issue through the public GitHub API, 60 requests an hour without signing in), so you see it in light and dark on the sample pages. Read the theme itself, `css` most of all: it goes into other people's pages.
2. Add the label `theme-approved`. `.github/workflows/theme-submission.yml` checks the theme again, creates the branch `theme/issue-<number>` with the file and the author as `Co-authored-by`, and opens the PR with `Closes #<issue>`.
3. On the PR, approve the workflow run ("Approve workflows to run"). CI on a PR that the Action opened waits for this approval. A run started any other way, such as `workflow_dispatch`, does not count for the PR's required checks.
4. Review the PR and merge it as usual. The PR holds the file as the Action wrote it; the Action uses the issue text from the moment the label was added, so read the file in the PR, not the issue.
5. When the check fails at step 2, the Action comments and takes the label off. Add it again after the author fixes the issue. Adding it again rebuilds the branch from `main`.

The Action needs the labels `theme-submission` and `theme-approved`, and the repository setting that lets Actions create pull requests (Settings, Actions, General).

## Refreshing the demo video

Serve [docs/demo/demo.html](docs/demo/demo.html) next to the rendered [examples/tcp.en.md](examples/tcp.en.md) (`tcp.html`), open it at 1920×1080, wait for `window.ready`, then call `window.render(i / 30)` and screenshot `frame-0000.jpg` … `frame-0719.jpg`. Run `node docs/demo/make-demo.mjs <frames-dir>` to add the music and encode. The MP4 and GIF are not committed, because plugin installs copy the whole repository. Upload the MP4 to a GitHub comment and use that link in the README. The animation is deterministic, and the music from [docs/demo/music.mjs](docs/demo/music.mjs) is synthesized at 120 BPM, so every scene change lands on a beat.

## Releasing

A release is a version bump merged to `main`. All installs read `main`: `npx skills update` takes the latest commit, and `claude plugin update` only updates when the version changes.

1. `npm run release -- <x.y.z>` writes the version to all four manifests and rebuilds the bundle. `test/install.test.js` checks that they agree.
   Then write `highlights.json` for the new version: up to 3 short lines (80 characters at most) from this release's highlights, one list for each language in `src/languages/`. The new-version popover on users' pages shows the list in the page language. `test/highlights.test.js` checks the version, the languages and the lengths.
   Also write `.github/release-notes.md`: the notes of the GitHub Release. They are bilingual: the English notes, then a line `---`, then the same notes in Chinese, using the words of the Chinese page labels in `src/languages/zh.js` and of `docs/reference.zh-CN.md`. The first line must be `<!-- release <x.y.z> -->`; `test/release-notes.test.js` checks it.
2. Run `npm test` and `npm run smoke:install`, then open and merge a `chore: release <x.y.z>` PR.
3. The release workflow (`.github/workflows/release.yml`) tags the merge commit and publishes the Release with `.github/release-notes.md`. It runs when `package.json` changes on `main` and the Release does not exist yet; when only the tag exists, it publishes from that tag. Check it with `gh release view v<x.y.z>`.
   If the workflow fails, do the same by hand: `git tag -a v<x.y.z> <sha> -m v<x.y.z> && git push origin v<x.y.z> && gh release create v<x.y.z> --verify-tag --notes-file .github/release-notes.md`.
