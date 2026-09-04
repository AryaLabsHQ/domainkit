---
packages:
  domainkit: patch
---

## A rejected token reads as Unauthenticated

Cloudflare's HTTP 400 answers with code 6003 or 6111 (a malformed bearer token) and a 403 during token verification fail `Reason.Unauthenticated` with Cloudflare's own message, as 401 does; Vercel's 403 `forbidden` on token verification does the same. The server answers 401, and `Testing.conformance.provider` gains a `rejected-token` case that authenticates an empty token and expects `Unauthenticated`.
