---
template: doc
title: HTTP 304 Not Modified
subtitle: A conditional request can validate a stored response
lang: en
---
A 304 response tells a client that its conditional GET or HEAD would otherwise have returned 200 OK.
[RFC 9110 §15.4.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5)

## A When does it happen?
A matching entity tag in `If-None-Match` makes an otherwise successful GET or HEAD return 304.
[RFC 9110 §13.1.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2)

## B Does it carry the page again?
A 304 response carries no content or trailers.
[RFC 9110 §15.4.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5)

## C What can a cache reuse?
After a 304 validates a stored response, a cache updates that response's headers with information from the 304.
[RFC 9111 §4.3.4](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.3.4)

The cache uses the updated stored response to satisfy the request.
[RFC 9110 §15.4.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5)

## D Sources
- Conditional requests: [https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2)
- 304 semantics: [https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5)
- Cache validation: [https://www.rfc-editor.org/rfc/rfc9111.html#section-4.3.4](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.3.4)
