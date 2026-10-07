---
title: Redis vs Memcached for caching
subtitle: Choose Redis by default; choose Memcached for a plain, multi-threaded key-value cache.
---
Pick Redis in most cases. Pick Memcached only when you need a simple, very fast string cache and nothing more.

## Verdict {span=3}
```callout ok Choose Redis by default
Redis does everything Memcached does, and adds data structures, persistence and replication. Memcached stays a good fit for a simple cache that uses many CPU cores.
```

## Comparison {span=3}
| Dimension | Redis | Memcached |
|---|---|---|
| Data types | ok Strings, hashes, lists, sets, sorted sets, streams | warn Strings only |
| Persistence | ok RDB snapshots and AOF log | no None |
| Replication and failover | ok Replicas, Sentinel, Cluster | no None built in |
| Threading | warn Mostly single-threaded commands | ok Multi-threaded |
| Memory use | warn More overhead per key | ok Low overhead with slab allocator |
| Eviction | ok Many policies (LRU, LFU, TTL) | warn LRU only |
| Extra features | ok Pub/sub, Lua, transactions | no None |
| Sharding | ok Server-side with Cluster | warn Client-side only |

## How to choose
```flow
(Need a cache) -> {Need persistence, data structures or replication?}
{Need persistence, data structures or replication?} -> Redis: yes
{Need persistence, data structures or replication?} -> {Only simple strings, very high throughput?}: no
{Only simple strings, very high throughput?} -> Memcached: yes
{Only simple strings, very high throughput?} -> Redis: no
```

## Use each when
```callout info Redis
Sessions, leaderboards, rate limits, queues, pub/sub, and a cache that must survive a restart.
```
```callout warn Memcached
A plain object or page cache, large values spread over many cores, and a team that wants minimal setup.
```
