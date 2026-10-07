---
title: sequence
---
## A Login with a token
```sequence num
Browser -> API: POST /login
API -> Auth: check password
Auth --> API: token
API --> Browser: 200, set cookie
```
