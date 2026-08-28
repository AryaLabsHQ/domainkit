# Provider adapters

DomainKit's provider adapters translate documented authoritative-DNS APIs into the same portable
record and provisioning contracts. They use Fetch and accept host-owned credentials; they do not
persist secrets, render consent UI, or depend on a provider SDK.

## Cloudflare

Cloudflare authorization accepts either an explicit account ID or a domain visible to the
credential. Domain-based authorization queries the requested name and its parent zone candidates,
nearest first, and succeeds only when exactly one accessible authoritative zone identifies the
account. This lets OAuth and API-token flows avoid asking users to find an account ID while failing
closed when the credential cannot identify the requested domain unambiguously.

After authorization, Cloudflare DNS clients remain explicitly account-scoped. The capability claim
records what the host requested when it issued or authorized the credential because Cloudflare's
non-mutating token verification response does not enumerate DNS permissions.

Domain-targeted token validation supports both user-owned and account-owned API tokens. User tokens
are verified before discovery; account tokens discover the account from the authorized zone first
and then use Cloudflare's account-scoped verification endpoint.

Cloudflare's adapter supports API tokens and standards-based OAuth authorization code flow. OAuth
scope IDs come from the OAuth client registration and are supplied by the host rather than
hard-coded by DomainKit. Existing proxied records are readable, while every record created by
DomainKit is DNS-only.

## Vercel

Vercel clients require an explicit personal or team context. Team clients add `teamId` to resource
requests; personal clients do not. Only domains whose `serviceType` says Vercel handles DNS are
exposed as authoritative zones. Current nameservers are retained as provider evidence, while
intended nameservers are not treated as observed authority.

Vercel supports personal access tokens and its provider-specific integration installation flow.
That flow begins at the integration install URL and exchanges the one-time callback code at
Vercel's token endpoint. DomainKit models it as an integration method instead of claiming that it
is the same generic OAuth flow used by Cloudflare. The returned personal or team context remains
attached to the credential result.

## Portable behavior

Both adapters support `A`, `AAAA`, `CAA`, `CNAME`, `MX`, `NS`, `SRV`, and `TXT`. Provider-only record
types are ignored during portable reads, while provider APIs still enforce their native collision
rules. Planning remains additive: exact records no-op, missing records create, and incompatible
state conflicts without an automatic update or delete.

Provider errors are decoded at the HTTP boundary, classified into portable reasons, and stripped
of request credentials. Provider status and error codes remain diagnostic metadata without leaking
raw response DTOs into the planning contract.
