# Contributing

Setup and test commands are in the README's [Development](README.md#development) section.

## Ground rules

- **`skills/answer-me-with-html/scripts/am.mjs` is generated.** Edit `src/`, then run `npm run build` and commit both. CI fails when the bundle is stale. On a merge or rebase conflict in `am.mjs`, take either side and rebuild; never merge it by hand.
- **The page format lives in `src/page.js`.** It writes the root `<html>` settings, the narration `<audio>` and the trailing `#am-source`, and `readPage()` reads them back for `am patch`. A new page setting goes in both places.
- **A theme is one file in `src/themes/`** (`blueprint.js` shows the format), listed in `src/themes/registry.js`. Everything else reads themes from the registry, and `base.css` / `video.css` never name a theme.
- **A language is one file in `src/languages/`**, listed in `src/languages/registry.js`. `src/language.js` is the only place that decides the language of a draft; the page and the video read its result and never decide themselves. A language without a file still renders: `<html lang>` is the tag the draft declares and the labels are English. To add a language, copy `src/languages/en.js`, translate the labels, list the file in the registry and add the language to the `label` of each built-in theme; `test/languages-registry.test.js` names what is missing. A language that needs its own fonts adds `langs` and `fonts` (see `src/languages/zh-Hant.js`). Direction comes from the language tag, not the file: a right-to-left page gets `dir="rtl"` and `src/themes/rtl.css`; `base.css` uses logical properties (`inset-inline-start`, `margin-inline-end`, `text-align: start`) so it serves both directions, and diagrams take the page direction from the component context (`dir`). `src/bidi.js` keeps left-to-right runs (paths, `term:` prefixes, domains, signed numbers) in order inside right-to-left text: `render.js` runs it over the page body, and diagram text goes through `svgLine`.
- **Refactors keep the HTML byte-identical.** `npm run snapshot [ref]` renders 336 render / video / patch combinations with a fixed clock and compares them with `ref` (default `origin/main`). Any difference must be intended and called out in the PR.
- **The repository speaks English; the product speaks the reader's language.** Skill and command instructions, CLI output, comments and test names are English. Only viewer-facing page and video UI is localized (zh / en / ja / he); Chinese stays where it is the subject (writing-check word lists, Chinese fixtures and examples, README.zh-CN.md). `test/language.test.js` enforces this.
- End a JavaScript line with `// lang-ok: <reason>` only when its Chinese is input the code accepts or a known gap with an open issue (name the issue in the reason); exempt larger legitimate blocks in `EXCEPTIONS` in `test/language.test.js`.
- **Plugin installs copy the whole repository.** Keep large or personal files (videos, GIFs, `docs/social/`) out of git.

## Pull requests

- **Open an issue first, and wait for a maintainer to accept it.** Describe the problem and the change you plan; for new syntax, show the syntax. An issue is accepted when a maintainer agrees in a comment or labels it `ready-for-human`. Then open the PR and link the issue (`Fixes #123`). Only typo and broken-link fixes may skip the issue. We close a PR without an accepted issue, and you can reopen it once the issue is accepted.
- One topic per PR. Commit messages follow Conventional Commits (`fix:`, `feat:`, `refactor:`, `test:`, `docs:`, `chore:`).
- Write the PR description in English: what changed, why, and how you verified it.
- `npm test` must pass and the bundle must be rebuilt.

### Reviewing a contributor PR (maintainers)

1. Check that the PR links an accepted issue. If it does not, close it with a link to "Pull requests" above.
2. Check out the PR head in a separate worktree: `git fetch origin pull/<n>/head:pr-<n> && git worktree add /tmp/pr-<n> pr-<n>`.
3. Review the diff against the PR base (`git diff origin/main...pr-<n>`), never against your current branch.
4. In the worktree: `npm ci`, `npm run build` (the bundle must not change), `npm test`, and `npm run snapshot` when `src/` changed.
5. To finish a PR on the contributor's branch, push to their fork. GitHub rejects the push if the PR touches `.github/workflows/` and your token lacks the `workflow` scope; open a carrier PR from a branch in this repository instead.
6. Comment in English, then remove the worktree.

## Refreshing the demo video

Serve [docs/demo/demo.html](docs/demo/demo.html) next to the rendered [examples/tcp.en.md](examples/tcp.en.md) (`tcp.html`), open it at 1920×1080, wait for `window.ready`, then call `window.render(i / 30)` and screenshot `frame-0000.jpg` … `frame-0719.jpg`. Run `node docs/demo/make-demo.mjs <frames-dir>` to add the music and encode. The MP4 and GIF are not committed, because plugin installs copy the whole repository. Upload the MP4 to a GitHub comment and use that link in the README. The animation is deterministic, and the music from [docs/demo/music.mjs](docs/demo/music.mjs) is synthesized at 120 BPM, so every scene change lands on a beat.

## Releasing

A release is a version bump merged to `main`. All installs read `main`: `npx skills update` takes the latest commit, and `claude plugin update` only updates when the version changes.

1. `npm run release -- <x.y.z>` writes the version to all four manifests and rebuilds the bundle. `test/install.test.js` checks that they agree.
2. Run `npm test` and `npm run smoke:install`, then open and merge a `chore: release <x.y.z>` PR.
3. Tag the merge commit and publish the GitHub Release:
   `git tag -a v<x.y.z> <sha> -m v<x.y.z> && git push origin v<x.y.z> && gh release create v<x.y.z> --verify-tag --notes-file <notes>`.
