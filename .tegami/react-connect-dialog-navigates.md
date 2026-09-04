---
packages:
  "@domainkit/react": minor
---

## The connect dialog navigates

The dialog shows one decision at a time. Its header carries the provider's mark in `dialog-media`
and, where another provider is registered, a `dialog-provider-menu` that renames the dialog and
re-narrows it. The body leads with the method a customer clicks through, and "Use an API token
instead" swaps it for the token form with a `dialog-back` link above the fields. A provider that
offers a token alone opens on its form. The fields a provider does not need sit behind a Base UI
`Collapsible` reading "Add an account id", which announces `aria-expanded` and carries hover and
focus states; every quiet control in the dialog reads its spacing from `--domainkit-quiet-lead`,
`--domainkit-quiet-trail`, `--domainkit-quiet-inset`, and `--domainkit-quiet-pad`.

`Connect.Form` owns the values the customer types, keyed to the one domain and provider they typed
them into: a rejection keeps them, a connection that lands drops them, and they never follow the
flow to another domain. `Connect.State.Submitting` carries the discovery it started from, so a
narrowed dialog stays narrowed while its command runs.

A refused token answers under the field it is about. The input carries `aria-invalid`, the outcome
renders in `field-error` reading "Token not accepted", and the retry sits beside it on the same
row. `Messages.Outcome.description` is optional, and `Messages.failure` reads a reason without one
as a single sentence. Inline outcomes are a three-column grid, glyph then words then action, and
`outcome-header` is `display: contents` there so a host's own composition lands on the same grid.

Every dialog dismisses on a press outside it and holds while its own command is in flight, and a
closed dialog sets `pointer-events: none` while it plays its exit.
