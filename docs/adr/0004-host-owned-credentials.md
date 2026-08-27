# 0004: Host-owned credentials

Status: Accepted

DomainKit defines OAuth, token, credential-vault, continuation-store, and grant contracts but does
not own a database, encryption key, route, or user prompt. OAuth protocol mechanics use
`oauth4webapi`; hosts provide secure persistence and transport.

Executor may later implement these contracts as an optional bridge. It is neither a runtime
dependency nor the source of DomainKit's provider interfaces.
