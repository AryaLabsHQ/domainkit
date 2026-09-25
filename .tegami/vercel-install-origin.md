---
packages:
  domainkit:
    type: minor
---

## A Vercel integration can start its install on another origin

`Vercel.provider`'s `integration` settings take an optional `installOrigin`, the origin of the
install page the browser is sent to. It defaults to `https://vercel.com`, so the flow still starts at
`https://vercel.com/integrations/<slug>/new`:

```ts
Vercel.provider({
  baseUrl: "http://localhost:4000/vercel",
  integration: {
    clientId: "emulated-client",
    clientSecret: Config.Redacted("VERCEL_CLIENT_SECRET"),
    slug: "acme-domains",
    installOrigin: "http://localhost:4000/vercel",
  },
});
```

An integration has one Redirect URL, so a development stage with its own origin cannot complete a
real install. With `installOrigin` and `baseUrl` pointed at an emulator, the whole install, the code
exchange, and the DNS API run locally, the same way Cloudflare's `oauth.issuer` already moves its
consent page. The option is additive; a definition without it keeps its behaviour.
