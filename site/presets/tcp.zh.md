---
title: TCP 三次握手与四次挥手
subtitle: 一张图看懂连接的建立与释放
cols: 3
source: RFC 9293
---
TCP 先握手，再传数据，最后挥手。每一步都靠序号和确认号对齐双方状态。

## A 三次握手 {span=2 meta="建立连接"}
```sequence num
participants: 客户端, 服务器
note 服务器: LISTEN
客户端 -> 服务器: SYN, seq=x
note 客户端: SYN_SENT
服务器 -> 客户端: SYN+ACK, seq=y, ack=x+1
note 服务器: SYN_RCVD
客户端 -> 服务器: ACK, ack=y+1
note 客户端, 服务器: ESTABLISHED
```

## B 为什么是三次
1. 第一次：服务器确认客户端能发。
2. 第二次：客户端确认服务器能收、能发。
3. 第三次：服务器确认客户端能收。

```callout warn 两次不够
旧的重复 SYN 可能延迟到达。只握手两次时，服务器会为它建立一条无用的连接。
```

## C 状态迁移 {span=2 meta="简化版"}
```flow LR
(CLOSED) -> LISTEN: 被动打开
LISTEN -> SYN_RCVD: 收 SYN / 发 SYN+ACK
(CLOSED) --> SYN_SENT: 主动打开 / 发 SYN
SYN_SENT -> *ESTABLISHED: 收 SYN+ACK / 发 ACK
SYN_RCVD -> *ESTABLISHED: 收 ACK
```

## D 关键数字
```kv cols=1
MSL: 报文最大生存时间，通常 30 秒到 2 分钟
TIME_WAIT: 2 × MSL
ISN: 初始序号随机生成，防止伪造
SYN 重试: Linux 默认 6 次
```

## E 四次挥手 {span=2 meta="释放连接"}
```sequence num
客户端 -> 服务器: FIN
服务器 --> 客户端: ACK
note 服务器: 继续发送剩余数据
服务器 -> 客户端: FIN
客户端 --> 服务器: ACK
note 客户端: TIME_WAIT，等待 2MSL
```

## F 报文标志位
| 标志 | 作用 | 握手中 |
|---|---|---|
| SYN | 同步序号，发起连接 | ok 第 1、2 次 |
| ACK | 确认收到数据 | ok 第 2、3 次 |
| FIN | 发送方的数据已发完 | no 不参与 |
| RST | 立即重置连接 | warn 异常时 |
