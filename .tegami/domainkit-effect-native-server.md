---
packages:
  domainkit: minor
---

Add `domainkit/server`, with Effect-native `make` and Layer APIs plus `createDomainKit` for async
hosts. Both paths mount the same Web handler for provider connection start and callback completion;
async hosts supply and own their persistence implementation.
