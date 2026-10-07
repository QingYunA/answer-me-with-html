---
title: git merge vs git rebase
subtitle: Two ways to combine branches, two different histories
---
Merge keeps history as it happened and adds a merge commit. Rebase rewrites your commits on top of the target branch, so history stays linear.

## Summary {span=3}
| Question | merge | rebase |
|---|---|---|
| Rewrites existing commits | no | ok |
| Adds a merge commit | ok | no |
| History shape | branching graph | straight line |
| Safe on shared branches | ok | warn only before you push |
| Conflict handling | once, in one merge commit | per replayed commit |

## Merge: before and after
```flow LR
(main) -> M1: C1
M1 -> M2: C2
M1 --> F1: branch
F1 -> F2
M2 -> Merge: merge commit
F2 -> Merge
```

## Rebase: before and after
```flow LR
(main) -> M1: C1
M1 -> M2: C2
M2 -> F1p: F1' (new hash)
F1p -> F2p: F2' (new hash)
```

## How each one changes history
```bash title="commands"
git switch feature
git merge main      # adds a merge commit, keeps F1 and F2 unchanged
git rebase main     # replays F1 and F2 as new commits F1' and F2'
```

## When to use which {span=3}
- Use **merge** for shared or public branches. It never changes commits that others already have.
- Use **rebase** to tidy a private feature branch before you open a pull request.
- Never rebase commits that you already pushed and others use. You would need a force push.
