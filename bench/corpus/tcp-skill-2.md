---
title: TCP handshake and teardown
subtitle: How TCP opens and closes a connection
---
TCP opens with 3 messages (SYN, SYN-ACK, ACK) and closes with 4 (FIN, ACK, FIN, ACK). Closing takes 4 because each side closes its own direction.

## Three-way handshake
```sequence
Client -> Server: SYN, seq=x
Server --> Client: SYN-ACK, seq=y, ack=x+1
Client -> Server: ACK, ack=y+1
note Client, Server: Connection is ESTABLISHED
```

## Why three steps
* Step 1 tells the server the client's start number.
* Step 2 gives the client the server's start number and confirms step 1.
* Step 3 confirms the server's number. Both sides now know the other can send and receive.
* Three steps also stop old duplicate SYN packets from opening a false connection.

## Four-way teardown
```sequence
Client -> Server: FIN, seq=u
Server --> Client: ACK, ack=u+1
note Server: Server may still send data (half-close)
Server -> Client: FIN, seq=v
Client --> Server: ACK, ack=v+1
note Client: TIME_WAIT, then CLOSED
```

## Key states
| Side | State | Meaning |
|---|---|---|
| Client | FIN_WAIT_1 / FIN_WAIT_2 | FIN sent, waiting for ACK, then for the peer's FIN |
| Server | CLOSE_WAIT | Got FIN, app has not closed yet |
| Server | LAST_ACK | Own FIN sent, waiting for the final ACK |
| Client | TIME_WAIT | Waits 2×MSL so the last ACK is not lost |

## Why four steps
```callout info Half-close
The server may still have data to send after it gets the client's FIN. So it sends ACK first and FIN later. Sometimes both go in one packet, which gives 3 messages.
```
