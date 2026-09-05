## domainkit@0.12.0

### Reconnecting keeps the connection it is about

`Connect.reconnect({ connectionId, method })` and `POST /connections/:connectionId/reconnections`
put a fresh credential behind the authorization a connection already points at. The connection
keeps its id and every domain stays attached to it, which is what a customer means when a provider
turns a credential down. Starting again could only mint a second account and then fail on the first
domain, because that domain is attached to the connection the provider rejected. The provider is
the connection's own; the zone check on every session still catches a credential that can no longer
reach a zone.

### The account is the unit of consent

`Server.StartPayload.domain` is optional. A start without one connects the account and attaches
nothing, and `Started.Connected` carries the connection it made: `connectionId`, `provider`, the
`label` the customer reads, and `snapshot` only when a domain was given.

`Connect.zones({ provider? })` and `GET /zones` list every zone the principal's connections reach
through `Provider.Session.listTargets`, ordered by zone, each with the connection that serves it
and the label the provider gave it. A connection whose credential the provider turned down is
reported once in the sibling `connections` array as `reconnect` and contributes no zones, so one
dead account never costs the customer the others. The reply also carries the provider catalog, so a
picker offers a new account without a second call.

`Storage.Attachment.label` holds the zone's label at attach time, across memory and Postgres
storage, and `Snapshot.attachment` replaces `attachmentId` with `{ id, label }`, so a surface names
the account the records go to without asking the provider again. `Transport.provisioning.receipt`
reads one apply receipt by id.

## domainkit@0.11.0

### A fake can read like a real provider

`Testing.provider` accepts `name`, the display name a customer reads, defaulting to `Fake <id>`.
`Testing.resolver` takes a second argument naming the resolver its answers carry, defaulting to
`fake`, and `Testing.transport` passes one through as `resolver`. A fixture whose screenshots ship
can then name a provider and an observer a customer would recognise.

### The snapshot counts the domains a connection serves

`Connect.Snapshot.connectionDomains` counts the attachments on this domain's connection, this
domain included, and is `0` without one. The discovery route and `Transport` carry it, so a surface
can ask whether letting the connection go takes other domains with it before it offers the choice.

### A stage can point Cloudflare's OAuth at its own origin

`Cloudflare.Options.oauth.issuer` names the origin Cloudflare serves `/oauth2/auth`,
`/oauth2/token`, and `/oauth2/revoke` beneath. It defaults to `https://dash.cloudflare.com` and
stays separate from `baseUrl`, because production serves consent from one host and the REST API
from another. `serverOrigin` names where the server reaches the exchange and the revocation when
that differs from where the browser reaches consent, such as an API in a container reaching an
emulator through `host.docker.internal`, and defaults to `issuer`.

Plaintext OAuth endpoints stay refused, which is right for every request carrying a client secret,
a code, or a token. Loopback is the one automatic exception: `localhost`, `*.localhost`, `::1`, and
`127.0.0.0/8` go nowhere and nothing can repoint them. Any other `http:` endpoint takes
`oauth.allowPlaintext`, because a name resolves wherever DNS or a hosts file says it does.

### A provider offers what a customer clicks through first

`Provider.describeMethods` returns a definition's methods in the order a UI presents them: OAuth,
then the integration, then the token. `Provider.methods` reads its kinds from the same list, so the
two never disagree, and a surface that renders the descriptor in order leads with the method a
customer clicks through and leaves the token they have to go and fetch for last.

## domainkit@0.10.0

### Discovery names the provider that hosts the zone

`Provider.Definition.nameservers` declares the hostname suffixes a provider's nameservers end in (Cloudflare `ns.cloudflare.com`, Vercel `vercel-dns.com`), and `Connect.discover` answers `NotFound` with `host: { provider }` naming the one registered provider whose suffixes cover every authoritative nameserver, or `null`. The discovery route and `Transport` carry the field, and `Testing.provider` accepts `nameserverSuffixes`.

### A rejected token reads as Unauthenticated

Cloudflare's HTTP 400 answers with code 6003 or 6111 (a malformed bearer token) and a 403 from its token verify endpoint fail `Reason.Unauthenticated` with Cloudflare's own message, as 401 does; Vercel's 403 `forbidden` on token verification does the same, while a 403 from zone listing stays `Forbidden`. The server answers 401, and `Testing.conformance.provider` gains a `rejected-token` case that authenticates empty secrets (or the `rejectedToken` values you pass) and expects `Unauthenticated`.

## domainkit@0.9.1

### Call the default fetch as a free function

`Transport.fromFetch` and `Resolver` resolve the default `fetch` from `globalThis` at call time and invoke it as a free function, so browsers no longer throw `Illegal invocation` when a host relies on the default fetch and a fetch polyfilled after construction is picked up.

## domainkit@0.9.0

### One Effect-native lifecycle: Connect, Provision, Cleanup, Verify

The root exports nineteen modules. Lifecycle services are `Connect`, `Provision`, `Cleanup`, and
`Verify`; host seams are `Storage`, `Custody`, and `Principal`; providers are declared with
`Provider.make` and registered through `DomainKit.layer({ providers })`. Every service module
exports `Service` and `Interface`, every schema-backed value exports `Model`, and every operation
fails with `DomainKit.Error` carrying one of sixteen `Reason` classes.

Plans are additive and digest-bound: `Provision.plan` reads provider state, `approve` records
consent, `reject` records refusal, and `apply` creates records under a durable attempt with a lease,
partial success in the success channel, and replay idempotency. `Cleanup` removes only what a receipt
proves DomainKit created. `Verify.observe` persists readiness per domain with a backoff ladder,
public DNS evidence that carries the observed values, and host evidence such as SES status; it
accepts the requirements to observe, so a domain with no attachment verifies too.
`Connect` owns token, OAuth, and integration connections with stored continuations, library-owned
refresh single-flighted through `Storage.withLock`, two-phase revocation, schema-declared token
fields, and `Connect.discover` for nameserver-based connection discovery.

`domainkit/server` mounts the whole lifecycle as one HttpApi group with fifteen routes, a host
`Identity` service with an optional per-route `authorize` hook, callbacks that follow the mount, and
`Server.toWebHandler` for hosts outside HttpApi. `domainkit/client` ships `Transport.fromFetch` with
capability groups. `domainkit/testing` ships fakes and the Storage and provider conformance suites.

Each root namespace is also a subpath export (`domainkit/Principal`, `domainkit/DnsRecord`, and the
rest) whose runtime and types resolve to the same unbundled module, so a host that emits
declarations names DomainKit types portably. Declarations ship one file per module.

Breaking: the Promise root, the sixteen error classes, `ManagedDnsConnections`, the Digest module,
and the two-route server are gone; hosts provide `Storage` and `Custody` beneath `DomainKit.layer`.

## domainkit@0.8.0

### Standardize callable constructors

Standardize trusted tagged-value construction on callable case constructors across the core and
React transport APIs. Aggregate schemas remain available for decoding serialized values.

## domainkit@0.7.0

### Expose callable constructors

Expose callable constructors for tagged DomainKit values. Effect and Promise integrations can
create plan operations, revocation states, and resolver outcomes without manually writing `_tag`
fields, while schemas remain available for validation and persistence.

## domainkit@0.6.0

### Add Effect-native server integration

Add `domainkit/server`, with Effect-native `make` and Layer APIs plus `createDomainKit` for async
hosts. Both paths mount the same Web handler for provider connection start and callback completion;
async hosts supply and own their persistence implementation.

### Refresh Cloudflare OAuth credentials

Add provider-owned Cloudflare OAuth credential refresh with refresh-token rotation, typed terminal
grant failures, and credential-scoped access-token expiry.

## domainkit@0.5.0

### Model provider connections and domain attachments

Replace the public domain-grant and provider-account deduplication model with
`ProviderConnection`, `ProviderTarget`, and `DomainAttachment`. Provider credentials may back
multiple explicitly linked organization connections, while exact domain attachments own DNS
operation authorization and disconnects revoke the shared provider authorization only after the
final organization connection is removed.

### Add provider target discovery

Add credential-scoped provider sessions for Cloudflare and Vercel. Providers can discover multiple
accounts and authoritative zones, report explicit target-selection outcomes, preserve provider
evidence, and bind DNS operations to an explicitly selected target. Vercel integrations use the
current `/v2/oauth/access_token` exchange and preserve configuration and personal/team context.

## domainkit@0.3.0

### Make Effect the canonical DomainKit API

Export Effect services, programs, providers, and schema-backed application transport contracts
from `domainkit`. Move the secondary Promise facade to `domainkit/promise` and remove duplicate
Effect and provider subpaths before the 0.3 release.

## domainkit@0.2.2

### Reuse an existing provider connection for another domain

Add `Connection.extend` to the Effect-native and Promise APIs. Hosts can extend an owner's stored
domain grant after proving provider ownership and obtaining consent, without repeating provider
authentication. Extension preserves existing grants and rejects cross-owner, expired, or revoking
connections.

## domainkit@0.2.1

### Preserve domain grants across reconnects

Preserve an owner's existing domain grants when the same provider account is connected again. This
lets one authorization safely provision additional domains without silently disconnecting earlier
domains.

## domainkit@0.2.0

### Publish the DomainKit 0.2 contract

DomainKit now provides one Effect-native authorization lifecycle, authoritative zone discovery,
resilient multi-resolver DNS observation, and a reusable provider conformance runner. Promise APIs
delegate to the same canonical implementation.

Generic provider contracts now live on the canonical `domainkit` and `domainkit/effect` entry
points. Cloudflare and Vercel retain explicit first-party provider subpaths; DomainKit does not
publish adapter subpaths or a third-party plug-in API.

## domainkit@0.1.1

### Discover Cloudflare accounts from authorized domains

Cloudflare OAuth and API-token authorization can now derive the selected account from a domain
visible to the credential. Hosts can offer a one-click connection flow without asking users to
find an account ID, while account-scoped DNS clients and explicit account authorization remain
available.

## domainkit@0.1.0

### DomainKit 0.1

Ship the first stable provider-independent DNS provisioning contract with Effect-native and Promise
APIs, reusable provider authorizations, and receipt-bound cleanup. The live-tested Cloudflare
adapter includes record lookup and deletion, while Vercel includes parent-zone discovery for
delegated subdomains. Support compatible Effect 4 release candidates.

### Detect Vercel DNS capability from intended nameservers

Discover DNS storage zones from Vercel integration responses that expose intended nameservers but
omit the optional zone flag.

### First beta

Ship the first public DomainKit contract with Effect-native and Promise APIs for portable DNS
provisioning plans, authorization, verification, and Cloudflare and Vercel provider adapters.

### Discover Vercel DNS storage zones

Treat Vercel domains with DNS storage enabled as manageable zones even when their public
nameservers remain external, enabling records beneath delegated subdomains.

### Resolve Vercel zones through direct domain discovery

Fall back to Vercel's domain configuration endpoints when an integration omits manageable zones
from the account listing, including parent DNS storage zones used by delegated subdomains.

### Authorize subdomains in parent DNS zones

Keep domain-scoped grants valid when a provider stores records in an authoritative parent zone,
while rejecting approved operations outside the granted domain subtree.

## domainkit@0.1.0-beta.1 (beta)

### Detect Vercel DNS capability from intended nameservers

Discover DNS storage zones from Vercel integration responses that expose intended nameservers but
omit the optional zone flag.

### Discover Vercel DNS storage zones

Treat Vercel domains with DNS storage enabled as manageable zones even when their public
nameservers remain external, enabling records beneath delegated subdomains.

### Resolve Vercel zones through direct domain discovery

Fall back to Vercel's domain configuration endpoints when an integration omits manageable zones
from the account listing, including parent DNS storage zones used by delegated subdomains.

### Authorize subdomains in parent DNS zones

Keep domain-scoped grants valid when a provider stores records in an authoritative parent zone,
while rejecting approved operations outside the granted domain subtree.

## domainkit@0.1.0-beta.0 (beta)

### First beta

Ship the first public DomainKit contract with Effect-native and Promise APIs for portable DNS
provisioning plans, authorization, verification, and Cloudflare and Vercel provider adapters.
