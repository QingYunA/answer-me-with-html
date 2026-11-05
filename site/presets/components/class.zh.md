---
title: class
---
## A 类模型
```class LR
interface Store
  +find(id: string): User
class SqlStore
  -users: User[]
  +find(id: string): User
SqlStore ..|> Store: implements
```
