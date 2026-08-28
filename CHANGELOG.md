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
