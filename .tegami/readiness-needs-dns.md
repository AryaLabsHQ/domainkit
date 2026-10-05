---
packages:
  domainkit:
    type: patch
---

## Keep host-only readiness pending until DNS is observed

`Verify.attachEvidence` no longer reports a domain `ready` when no `Verify.observe` has run. A
readiness is `ready` only when at least one requirement has been observed, every requirement is
satisfied, and every host signal is `ok`. Host evidence merged first is kept, the domain stays
`pending` with its next check scheduled, and the first observation decides the outcome.
