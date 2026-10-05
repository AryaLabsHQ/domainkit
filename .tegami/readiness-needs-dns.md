---
packages:
  domainkit:
    type: patch
---

## Keep host-only readiness pending until DNS is observed

`Verify.attachEvidence` no longer reports a domain `ready` when no `Verify.observe` has run. A
readiness is `ready` only when at least one requirement has been observed, every requirement is
satisfied, and every host signal is `ok`. Host evidence merged first is kept, and the domain is
`failed` when a host signal failed and otherwise `pending` with its next check scheduled, until the
first observation decides the outcome. `Verify.latest` derives `overall` from the stored evidence,
so a host-only row stored as `ready` reads back as `pending` and due for observation.
