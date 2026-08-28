# Contributing

DomainKit defines a small, auditable public contract for DNS provisioning. Changes should keep
provider APIs, host storage, and product UI outside the core protocol unless an accepted architecture
decision says otherwise.

## Development

Use Bun 1.4 and Node.js 24.10 or newer:

```sh
bun install --frozen-lockfile
bun run release:check
```

Add focused tests for observable behavior and document exported APIs. Pull requests should contain
one coherent change and explain any public contract change.

## Live provider conformance

The live harness is opt-in and never runs in CI. It validates a credential, builds a DNS plan, and
prints the plan without mutating provider state:

```sh
bun run test:live:cloudflare preview
bun run test:live:vercel preview
```

Both providers require these environment variables:

- `DOMAINKIT_LIVE_ZONE`
- `DOMAINKIT_LIVE_RECORD_NAME`
- `DOMAINKIT_LIVE_RECORD_VALUE`
- `DOMAINKIT_LIVE_ALLOW_ZONE`, exactly matching the zone
- `DOMAINKIT_LIVE_ALLOW_RECORD_NAME`, exactly matching the record name

Cloudflare additionally requires `DOMAINKIT_LIVE_CLOUDFLARE_ACCOUNT_ID` and
`DOMAINKIT_LIVE_CLOUDFLARE_TOKEN`. Vercel requires `DOMAINKIT_LIVE_VERCEL_TEAM_ID` and
`DOMAINKIT_LIVE_VERCEL_TOKEN`. Keep credentials in a local secret manager or scoped process
environment; never commit them.

To apply a reviewed plan, set `DOMAINKIT_LIVE_APPROVED_DIGEST` to the digest printed by `preview`
and replace `preview` with `apply`. The harness recomputes the plan and refuses to apply if the
digest, zone allowlist, or record-name allowlist differs. Apply creates DNS state and does not delete
it, so use an explicitly disposable record and clean it up through the provider when testing ends.

## Compatibility

While the public contract is pre-1.0, APIs may change directly. Once a stable contract is declared,
breaking changes will be explicit and versioned.
