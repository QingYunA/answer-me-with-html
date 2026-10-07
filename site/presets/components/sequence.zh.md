---
title: sequence
---
## A 用令牌登录
```sequence num
浏览器 -> API: POST /login
API -> 鉴权服务: 校验密码
鉴权服务 --> API: 令牌
API --> 浏览器: 200，写入 Cookie
```
