---
title: api
---
## A One requirement, several endpoints
```api
~ GET /users/{id}
response 200 User
  - email string optional
  + email string required
~ RPC users.UserService/GetUser
response OK User
  - email string optional
  + email string required
+ POST /users/batch
request BatchRequest
  ids string[] required
```
