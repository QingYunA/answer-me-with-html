---
title: state
---
## A TCP 连接
```state LR
[*] -> Idle
Idle -> Connecting: connect()
Connecting -> Open: SYN-ACK
Connecting -> Closed: RST
Open -> Open: retransmit
Open -> Closed: close()
Closed -> [*]
```
