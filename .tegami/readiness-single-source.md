---
packages:
  domainkit:
    type: minor
  "@domainkit/react":
    type: minor
---

## Stored readiness is the single fact; the host owns the clock and the projection

DomainKit's stored readiness is the one place a domain's observed state lives. The host decides when
to observe, reads the stored fact back, and projects it wherever its own surfaces need it.

### `Verify.Observer` tells the host when readiness was written

`Verify.Observer` is a reference-shaped seam with one method,
`readinessChanged({ domain, readiness, cause })`, where `cause` is `"observe"` or `"evidence"`. It
fires once per stored readiness, after the `Storage` write returns and outside any transaction. A
failure or defect in the observer is logged and swallowed, so a projection that breaks never costs
the observation. The default does nothing; provide one with
`Effect.provideService(Verify.Observer, ...)` or `Layer.succeed(Verify.Observer, ...)` over
`DomainKit.layer`.

### `Verify.latest` crosses the wire

`GET /domains/:domain/readiness` returns the stored readiness, or `null` when nothing has been
observed. `Transport.VerificationGroup.latest(domain)` reads it, so a browser surface can render the
last stored observation without making one of its own.

### `Verify.summary` and `Requirement.key`

`Verify.summary(readiness)` is a pure function over a readiness or `null`, returning
`{ observed, total, satisfied, missing, mismatch, unknown }`. Every requirement carries `key`, the
record's type, name, and data, which is the same string `@domainkit/react`'s `Records.identity`
produces, so a host pairs its own rows against readiness by content rather than by position.

### `Records.standingOf` replaces `Records.statusOf`

`Records.standingOf(record, { plan, readiness })` returns `{ planned, observed }`: the pending plan's
operation for that record, and the readiness requirement that covers it, evidence included. The two
facts no longer collapse into one, so a surface can show what a plan will do and what the observers
read back at the same time. The registry's records table renders a plan column only while a plan is
pending and takes its status column from the observation.

### `Domain.useFlow` and `Verify.useController` take host-supplied readiness

`verification: { readiness, observe? }` hands the flow a readiness the host already holds. The hook
then creates no observation on mount and sets no timer; `flow.verification.observe` and `retry` call
the host's `observe`, and drift replanning runs off the supplied value. Without the option both
hooks observe and poll exactly as before.
