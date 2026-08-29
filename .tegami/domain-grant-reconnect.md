---
packages:
  domainkit:
    type: patch
---

Preserve an owner's existing domain grants when the same provider account is connected again. This
lets one authorization safely provision additional domains without silently disconnecting earlier
domains.
