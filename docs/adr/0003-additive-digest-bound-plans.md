# 0003: Additive digest-bound plans

Status: Accepted

Versioned JSON plans contain canonical operations and a deterministic SHA-256 digest. Authorization
binds that digest to an explicit set of operation identifiers. Apply rejects stale, altered, or
unapproved operations.

Version 0.1 is additive only: a missing record may be created, an exact record is a no-op, and
incompatible state is a conflict. Record sets are exclusive by default. Hosts must opt into safe
coexistence where the record type allows it; CNAME remains exclusive.
