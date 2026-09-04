---
packages:
  domainkit: patch
---

## A fake can read like a real provider

`Testing.provider` accepts `name`, the display name a customer reads, defaulting to `Fake <id>`.
`Testing.resolver` takes a second argument naming the resolver its answers carry, defaulting to
`fake`, and `Testing.transport` passes one through as `resolver`. A fixture whose screenshots ship
can then name a provider and an observer a customer would recognise.
