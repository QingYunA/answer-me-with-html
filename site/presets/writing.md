---
title: What's wrong with this paragraph?
subtitle: A review of one release note, sentence by sentence
cols: 3
---
## A Sentence review {span=2}
```annot
# 1 The opening | 27 words, limit 25
[In order to]{!Write "To"} [facilitate]{!Write "help"} a smoother upgrade path for existing users, the old `--legacy` flag [has been removed]{!Passive: say who removed it} and [numerous]{!Write "many"} defaults [were changed]{!Passive} [prior to]{!Write "before"} this release.
# 2 The rewrite | 2 sentences, 10 and 7 words
[We removed]{Active voice} the old `--legacy` flag [to help]{Short verb} you upgrade. We [changed]{Simple past} [many]{Common word} defaults [before]{One meaning} this release.
> One idea per sentence. Name who does the action.
```

## B Lengths
```limits
Opening sentence | 27 / 25 | words
Rewrite, first | 10 / 25 | words
Rewrite, second | 7 / 25 | words
Paragraph | 2 / 6 | sentences
```

## C The rules used {span=3}
| Rule | Before | After |
|---|---|---|
| Common words | ~~facilitate~~, ~~numerous~~, ~~prior to~~ | help, many, before |
| Active voice | ~~has been removed~~ | we removed |
| Sentence length | 27 words | 10 and 7 words |
