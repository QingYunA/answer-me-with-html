---
title: api
---
## A HTTP 接口
```api
GET /users/{id}
path
  id string required
response 200 User
  email string optional
response 404 Error
  message string required
```
