---
packages:
  domainkit: minor
  "@domainkit/react": minor
---

## Return customers to the application after a provider callback

`Server.layer` and `Server.toWebHandler` redirect live, authenticated cancellation and completion
failure to the validated saved `returnTo` or `defaultReturnTo`. The URL carries
`domainkit=cancelled|restart|inspect` and `domainkit-provider=<provider id>`, preserving other query
parameters and the fragment. Hosts relying on a typed error response for these classified outcomes
must handle the redirect hint or select their own destination with `Options.callback`. A policy
returning `undefined` uses this default; an explicit destination still wins. Invalid or expired
flows, host authentication failures, and faults before classification remain errors.

`CallbackRecovery.Model`, `read`, and `write` expose the shared browser-safe URL contract from
`domainkit`, `domainkit/CallbackRecovery`, and `domainkit/client`. `Connect.useRecovery()` in
`@domainkit/react` reads the hint after hydration and dismisses it without navigation. The message
catalog supplies recovery copy, and the registry domain flow and domain field show retry or account
inspection guidance. A hint authorizes no operation and never replays a grant.
