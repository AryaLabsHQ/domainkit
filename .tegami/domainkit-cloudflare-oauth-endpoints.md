---
packages:
  domainkit: patch
---

## A stage can point Cloudflare's OAuth at its own origin

`Cloudflare.Options.oauth.issuer` names the origin Cloudflare serves `/oauth2/auth`,
`/oauth2/token`, and `/oauth2/revoke` beneath. It defaults to `https://dash.cloudflare.com` and
stays separate from `baseUrl`, because production serves consent from one host and the REST API
from another. `serverOrigin` names where the server reaches the exchange and the revocation when
that differs from where the browser reaches consent, such as an API in a container reaching an
emulator through `host.docker.internal`, and defaults to `issuer`.

Plaintext OAuth endpoints stay refused, which is right for every request carrying a client secret,
a code, or a token. Loopback is the one automatic exception: `localhost`, `*.localhost`, `::1`, and
`127.0.0.0/8` go nowhere and nothing can repoint them. Any other `http:` endpoint takes
`oauth.allowPlaintext`, because a name resolves wherever DNS or a hosts file says it does.
