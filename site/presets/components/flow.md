---
title: flow
---
## A Request path
```flow LR
(User) -> Gateway: HTTPS
Gateway -> Auth & *Service
Service -> [(Database)]
group Backend: Auth, Service
```
