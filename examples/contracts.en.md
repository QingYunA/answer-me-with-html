---
title: Users service contracts
cols: 2
lang: en
---

## A Classes
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
SqlUserRepository ..> User: loads
```

## B Database
```er LR
User
  id uuid PK
  email string UK
Session
  id uuid PK
  user_id uuid FK -> User
User 1--* Session: owns
```

## C HTTP API
```api
GET /users/{id}
path
  id uuid required | User ID
query
  include string optional | Related resources
response 200 User
  id uuid required
  email string required
response 404 Error
  message string required
```

## D RPC
```api
RPC users.UserService/GetUser
request GetUserRequest
  id string required
response OK User
  id string required
  email string \| null optional
response NOT_FOUND
```

## E One requirement, several API changes
```api
~ GET /users/{id}
response 200 User
  id string required
  - email string optional
  + email string required
~ RPC users.UserService/GetUser
response OK User
  - email string optional
  + email string required
+ POST /users/batch
request BatchRequest
  ids string[] required
- GET /v1/users/{id}
response 200 User
```
