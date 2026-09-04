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

The disconnected state names the provider that serves the domain. `Connect.Prompt` renders the
provider's mark, its name, and "Owns DNS for this domain." beside a `Connect` trigger, and the
dialog behind it is titled after that provider and shows its methods alone, with the rest behind
"Use a different provider". With no host the flow offers nothing unless it is given
`connect="always"`. Token fields take shadcn's `Field` anatomy, method buttons carry the verb, and
the fields a provider does not need sit behind "Need an account id?".
