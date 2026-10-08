---
packages:
  domainkit: minor
---

## Derive provider registration requirements before connecting

Use `Server.registrationSettings({ providers, callbackBaseUrl })` to derive secret-free Cloudflare OAuth and Vercel Integration callback and authentication requirements from configured definitions, without credentials, identity, storage, or network access. Custom interactive providers can supply optional registration metadata; token-only providers return no settings.

Interactive starts reject empty credentials and malformed setup fields with redacted, field-specific `InvalidInput` errors before redirecting or writing a continuation. Vercel resolves its required credentials before redirect and again at completion to support rotation. Config resolution errors name the field without exposing the underlying configuration error. Configured callback bases must be HTTP(S) URLs without credentials, query, or fragment; emulator mount paths remain supported.
