---
packages:
  "@domainkit/react": minor
---

## The records table is the plan

Once a plan exists the page has one button, "Add N records", in the records header; each row reports
"Will add", "Already there", or "In the way"; and a conflict explains itself and says what to fix in
a row under the record it blocks. No review dialog opens.

`Domain.Flow` plans whenever the domain is attached with nothing applied to it yet, on load and on
every connection that lands, and hands `plan` and `provisioning` to the records slot. The `review`
prop and the `actions` slot are gone; `Provision.Dialog` stays exported for a host that wants the
standalone surface, and the flow never opens it.

`Records.Table` takes `plan` and `actions` and renders a header over the rows.
`Records.statusOf(record, { plan, readiness })` answers with the operation a pending plan holds or
the readiness last observed, for a host with its own table. `Provision.Action` approves and applies
in one press, says "Adding records…" while it runs, is disabled beside what to fix when every record
is blocked, and reports the outcome under the header.
