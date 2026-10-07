---
title: TCP three-way handshake
subtitle: How two hosts agree to talk, and how they stop
cols: 3
source: RFC 9293
---
TCP opens a connection with three messages and closes it with four. Sequence numbers keep both sides in step.

## A Three-way handshake {span=2 meta="open"}
```sequence num
participants: Client, Server
note Server: LISTEN
Client -> Server: SYN, seq=x
note Client: SYN_SENT
Server -> Client: SYN+ACK, seq=y, ack=x+1
Client -> Server: ACK, ack=y+1
note Client, Server: ESTABLISHED
```

## B Why three messages
1. The server learns that the client can send.
2. The client learns that the server can send and receive.
3. The server learns that the client can receive.

```callout warn Two is not enough
An old duplicate SYN can arrive late. With two messages, the server opens a useless connection for it.
```

## C State changes {span=2 meta="simplified"}
```flow LR
(CLOSED) -> LISTEN: passive open
LISTEN -> SYN_RCVD: get SYN / send SYN+ACK
(CLOSED) --> SYN_SENT: active open / send SYN
SYN_SENT -> *ESTABLISHED: get SYN+ACK / send ACK
SYN_RCVD -> *ESTABLISHED: get ACK
```

## D Flags
| Flag | Job | In handshake |
|---|---|---|
| SYN | Start a connection | ok steps 1, 2 |
| ACK | Confirm receipt | ok steps 2, 3 |
| FIN | Stop sending | no not used |
| RST | Reset at once | warn on error |
