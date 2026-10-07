---
template: sheet
title: git merge vs git rebase
subtitle: Two ways to combine branches, two different histories
---
Merge keeps history as it happened and adds a merge commit. Rebase replays your commits on a new base and rewrites them.

## Merge: history is kept
```flow LR
(main) -> M1: C1
M1 -> M2: C2
M2 -> MM: merge commit
M1 -> F1: branch off
F1 -> F2
F2 -> MM
```

## Rebase: history is rewritten
```flow LR
(main) -> M1: C1
M1 -> M2: C2
M2 -> F1p: F1' (new hash)
F1p -> F2p: F2' (new hash)
```

## Comparison
| Aspect | merge | rebase |
|---|---|---|
| Existing commits | ok unchanged | no copied with new hashes |
| Extra commit | warn adds a merge commit | ok none |
| History shape | warn branching graph | ok linear |
| Shows true timeline | ok yes | no no |
| Safe on shared branches | ok yes | no no, needs force push |

## When to use which
* Use merge to combine shared or public branches.
* Use rebase to tidy a private branch before you merge it.
* Never rebase commits that others already pulled.

```bash title="commands"
git switch feature && git merge main
git switch feature && git rebase main
```
