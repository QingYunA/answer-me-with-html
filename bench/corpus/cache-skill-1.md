---
title: Redis vs Memcached for caching
subtitle: Pick Redis by default. Pick Memcached for simple, huge, multi-threaded key-value caches.
lang: en
---
## Conclusion {span=3}
```callout ok Choose Redis in most cases
Redis does everything Memcached does. It also adds data types, persistence and replication. Choose Memcached only when you need a plain string cache and want the simplest multi-threaded server.
```

## Comparison {span=3}
| Dimension | Redis | Memcached |
|---|---|---|
| Data types | ok Strings, hashes, lists, sets, sorted sets, streams | warn Strings only |
| Persistence | ok RDB snapshots and AOF log | no None |
| Replication and HA | ok Replicas, Sentinel, Cluster | warn Client-side sharding only |
| Threading | warn Mostly single-threaded commands | ok Multi-threaded |
| Memory efficiency | warn More overhead per key | ok Low overhead per key |
| Eviction | ok Many policies (LRU, LFU, TTL) | ok LRU |
| Extra features | ok Pub/sub, Lua scripts, transactions | no None |
| Operations | warn More options to tune | ok Very simple |

## How to choose {span=3}
```flow
(Need a cache) -> {Need data types, persistence or HA?}
{Need data types, persistence or HA?} -> *Redis: yes
{Need data types, persistence or HA?} -> {Only simple strings, very high throughput?}: no
{Only simple strings, very high throughput?} -> Memcached: yes
{Only simple strings, very high throughput?} --> Redis: unsure
```
