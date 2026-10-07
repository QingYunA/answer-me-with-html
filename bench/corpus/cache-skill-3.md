---
template: sheet
title: Redis vs Memcached
subtitle: Which cache to choose
---
Choose Redis by default. Choose Memcached only for a simple, large, multi-threaded key-value cache.

## Verdict
```callout ok Pick Redis in most cases
Redis does everything Memcached does. It also adds data structures, persistence and replication.
```

```callout info Pick Memcached when
* You need only plain string key-value caching.
* You want simple scaling across many CPU cores.
* You want the lowest memory overhead per item.
```

## Comparison
| Feature | Redis | Memcached |
|---|---|---|
| Data types | ok Strings, hashes, lists, sets, sorted sets, streams | warn Strings only |
| Persistence | ok Snapshots and append-only log | no None |
| Replication and failover | ok Built in (replicas, Sentinel, Cluster) | no None built in |
| Threading | warn Mostly single-threaded commands | ok Multi-threaded |
| Eviction policies | ok Many (LRU, LFU, TTL-based) | warn LRU only |
| Pub/sub and Lua scripts | ok Yes | no No |
| Sharding | ok Redis Cluster | warn Client-side only |
| Setup effort | warn More options to tune | ok Very simple |

## How to decide
```flow
(Need a cache) -> {Need more than strings, persistence or replication?}
{Need more than strings, persistence or replication?} -> Redis: yes
{Need more than strings, persistence or replication?} -> {Need max multi-core throughput on simple keys?}: no
{Need max multi-core throughput on simple keys?} -> Memcached: yes
{Need max multi-core throughput on simple keys?} -> Redis: no
```
