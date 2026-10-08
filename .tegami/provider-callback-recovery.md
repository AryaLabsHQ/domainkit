---
domainkit: minor
---

## Choose authenticated callback destinations

Opt in through `Server.Options.callback` to select a same-origin destination from sanitized `Connected`, `Cancelled`, or `Failed` outcomes, or return `undefined` to preserve the default response. `Server.CallbackOutcome` provides the schema and type; `Connect.completeOutcome` exposes the shared locked completion result to Effect hosts while `Connect.complete` retains its result/error contract.

The completion lock verifies live owner, actor, and provider binding before classifying provider parameters. Invalid flow races answer with the same HTTP refusal and invoke no policy or exchange. Cancellation recognizes only `access_denied` and retains expiry, spending, and retry behavior. Connected means durable account access, not DNS readiness; failures can leave partial persistence and require inspection. Policy receives no raw callback data, secrets, or storage rows.
