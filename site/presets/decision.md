---
title: Plan the cache change
subtitle: Move the page cache from process memory to Redis
cols: 3
---
## A Today {meta="src/cache.ts"}
```ts title="cache.ts · today"
const pages = new Map<string, string>()

export function getPage(key: string) {
  return pages.get(key)
}

export function setPage(key: string, html: string) {
  pages.set(key, html)
}
```
Each server keeps its own copy. A deploy empties it.

## B Proposed {span=2 meta="sketch"}
```ts title="cache.ts · sketch"
import { createClient } from 'redis'

const redis = createClient({ url: process.env.REDIS_URL })
const TTL = 600 // seconds

export async function getPage(key: string) {
  return redis.get(`page:${key}`)
}

export async function setPage(key: string, html: string) {
  await redis.set(`page:${key}`, html, { EX: TTL })
}
```

## C Steps {span=2}
1. Add the Redis client and read `REDIS_URL` at start.
2. Make the two functions async and update the 4 callers.
3. Ship behind a flag and compare hit rates for one day.
4. Remove the in-memory map.

## D Open decisions
```ask
How long do pages live in the cache?
* 10 minutes | matches today's deploy rhythm
- 1 hour | fewer misses, older pages
- Until the next deploy | needs a purge step
```

```ask multi
What do we cache besides pages?
* Sessions | survive deploys
- API responses | more memory
```
