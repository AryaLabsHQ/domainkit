---
packages:
  "@domainkit/react": minor
---

## Disconnecting is one dialog

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
