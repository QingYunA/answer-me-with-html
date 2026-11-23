# Codebase architecture pages

Read this when SKILL.md section 1 sends you here: the user asks you to explain a repository, draw its architecture, or show how its code is organized. `am` means the full `node ".../scripts/am.mjs"` command from SKILL.md section 2; write the path out in full.

The page is worth its evidence. Explore the code first, record each claim with the lines that prove it, and draw only what you read. One question gets one page.

## Explore

Work from the repository root, in this order. Each step ends on its own bar.

1. **Entry points.** Find every way into the program: `bin` and `main` in `package.json`, `[project.scripts]` in `pyproject.toml`, `cmd/` in Go, `[[bin]]` in `Cargo.toml`, the CLI command table, the route table, the exported index. Done when each entry point has a `path:line`.
2. **Module boundaries.** List the source files in the working tree, new untracked files included and ignored files left out. A module is a folder or file whose imports stay mostly inside it. Scope the map to the question. For "how is this organized", read the imports of each top-level folder; done when every source file belongs to one module and each module's dependencies are known. For "how does X work", the map is provisional; done when the top-level modules are named, and step 3 reads each module's imports when the trace reaches it.
3. **Main path.** Take the request the question is about, or the most common one (the default command, the main route). Trace it from its entry point to its output, one call at a time. Done when every hop has a `path:line`.
4. **Data and config.** Read the types, schemas or tables on the main path, and where settings load from, with their defaults and precedence. Done when each type and setting the main path reads has a `path:line`.

On a repository too large to read in this context: once the modules in scope are known, give each one to a subagent, one per module. Brief it with the question, the module's files, its place in the boundaries, and the evidence rule below. Ask for the module's job in one sentence, its entry functions, its part of the main path, and every claim with its span. Merge the reports, then trace the hand-offs between modules yourself.

## Evidence

- Cite every claim about the code as an inline code span: `` `src/cli.js:42` `` for one line, `` `src/cli.js:42-60` `` for a range, the path relative to the repository root. Write the span when you read the line.
- Put spans in panel text, table cells and `tree` notes. Diagram labels name parts; the panel text under the diagram cites them.
- A claim with no line to cite is an inference: mark it as not checked and say how to check it.
- `am render` checks the spans it can place in the current folder: the file exists and the lines are inside it. A failed span prints a `refs n warnings` line with its draft line. Fix it as you fix a code warning: open the file, find the right lines, correct the span, render again.
- The check skips some spans: a missing file at the root, a root file with no extension (`LICENSE`), a secret or binary file, and diagram text. A clean render is not proof; the proof is that you read each cited line when you wrote its span.

## Draft

Render from the repository root, so `src=` and the spans resolve against it.

- **Frontmatter:** `commit:` set to `git rev-parse --short HEAD`, with `+dirty` appended when `git status --porcelain` prints anything. The page header shows it, so the reader knows which code the page describes.
- The first paragraph, before any `##` heading: the answer in two or three sentences.
- **Modules:** a `tree`, one line per module, `folder/ | job`.
- **Main path:** a `flow` for how parts connect, or a `sequence` for calls between parts over time. Use the same names as the module tree.
- **Key code:** code blocks with `src=` and `lines=` for the few spots the main path turns on.
- **Module table:** module, its files, its job, what it depends on.
- **Data model,** when the question is about data: an `er` or `class` diagram.

Order the panels by the question: "how does X work" leads with the main path; "how is this organized" leads with the modules.
