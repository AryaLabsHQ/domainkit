---
packages:
  domainkit: minor
---

Expose callable constructors for tagged DomainKit values. Effect and Promise integrations can
create plan operations, revocation states, and resolver outcomes without manually writing `_tag`
fields, while schemas remain available for validation and persistence.
