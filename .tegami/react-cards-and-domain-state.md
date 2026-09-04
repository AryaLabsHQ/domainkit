---
packages:
  "@domainkit/react": minor
---

## The cards read alike, and the flow says what it knows

`Connect.Card` and `Connect.Prompt` share one anatomy: a squircle mark, the provider's display name,
the line about it directly under, and one action at the right. The mark spans both text rows and
centres against them at a size derived from the two line heights. Both cards sit on
`--domainkit-fill` with the dialog panel's inner room, and draw a border only where a host sets
`--domainkit-card-border`. A record's status is one badge that does not wrap, glyph beside word.

`Connect.holdsConnection` keeps the card, and the dialog it opened, on screen while a command it
started is still running. `Connect.offering` is false whenever `holdsConnection` is true, so what a
host reads and what a customer sees cannot disagree.

`Domain.Flow`'s `onState` fires whenever what DomainKit has to say about the domain changes, and
once on mount. `Domain.FlowState` carries `connected`, `offering`, `provider`, `receiptId`, and
`applied`, built from the same predicates the surface renders on. `connect="never"` hides the
prompt while a connected domain keeps its status and its disconnect, and for a domain no configured
provider serves and nothing holds, the flow renders no connection surface at all, so a host's own
offers follow in its own order. A host that wants the sentence renders `Connect.Status`, which names
the provider the customer knows rather than the id the wire carries.
