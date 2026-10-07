---
title: 给缓存改造做个方案
subtitle: 把页面缓存从进程内存搬到 Redis
cols: 3
---
## A 现状 {meta="src/cache.ts"}
```ts title="cache.ts · 现状"
const pages = new Map<string, string>()

export function getPage(key: string) {
  return pages.get(key)
}

export function setPage(key: string, html: string) {
  pages.set(key, html)
}
```
每台服务器各存一份，发布一次就清空。

## B 方案 {span=2 meta="示意代码"}
```ts title="cache.ts · sketch"
import { createClient } from 'redis'

const redis = createClient({ url: process.env.REDIS_URL })
const TTL = 600 // 秒

export async function getPage(key: string) {
  return redis.get(`page:${key}`)
}

export async function setPage(key: string, html: string) {
  await redis.set(`page:${key}`, html, { EX: TTL })
}
```

## C 步骤 {span=2}
1. 引入 Redis 客户端，启动时读取 `REDIS_URL`。
2. 把两个函数改成 async，同时改掉 4 处调用。
3. 加开关上线，对比一天的命中率。
4. 删除内存里的 Map。

## D 待定的问题
```ask
页面在缓存里存多久？
* 10 分钟 | 和现在的发布节奏一致
- 1 小时 | 未命中更少，页面更旧
- 直到下次发布 | 需要加清缓存的步骤
```

```ask multi
除了页面还缓存什么？
* 会话 | 发布后不掉登录
- API 响应 | 占用更多内存
```
