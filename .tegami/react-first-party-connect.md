---
packages:
  "@domainkit/react": minor
---

## A first-party connect experience

`Outcome` is a compound part: media, title, description, and the action, as a card or on one line.
Every flow's `X.Outcome` binds its controller to it, and a host recomposes it with its own parts
while the words stay in the catalog. `Messages.Catalog` returns a `{ title, description }` pair per
`DomainKit.Error` reason, and `Messages.outcome` reads it.

A failed connect keeps its context. `Connect.State.Failure` carries the snapshot, the discovery, and
the provider and method that were in flight, so the dialog keeps its description, its provider
forms, and the values already typed, and answers beside the method that failed.

A rejected token answers under the field it is about: the input carries `aria-invalid`, the outcome
renders in `field-error`, and its title names the provider the customer acted on.
