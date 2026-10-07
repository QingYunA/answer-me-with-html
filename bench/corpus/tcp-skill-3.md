---
title: TCP handshake and teardown
subtitle: How TCP opens and closes a connection
template: sheet
cols: 2
source: RFC 9293
---
Lead: TCP opens a connection with 3 segments (SYN, SYN-ACK, ACK). It closes with 4 segments, because each side shuts down its own direction.

## Three-way handshake {span=1}
```sequence
Client -> Server: SYN, seq=x
Server -> Client: SYN-ACK, seq=y, ack=x+1
Client -> Server: ACK, ack=y+1
note Client, Server: Connection ESTABLISHED
```

## Four-way teardown {span=1}
```sequence
Client -> Server: FIN, seq=u
Server -> Client: ACK, ack=u+1
note Client, Server: Server may still send data
Server -> Client: FIN, seq=v
Client -> Server: ACK, ack=v+1
note Client, Server: Client waits in TIME_WAIT
```

## Why 3 steps to open
* Both sides must pick an initial sequence number.
* Each side must confirm the other side's number.
* The server joins its SYN and ACK in one segment, so 3 segments are enough.

## Why 4 steps to close
* TCP is full duplex: each direction closes on its own.
* The server may still have data to send after it gets the first FIN.
* So the server sends ACK and FIN as two separate segments.

## Client states {span=2}
```flow LR
(CLOSED) -> SYN_SENT: send SYN
SYN_SENT -> ESTABLISHED: get SYN-ACK, send ACK
ESTABLISHED -> FIN_WAIT_1: send FIN
FIN_WAIT_1 -> FIN_WAIT_2: get ACK
FIN_WAIT_2 -> TIME_WAIT: get FIN, send ACK
TIME_WAIT -> (CLOSED): wait 2 MSL
```

## Key points
```callout info TIME_WAIT
The client waits 2 MSL (maximum segment lifetime) after the last ACK. This lets it resend the ACK if the server's FIN arrives again, and lets old packets expire.
```
