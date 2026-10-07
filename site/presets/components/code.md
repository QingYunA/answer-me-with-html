---
title: code
theme: blueprint
---
## A The fix {meta="sketch"}
```ts title="retry.ts · sketch" hl=4
export async function retry<T>(fn: () => Promise<T>, times = 3) {
  for (let i = 1; ; i++) {
    try { return await fn() }
    catch (err) { if (i >= times) throw err }
  }
}
```
