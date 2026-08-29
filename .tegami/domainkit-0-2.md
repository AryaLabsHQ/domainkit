---
packages:
  domainkit:
    type: minor
---

## Publish the DomainKit 0.2 contract

DomainKit now provides one Effect-native authorization lifecycle, authoritative zone discovery,
resilient multi-resolver DNS observation, and a reusable provider conformance runner. Promise APIs
delegate to the same canonical implementation.

Adapter authors now use `domainkit/adapter` or `domainkit/effect/adapter`; obsolete generic root
exports and split authorization-store exports have been removed.
