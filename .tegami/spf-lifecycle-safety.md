---
packages:
  domainkit:
    type: minor
---

## Plan and verify SPF and exclusive records safely

**Breaking:** planning and verification now check safety constraints before they accept an exact
match. An exact match no longer hides an incompatible record beside it, so plans and observations
that were `Noop` or `satisfied` can now be a `Conflict` or a `mismatch`.

- **Exclusive names:** a requirement with `policy: "exclusive"` conflicts with an incompatible record in
  the same set, even when one existing record matches exactly.
- **CNAME and opaque records:** a CNAME sharing a name with an incompatible record is a
  `cname-collision`, including a provider record DomainKit could only read as `Opaque` CNAME data.
  Any opaque record in the requirement's set is an `opaque` conflict.
- **New reason:** `Plan.Conflict` has a new `reason`, `"spf-conflict"`. A custom catalog that
  matches every `Conflict` reason exhaustively must handle it, or it no longer typechecks.

`DnsRecord.spf` is a new constructor for a TXT requirement that carries an explicit, optional
`constraint: "spf"`. The record stays `append`, so unrelated TXT records at the same name coexist.
A name may hold only one SPF record, and it must be the one you require. DomainKit conflicts with
`spf-conflict` when the name already holds a different SPF record or more than one, including
identical duplicates. `spf` accepts everything `DnsRecord.txt` does except `policy`, and rejects a
value that does not start with the `v=spf1` version token. Plain `DnsRecord.txt` remains `append`
by default and does not enable the SPF constraint.

```ts
DnsRecord.spf({ name: "example.com", value: "v=spf1 include:_spf.mail.example ~all" });
```

DomainKit checks only that a value is an SPF record. Validating the policy inside it stays with
your application.

The quickstart now applies, observes, and plans again in one run. The second plan is
`Noop CNAME` and `Noop TXT`, and `Plan.isApplicable` is `false`:

```ts
const secondPlan = yield * Provision.plan({ domain: "app.example.com", requirements });
```
