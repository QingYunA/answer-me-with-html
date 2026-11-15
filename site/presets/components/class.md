---
title: class
---
## A Class model
```class LR
interface Store
  +find(id: string): User
class SqlStore
  -users: User[]
  +find(id: string): User
SqlStore ..|> Store: implements
```
