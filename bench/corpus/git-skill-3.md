---
template: sheet
title: Git merge vs git rebase
subtitle: Two ways to combine branches, with different effects on history
---
Merge keeps history as it happened and adds a merge commit. Rebase rewrites your commits on top of another branch to give a straight line.

## Summary {span=3}
```callout ok Rule of thumb
Merge shared branches. Rebase your own local branch before you share it.
```

## Merge: history after
```flow LR
(main) -> C1
C1 -> C2
C2 -> M: merge
(feature) -> F1
F1 -> F2
F2 -> M
M -> done
```
Old commits stay the same. A new merge commit `M` has two parents.

## Rebase: history after
```flow LR
(main) -> C1
C1 -> C2
C2 -> F1': replayed
F1' -> F2'
F2' -> tip
```
Git replays `F1` and `F2` on top of `C2`. The copies get new hashes. Git abandons the old commits.
## Comparison
| Aspect | Merge | Rebase |
|---|---|---|
| History shape | Branching, with merge commit | Linear |
| Existing commits | ok Unchanged | warn Copied with new hashes |
| Rewrites history | no | ok Yes |
| Safe on shared branches | ok Yes | no Needs force push |
| Conflict handling | Resolve once | Resolve per replayed commit |
| Shows when work was merged | ok Yes | no No |

## When to use which
- Use merge to bring a finished feature into `main`.
- Use rebase to update your local feature branch with new `main` commits.
- Never rebase commits that others have pulled.
