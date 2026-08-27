# Security policy

DomainKit handles authorization material that can change public DNS. Do not include access tokens,
OAuth secrets, PKCE verifiers, raw credentials, or customer DNS data in issues, logs, fixtures, or
pull requests.

Please report vulnerabilities privately through GitHub's security advisory interface for
`AryaLabsHQ/domainkit`. Include the affected version, impact, and a minimal reproduction when safe.

The core package does not persist or encrypt credentials. Hosts are responsible for durable storage,
encryption, access control, audit logging, and secret rotation. DomainKit's interfaces intentionally
keep those responsibilities explicit.
