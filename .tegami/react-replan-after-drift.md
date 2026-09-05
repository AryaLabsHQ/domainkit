---
packages:
  "@domainkit/react":
    type: patch
---

## A domain that lost its records is offered them again

`Domain.useFlow` plans again when an observation made after the apply reads one of a domain's
records back missing or wrong, so a customer whose records were deleted at the provider gets "Add N
records" instead of a count of what once landed. Every observation reporting the same drift is one
reason to plan, an apply observes the domain again to read back what it wrote, and a removal the
flow is carrying out is not drift.
