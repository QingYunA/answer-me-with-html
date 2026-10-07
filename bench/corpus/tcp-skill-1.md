---
title: TCP handshake and teardown
subtitle: How a connection opens with 3 segments and closes with 4
---
Open with SYN, SYN-ACK, ACK. Close with FIN, ACK, FIN, ACK, because each side closes its own direction.

## Three-way handshake
```sequence
Client -> Server: SYN, seq=x
Server --> Client: SYN-ACK, seq=y, ack=x+1
Client -> Server: ACK, ack=y+1
note Client, Server: Connection is ESTABLISHED
```

## Why three steps
* Step 1 tells the server the client can send.
* Step 2 tells the client the server can send and receive.
* Step 3 tells the server the client can receive.
* Both sides agree on initial sequence numbers.
* The third step stops old duplicate SYNs from opening a connection.

## Four-way teardown
```sequence
Client -> Server: FIN, seq=u
Server --> Client: ACK, ack=u+1
note Server: Server may still send data
Server -> Client: FIN, seq=v
Client --> Server: ACK, ack=v+1
note Client: TIME_WAIT for 2 MSL
```

## Why four steps
* TCP is full duplex, so each direction closes alone.
* The server ACKs the FIN at once but may need time to finish its data.
* The server then sends its own FIN.
* The client waits in TIME_WAIT to resend the last ACK if it is lost.

## State changes
| Side | Open | Close |
|---|---|---|
| Client | SYN_SENT, ESTABLISHED | FIN_WAIT_1, FIN_WAIT_2, TIME_WAIT, CLOSED |
| Server | LISTEN, SYN_RCVD, ESTABLISHED | CLOSE_WAIT, LAST_ACK, CLOSED |
