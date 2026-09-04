---
packages:
  "@domainkit/react": minor
---

## A first-party connect experience

`Outcome` is a compound part: media, title, description, and the action, as a card or on one line.
Every flow's `X.Outcome` binds its controller to it, and a host recomposes it with its own parts
while the words stay in the catalog. `Messages.Catalog` returns a `{ title, description }` pair per
`DomainKit.Error` reason, and `Messages.outcome` reads it.
