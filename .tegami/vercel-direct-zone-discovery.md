---
packages:
  domainkit:
    type: patch
---

## Resolve Vercel zones through direct domain discovery

Fall back to Vercel's domain configuration endpoints when an integration omits manageable zones
from the account listing, including parent DNS storage zones used by delegated subdomains.
