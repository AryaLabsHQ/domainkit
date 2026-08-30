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
