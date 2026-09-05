---
packages:
  "@domainkit/react": minor
---

## The flow state names the account

`Domain.FlowState.label` carries the account the records go to, as the provider labelled the zone
when the domain was attached, and `null` until there is an attachment. It reaches a host through
the part's data attributes, its `className` and `style` callbacks, and `onState`, like every other
field. A host writing its own summary line, "3 records · Cloudflare · acme-dns", now builds it from
`provider` and `label` instead of reaching into the connection slot for the snapshot.
