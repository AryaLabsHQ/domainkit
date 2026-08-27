# 0003: Additive digest-bound plans

Status: Accepted

Versioned JSON plans contain canonical operations and a deterministic SHA-256 digest. Authorization
binds that digest to an explicit set of operation identifiers. Apply rejects altered or unapproved
operations, checks for observed drift before the first write, and revalidates each operation before
creating its record.

Version 0.1 is additive only: a missing record may be created, an exact record is a no-op, and
incompatible state is a conflict. Record sets are exclusive by default. Hosts must opt into safe
coexistence where the record type allows it; CNAME remains exclusive.

Authoritative DNS APIs do not consistently expose conditional writes or multi-record transactions,
so the portable interpreter cannot eliminate the interval between its final read and a provider
write. Application is resumable rather than falsely atomic. If a later operation fails after an
approved create succeeds, `PartialApplyError` carries a versioned partial receipt with every known
successful provider record identifier. DomainKit never rolls those records back automatically:
rollback would be destructive, can also fail, and could remove state another actor now depends on.
