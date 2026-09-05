---
packages:
  "@domainkit/react": minor
---

## A second domain on a connected account never sees Connect again

`Connect.useController` attaches on sight: when it settles `Disconnected` with a `Resolved`
discovery on a surface that is not read-only, it attaches the domain to that connection and zone
straight away, and `established` grows so the flow plans. Each domain, connection, and zone is tried
once, so an attach that failed and a detach the customer chose both stand. Two connections that both
reach the zone stay a decision, and `SelectionRequired` keeps the prompt.

The prompt statement says what was found, `messages.hostDetected` ("Cloudflare DNS detected"), and
the connected card reads "{Provider} · {attachment.label}" with "N added" from the domain's apply
receipt, under the parts `connected-label` and `connected-applied`. The controller reads that
receipt once per receipt id and keeps it.
