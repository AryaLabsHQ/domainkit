---
packages:
  domainkit:
    type: patch
---

## Authorize subdomains in parent DNS zones

Keep domain-scoped grants valid when a provider stores records in an authoritative parent zone,
while rejecting approved operations outside the granted domain subtree.
