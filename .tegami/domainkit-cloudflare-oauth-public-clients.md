---
packages:
  domainkit: patch
---

## Support Cloudflare public OAuth clients

`Cloudflare.Options.oauth` accepts PKCE-only public clients with `clientAuth: "none"` and no
client secret, while confidential clients require `clientSecret` and default to
`client_secret_basic`. Cloudflare's default scopes use the current `zone.read`, `dns.read`, and
`dns.write` scope ids, with `offline_access` retained for refresh.
