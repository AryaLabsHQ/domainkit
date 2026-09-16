---
packages:
  domainkit:
    type: minor
---

## Security: the provider callback binds to the flow that started it

`GET /callback/:provider` now establishes whose connection it is finishing from the continuation
DomainKit recorded, and refuses a callback presented by anyone other than the session that started
it.

Before, the callback resolved `Identity.principal` first and then read the continuation through the
owner-scoped `Storage.continuations.get`, which checks the owner and nothing else. Within one
organization, any administrator whose browser followed the provider's redirect completed the
connection, and the resulting authorization was recorded as theirs. That is latent in every released
`0.12.x`. There is no known external consumer and no advisory or CVE is being filed, but a host that
sees new refusals after upgrading is seeing this check.

Now the handler reads the flow's header before it resolves identity, and the resolved principal must
match the recorded `ownerId` **and** `actorId`, with the recorded provider matching the route. A
callback that names no flow, one that has expired, one presented at another provider's route, and
one presented by a session that did not start it are all the same `InvalidInput` refusal with the
same text, and the host authenticates before any of them, so nothing distinguishes "no such flow"
from "not your flow". The refusal leaves the flow unspent, so the person who started it can still
finish it.

### `Identity.principal` takes an optional second argument

`Server.IdentityContext` carries the endpoint being served and the continuation header, and arrives
on the callback alone. A host that takes one argument keeps compiling and keeps being checked; a
host whose session can hold several tenants reads `context.continuation.ownerId` to land the
callback on the right one. The doctrine is unchanged: the request still does not name its own owner,
DomainKit's durable record does, and the `state` only points at it.

### `Storage.continuations.header` is a new required method

`header(id)` returns a flow's `ownerId`, `actorId`, `provider`, and `expiresAt` and takes no
`Principal` — the one read in the interface that is not tenant-scoped, and the reason for the minor
bump. It never returns `payload`, which holds the PKCE `codeVerifier`, and it enforces the TTL
exactly as `get` does. It is a read, not a spend, so a leaked `state` cannot burn the flow it names.
`get` and `consume` keep their owner filters, so a host that resolves a wrong principal still fails
closed. Implemented in `Storage.layerMemory` and `@domainkit/capsuledb`; a host on
`Storage.layerFromAsync` implements it too, and `Testing.conformance.storage` covers it.
