---
packages:
  domainkit: patch
---

## A rejected token reads as Unauthenticated

Cloudflare's HTTP 400 answers with code 6003 or 6111 (a malformed bearer token) and a 403 from its token verify endpoint fail `Reason.Unauthenticated` with Cloudflare's own message, as 401 does; Vercel's 403 `forbidden` on token verification does the same, while a 403 from zone listing stays `Forbidden`. The server answers 401, and `Testing.conformance.provider` gains a `rejected-token` case that authenticates empty secrets (or the `rejectedToken` values you pass) and expects `Unauthenticated`.
