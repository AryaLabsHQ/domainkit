## @domainkit/react@0.11.0

### The cards read alike, and the flow says what it knows

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

### Disconnecting is one dialog

`Connect.DisconnectDialog` asks once. It plans the cleanup on open from the domain's apply receipt
and lists the records it would remove under a Base UI `Switch` reading "Remove the N records
DomainKit added", checked by default; switched off the list stays legible, steps back, and says
"Records stay in {provider}." Where the connection serves more than one domain the dialog also asks
whether to detach this domain or end the connection. Confirming runs the cleanup, then the release,
with the progress and the outcome inside the dialog, and it holds while either is in flight.

The dialog carries `data-cleanup`, `"offered"` while it lists removals and `"none"` otherwise, and
takes `--domainkit-dialog-wide` in the first case and `--domainkit-dialog-width` in the second, so
it takes the room the records need and asks one question at one question's width. It owns its own
cleanup controller, because `Domain.Flow`'s refreshes the snapshot on a receipt and the release
still needs the connection the cleanup just used. `Cleanup.Flow` stays exported and the actions slot
still receives its controller.

### The plan lives in its dialog, and connecting opens it

Connecting is the customer saying yes to the records, so `Domain.Flow` plans and opens the review
the moment a connection lands for its domain, and `review="manual"` waits for the trigger instead.
`Connect.Controller.established` counts the connections a surface landed, a token connect or a load
that followed this library's own redirect back, and only ever grows, so the flow acts on a change
rather than a state that fires every render. The return is told from a reload by what the controller
wrote down before navigating away, so no host URL parameter carries it.

The page holds the "Review changes" trigger and the outcome; the operations, the consent sentence,
and the two decisions live in the dialog. Its primary action says what it will do, `Add N records`,
and approves and applies in one pass; a conflict is listed with its reason and the action approves
the rest by operation id, and with nothing addable it is disabled beside what to fix. `Decline` is
the other decision. The dialog closes from the × in its header and from a press outside it, so the
footer carries nothing else. On success it closes, the outcome compound reports the receipt, and
`onApplied` fires.

### The connect dialog navigates

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

## @domainkit/react@0.10.0

### A first-party connect experience

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

## @domainkit/react@0.9.0

### Domain.Flow with slots over a transport value

`DomainKit.Root` takes a `Transport.Interface` by value and keeps its identity stable; pass
`revision` to re-inspect. Every controller takes one options object and returns a named
`Controller` whose `State` is a tagged union carrying `Plan.Model`, `Approval.Model`,
`Receipt.Model`, and `DomainKit.Error`. `Domain.Flow` composes connection, records, verification,
provisioning, and cleanup from four slots with defaults: `connection` renders token fields from
the provider's declared descriptors, `records` and `verification` accept host replacements, and
`actions` renders Approve and Decline. Parts render only the capabilities the transport declares.
A failing DNS check shows the value it expected, what each observer found, and the observer's
detail line; an observer that never answered reports no values. A flow can run read-only, hiding every write
surface for a customer who may not change the domain, passes `returnTo` so an interactive connect
returns to the page it started from, and observes the requirements it was given. Failures render
through `Messages.Catalog`, one sentence per `Reason` tag; icons come from one
context; provider marks use host marks first with a local fallback and no runtime fetch.

Breaking: the stylesheet ships inside `@layer domainkit`, so host utilities win unless the host
orders its layers; `ManagedFlow`, per-component icon props, the layer-identity remount, and the
`scheduler`, `motion`, `react-grab`, and hugeicons dependencies are gone.

## @domainkit/react@0.8.0

### Standardize callable constructors

Standardize trusted tagged-value construction on callable case constructors across the core and
React transport APIs. Aggregate schemas remain available for decoding serialized values.

## @domainkit/react@0.7.0

### Make no-op provisioning explicit

Make provisioning review actions reflect no-op DNS plans and soften dialog focus styling.

## @domainkit/react@0.6.0

### Attach provider targets to domains

Keep provider account and zone targets explicit when one connection serves more than one customer
domain, so each attachment can be discovered and detached on its own.

### Load provider marks from integrations.sh

Use the shared integrations endpoint for known provider artwork and fall back to the provider's
initial when an image is unavailable. Hosts can still replace a mark through `DomainKit.Root`.

## @domainkit/react@0.5.0

### Adopt provider target attachments

Adopt credential-scoped provider connections, explicit provider-target attachments, and detached-domain lifecycle state.

## @domainkit/react@0.4.0

### Compose stable connected-domain actions

Compose review, cleanup, and disconnect actions into a stable connected-provider surface with host-owned semantic tokens.

### Add host theme presets

Add seven theme presets and token-complete workshop coverage for light and dark host integrations.

### Expose structured lifecycle events

Expose structured lifecycle events from `DomainKit.Root` after successful user-triggered mutations.

## @domainkit/react@0.3.1

### Keep the React package aligned with DomainKit core

Validate the packed React artifact against the current core version so releases cannot publish an
incompatible stale dependency range.

## @domainkit/react@0.3.0

### Compose connection rows with host controls

Separate the unstyled connection trigger from the packaged provider-marked recipe so applications
can use their own buttons, labels, and row layout without rebuilding the connection dialog.

### Run React lifecycle controllers through Effect Atom

Use the canonical `domainkit` transport service and an Effect layer at `DomainKit.Root`, replace
duplicated Promise transport models and manual request tracking with Effect Atom, and require React
19 for the 0.3 release.

### Compose lifecycle models

Expose Effect Atom models for every DNS lifecycle and add shared composable operation primitives.

### Publish Shadcn registry primitives

Document the model-free DomainKit Shadcn registry alongside the installed lifecycle library.

## @domainkit/react@0.1.1

### Show exact DNS operation values

Display record values and optional priority in provisioning and cleanup reviews so users can inspect
the complete DNS mutation before authorizing it.

## @domainkit/react@0.1.0

### Publish the DomainKit React 0.1 contract

Ship accessible React flows for connecting DNS providers, reviewing and applying record plans,
verifying DNS, removing managed records, and disconnecting domains. Applications can compose the
semantic parts, provide their own theme and icons, or use the complete default flows.

The package also includes host-free DNS record tables, cards, copy controls, status presentation,
and zone-file export, with a workshop for testing the components and theme contract.
