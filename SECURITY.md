# Security policy

DomainKit handles authorization material that can change public DNS. Do not include access tokens,
OAuth secrets, PKCE verifiers, raw credentials, or customer DNS data in issues, logs, fixtures, or
pull requests.

Please report vulnerabilities privately through GitHub's security advisory interface for
`AryaLabsHQ/domainkit`. Include the affected version, impact, and a minimal reproduction when safe.

`Connect` seals provider secret material through `Custody` before writing authorization credentials
to `Storage`. Other stored data is not sealed by `Custody`: OAuth continuation payloads include
PKCE verifiers. Hosts own durable storage, its access controls, keys or KMS configuration, key
rotation and credential re-sealing, audit logging, consent, and sweeping expired continuations.
