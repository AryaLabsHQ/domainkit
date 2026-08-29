---
packages:
  domainkit:
    type: patch
---

## Discover Cloudflare accounts from authorized domains

Cloudflare OAuth and API-token authorization can now derive the selected account from a domain
visible to the credential. Hosts can offer a one-click connection flow without asking users to
find an account ID, while account-scoped DNS clients and explicit account authorization remain
available.
