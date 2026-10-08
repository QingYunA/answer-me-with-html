---
title: er
---
## A A shop's data model
```er LR
*User
  id PK
  email string UK
Order
  id PK
  user_id FK -> User
  status string
OrderItem
  id PK
  order_id FK -> Order
  product_id FK -> Product
  qty int
Product
  id PK
  name string
  price decimal
```
