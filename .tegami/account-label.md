---
packages:
  domainkit:
    type: minor
---

## A connection carries the name of the account it reaches

Listing accounts could only name them by provider: `Connect.zones` answered a `connections` entry
of `connectionId`, `provider`, and `status`, so a customer holding two Cloudflare accounts read
"Cloudflare" twice and had to open one to tell them apart.

A provider now names the account when it issues a credential. `Provider.IssuedCredential` takes an
optional `label`, `Connect` stores it on the authorization at connect and reconnect time, and every
listing of accounts carries it:

```ts
interface ZoneConnection {
  readonly connectionId: string;
  readonly provider: string;
  /** "Acme Inc" when the provider named the account; null when it named none. */
  readonly label: string | null;
  readonly status: "connected" | "reconnect";
}
```

The same field crosses the wire on `GET /zones`, so `Transport.Zones["connections"][number]` and
`@domainkit/react`'s `Connect.Account` carry `label` without a second call. `Server.Connected` now
prefers it too: a start with no domain names the account instead of the provider, and a start that
attached a domain still names the zone.

Cloudflare fills it. Connecting reads the account from the zones the credential sees, so a
credential inside one account carries that account's Cloudflare name and one spanning several
accounts names none. A token pinned with `accountId` is named from that account's zones, and a
pinned token that reaches no zone connects unnamed rather than failing over a label. Providers that
name no account, including Vercel, answer `null`, and so does `Testing.provider` until a test sets
`accountLabel`.

The field is additive. A provider definition that returns no `label` keeps compiling, and
`@domainkit/capsuledb` adds a nullable `label` column to `domainkit_authorizations`, which rows
written before it read as `null`. `Storage.Authorization` now requires `label`, so a host that
implements `Storage` itself supplies it; the conformance suite checks that it survives the round
trip.
