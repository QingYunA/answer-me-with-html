---
title: 用户服务接口与模型
cols: 2
lang: zh
---

## A 类模型
```class LR
abstract Entity
  +id: string
class User
  -email: string
  +rename(name: string): void
interface UserRepository
  +find(id: string): User
class SqlUserRepository
  +find(id: string): User
User --|> Entity
SqlUserRepository ..|> UserRepository
SqlUserRepository ..> User: 读取
```

## B 数据模型
```er LR
User
  id uuid PK
  email string UK
Session
  id uuid PK
  user_id uuid FK -> User
User 1--* Session: 拥有
```

## C HTTP 接口
```api
GET /users/{id}
path
  id uuid required | 用户标识
query
  include string optional | 关联资源
response 200 User
  id uuid required
  email string required
response 404 Error
  message string required
```

## D RPC 接口
```api
RPC users.UserService/GetUser
request GetUserRequest
  id string required
response OK User
  id string required
  email string \| null optional
response NOT_FOUND
```
