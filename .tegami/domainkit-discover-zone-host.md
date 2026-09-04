---
packages:
  domainkit: patch
---

## Discovery names the provider that hosts the zone

`Provider.Definition.nameservers` declares the hostname suffixes a provider's nameservers end in (Cloudflare `ns.cloudflare.com`, Vercel `vercel-dns.com`), and `Connect.discover` answers `NotFound` with `host: { provider }` naming the one registered provider whose suffixes cover every authoritative nameserver, or `null`. The discovery route and `Transport` carry the field, and `Testing.provider` accepts `nameserverSuffixes`.
