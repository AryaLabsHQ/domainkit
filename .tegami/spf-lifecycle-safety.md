---
packages:
  domainkit:
    type: minor
---

## Plan and verify SPF and exclusive records safely

**Breaking:** an exact DNS match no longer hides conflicting records. Exclusive requirements, CNAME
collisions, and opaque records can now produce a `Conflict` when planning or a `mismatch` when
verifying. Add `spf-conflict` to custom catalogs that handle every conflict reason.

Use `DnsRecord.spf` for SPF records. It conflicts when the name holds a different SPF record or more
than one, including identical duplicates, and leaves unrelated TXT records alone. Generic
`DnsRecord.txt` still defaults to `append` and does not enable the SPF constraint. DomainKit checks that a value is
SPF; validating the policy inside it stays with your application.

The quickstart now applies and re-plans in one run. The second plan has no writes to make.
