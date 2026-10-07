---
title: 缓存用 Redis 还是 Memcached？
subtitle: 给一个 Web 应用选会话缓存和页面缓存
cols: 3
---
两者都是很快的内存存储。区别在于重启后数据还在不在，以及能存什么类型的数据。

## A 逐项对比 {span=2}
| 需求 | Redis | Memcached |
|---|---|---|
| 重启后保留数据 | ok RDB 快照、AOF 日志 | no 只在内存里 |
| 数据类型 | ok 字符串、哈希、列表、集合 | warn 只有字符串 |
| 按键设置过期 | ok 支持 | ok 支持 |
| 主从复制 | ok 内置 | no 不内置 |
| 多核利用 | warn 单个主线程 | ok 多线程 |
| 小键的内存开销 | warn 略高 | ok 更低 |

## B 结论
```callout ok 选 Redis
会话必须在重启后保留，购物车要用哈希结构，这两点 Memcached 都做不到。
```
只有纯页面缓存、随时可以重建时，才考虑 Memcached。

## C 我们的数据 {span=3}
```kv cols=4
峰值: 每秒 4000 次请求
缓存大小: 约 2 GB
重启要求: 不丢会话
团队经验: 另外 2 个服务在用 Redis
```
