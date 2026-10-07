---
title: Redis or Memcached for our cache?
subtitle: A session and page cache for one web app
cols: 3
---
Both are fast in-memory stores. They differ in what happens after a restart and in what you can store.

## A Feature by feature {span=2}
| Need | Redis | Memcached |
|---|---|---|
| Keep data after a restart | ok RDB snapshots, AOF log | no Memory only |
| Data types | ok Strings, hashes, lists, sets | warn Strings only |
| Expiry per key | ok Yes | ok Yes |
| Replication | ok Built in | no Not built in |
| Many CPU cores | warn One main thread | ok Multi-threaded |
| Memory per small key | warn A bit higher | ok Lower |

## B Verdict
```callout ok Use Redis
Sessions must survive a restart, and the cart needs a hash. Memcached gives neither.
```
Pick Memcached only for a pure page cache that you can rebuild at any time.

## C Our numbers {span=3}
```kv cols=4
Peak load: 4,000 requests/s
Cache size: about 2 GB
Restart budget: 0 lost sessions
Team skill: Redis in 2 other services
```
