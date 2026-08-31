---
packages:
  domainkit: minor
---

Add credential-scoped provider sessions for Cloudflare and Vercel. Providers can discover multiple
accounts and authoritative zones, report explicit target-selection outcomes, preserve provider
evidence, and bind DNS operations to an explicitly selected target. Vercel integrations use the
current `/v2/oauth/access_token` exchange and preserve configuration and personal/team context.
