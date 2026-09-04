# Provider integrations

A provider integration turns one authoritative-DNS HTTP API into a `Provider.Definition`. It uses
Fetch, accepts host-owned credentials, and persists nothing: no secret storage, no consent UI, no
provider SDK.

## Cloudflare

Cloudflare offers API tokens and OAuth on one definition.

A **user token** spans every account it can reach. DomainKit verifies it, discovers the account from
the zones it can see, and records `tokenKind: "user"`, so one connection can serve domains in
several accounts. An **account-owned token** cannot be verified without naming its account, so the
token method declares an optional `accountId` field and verification runs against that account.

OAuth uses the authorization code flow against `dash.cloudflare.com`. The scope ids come from the
host's registered OAuth client; the default set is `zone:read`, `dns_records:edit`, and
`offline_access`. The credential packs the access and refresh tokens together, so refresh and
revocation need nothing from the host.

`oauth.issuer` names the origin those three endpoints hang off, `/oauth2/auth`, `/oauth2/token`,
and `/oauth2/revoke`, so a stage points consent at an emulator that mounts the same paths and runs
the code path a customer does. It stays separate from `baseUrl` because in production these are
different hosts: `dash.cloudflare.com` for OAuth, `api.cloudflare.com/client/v4` for the REST API.

Consent is the browser's request and the exchange is the server's, so a stage where those reach the
same emulator by different names gives `oauth.serverOrigin` as well: the authorize URL keeps
deriving from `issuer`, while `/oauth2/token` and `/oauth2/revoke` derive from `serverOrigin`. It
defaults to `issuer`, so a stage where one name works for both names it once.

DomainKit requires HTTPS for every OAuth request. Loopback is the one automatic exception: it goes
nowhere and nothing can repoint it. A plaintext endpoint reached by any other name, such as an
emulator at `host.docker.internal`, takes `oauth.allowPlaintext`, because a hosts file can point a
name anywhere and the name alone proves nothing. That flag is for a development stage: with it the
client secret, the code, and the tokens cross the network in the clear.

Cloudflare's token verification does not enumerate DNS permissions, so the capability claim records
what the definition requires rather than what the token proves. A token without `dns_records:edit`
verifies and fails at the first write with `Forbidden`.

Targets carry the Cloudflare zone id and the nameservers Cloudflare reports. A target with no zone
id cannot hold records and fails `Unsupported`. Existing proxied records are readable; every record
DomainKit creates is DNS-only.

## Vercel

Vercel offers personal and team access tokens and its own integration install flow.

A token connection stores `{ teamId }`, `null` for a personal account. Team requests carry `teamId`;
personal ones do not.

The integration flow starts at the integration's install URL and exchanges a one-time callback code
at Vercel's token endpoint. DomainKit models it as an integration method rather than claiming it is
the OAuth flow Cloudflare uses. The callback's team is checked against the exchanged token, so an
install reporting a different team fails `Unauthenticated`.

A Vercel domain is a target when Vercel hosts its DNS. Current and intended nameservers are provider
evidence and never substitute for an independent public DNS observation.

## Portable behaviour

Both adapters support `A`, `AAAA`, `CAA`, `CNAME`, `MX`, `NS`, `SRV`, and `TXT`. A provider record
DomainKit cannot model is kept as `DnsRecord.Opaque` during reads, so planning sees it, refuses to
overwrite it, and reports a conflict. Provider APIs still enforce their own collision rules.

Planning is additive everywhere: exact records are no-ops, missing records are creates, and
incompatible state is a conflict with no automatic update or delete.

Provider responses are decoded at the HTTP boundary and classified into `Reason` values with the
credential stripped. A provider status or error code stays as diagnostic metadata; a raw response
body never reaches a `DomainKit.Error`.

## Conformance

`Testing.conformance.provider(definition, credential, zone)` from `domainkit/testing` exercises
create and read back, exact no-op, conflict, stale plan, and partial apply against a real account,
through the same `Provision` and `Cleanup` services a host uses. Every record it writes carries the
prefix and is removed again.

`bun run test:live:cloudflare` and `bun run test:live:vercel` run it from this package. They are
opt-in, never run in CI, and write to a zone the operator names twice.
