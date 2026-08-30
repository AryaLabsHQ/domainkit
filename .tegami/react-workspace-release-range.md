---
packages:
  "@domainkit/react": patch
---

## Keep React releases aligned with DomainKit

Publish React with an explicit workspace range so coordinated minor releases cannot retain a stale
DomainKit dependency from Bun's lockfile.
