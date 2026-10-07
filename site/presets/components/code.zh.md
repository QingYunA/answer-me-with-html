---
title: code
theme: blueprint
---
## A 修复 {meta="示意代码"}
```ts title="retry.ts · sketch" hl=4
export async function retry<T>(fn: () => Promise<T>, times = 3) {
  for (let i = 1; ; i++) {
    try { return await fn() }
    catch (err) { if (i >= times) throw err } // 到达次数上限才抛出
  }
}
```
