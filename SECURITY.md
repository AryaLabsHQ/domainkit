# Security policy

DomainKit handles authorization material that can change public DNS. Do not include access tokens,
OAuth secrets, PKCE verifiers, raw credentials, or customer DNS data in issues, logs, fixtures, or
pull requests.

Please report vulnerabilities privately through GitHub's security advisory interface for
`AryaLabsHQ/domainkit`. Include the affected version, impact, and a minimal reproduction when safe.

The library seals credentials through `Custody` before durable storage, and `Storage` stores
ciphertext only, never plaintext. Hosts own durable storage, keys, KMS configuration, rotation,
audit logging, and consent.
