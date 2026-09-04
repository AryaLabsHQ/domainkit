import { assert, describe, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { Cloudflare, DnsRecord, Provider } from "../../../src/index.ts";
import { bail, recordedFetch } from "../recorded-fetch.ts";
import { activeToken, failure, page, single, zone } from "./fixtures.ts";

const token = Redacted.make("cf-token");
const credential = (
  context: Cloudflare.AccountContext = { accountId: "account-1" },
): Provider.Credential => ({
  secret: token,
  context,
});
const target: Provider.Target = {
  zone: "example.com",
  context: { accountId: "account-1", zoneId: "zone-1" },
  label: "example.com (Example Account)",
};

describe("Cloudflare.provider", () => {
  it("offers tokens only unless OAuth is configured", () => {
    assert.deepStrictEqual(Provider.methods(Cloudflare.provider()), ["token"]);
    assert.deepStrictEqual(Cloudflare.provider().nameservers, ["ns.cloudflare.com"]);
    assert.deepStrictEqual(
      Provider.methods(
        Cloudflare.provider({ oauth: { clientId: "c", clientSecret: Redacted.make("s") } }),
      ),
      ["oauth", "token"],
    );
  });

  it.effect("authenticates a user token from its zones and verify endpoint", () => {
    const recording = recordedFetch([
      { body: page([zone]), expect: { pathname: "/client/v4/zones" } },
      { body: activeToken, expect: { pathname: "/client/v4/user/tokens/verify" } },
    ]);
    const definition = Cloudflare.provider({ fetch: recording.fetch });
    return Effect.gen(function* () {
      const issued = yield* (definition.auth.token ?? bail("token")).authenticate({ token });
      assert.deepStrictEqual(issued.context, { accountId: "account-1", tokenKind: "user" });
      assert.strictEqual(Redacted.value(issued.secret), "cf-token");
      assert.ok(issued.expiresAt !== null);
      assert.strictEqual(
        new Headers(recording.requests[0]?.init?.headers).get("authorization"),
        "Bearer cf-token",
      );
    });
  });

  it.effect("falls back to account verification for account-owned tokens", () => {
    const recording = recordedFetch([
      { body: page([zone]) },
      { body: failure(1000, "Invalid API Token"), init: { status: 401 } },
      {
        body: single({ id: "token-2", status: "active" }),
        expect: { pathname: "/client/v4/accounts/account-1/tokens/verify" },
      },
    ]);
    return Effect.gen(function* () {
      const definition = Cloudflare.provider({ fetch: recording.fetch });
      const issued = yield* (definition.auth.token ?? bail("token")).authenticate({ token });
      assert.strictEqual(issued.expiresAt, null);
      assert.deepStrictEqual(issued.context, { accountId: "account-1", tokenKind: "account" });
    });
  });

  it.effect("verifies an account-owned token against the declared account id", () => {
    const recording = recordedFetch([
      { body: activeToken, expect: { pathname: "/client/v4/accounts/account-9/tokens/verify" } },
    ]);
    const definition = Cloudflare.provider({ fetch: recording.fetch });
    return Effect.gen(function* () {
      const issued = yield* (definition.auth.token ?? bail("token")).authenticate({
        token,
        accountId: Redacted.make("account-9"),
      });
      assert.deepStrictEqual(issued.context, { accountId: "account-9", tokenKind: "account" });
      assert.ok(issued.expiresAt !== null);
      assert.deepStrictEqual(Provider.describeMethods(definition)[0]?.fields, [
        { name: "token", required: true, secret: true },
        { name: "accountId", required: false, secret: false },
      ]);
    });
  });

  it.effect("rejects a token that cannot list zones", () => {
    const recording = recordedFetch([
      { body: failure(9109, "Unauthorized"), init: { status: 401 } },
    ]);
    return Effect.gen(function* () {
      const definition = Cloudflare.provider({ fetch: recording.fetch });
      const error = yield* (definition.auth.token ?? bail("token"))
        .authenticate({ token })
        .pipe(Effect.flip);
      assert.strictEqual(error.reason._tag, "Unauthenticated");
    });
  });

  it.effect(
    "reads a malformed or forbidden token as Unauthenticated with Cloudflare's text",
    () => {
      const recording = recordedFetch([
        { body: failure(6003, "Invalid request headers"), init: { status: 400 } },
        { body: failure(6111, "Invalid format for Authorization header"), init: { status: 400 } },
        { body: failure(9109, "Invalid access token"), init: { status: 403 } },
        { body: failure(9109, "Unauthorized to access requested resource"), init: { status: 403 } },
      ]);
      const definition = Cloudflare.provider({ fetch: recording.fetch });
      const auth = definition.auth.token ?? bail("token");
      return Effect.gen(function* () {
        const malformed = yield* auth.authenticate({ token }).pipe(Effect.flip);
        assert.strictEqual(malformed.reason._tag, "Unauthenticated");
        assert.strictEqual(malformed.reason.message, "Invalid request headers");
        const badFormat = yield* auth.authenticate({ token }).pipe(Effect.flip);
        assert.strictEqual(badFormat.reason._tag, "Unauthenticated");
        const forbidden = yield* auth
          .authenticate({ token, accountId: Redacted.make("account-9") })
          .pipe(Effect.flip);
        assert.strictEqual(forbidden.reason._tag, "Unauthenticated");
        assert.strictEqual(forbidden.reason.message, "Invalid access token");
        // A 403 while listing zones is a missing permission, which stays Forbidden.
        const noZoneRead = yield* auth.authenticate({ token }).pipe(Effect.flip);
        assert.strictEqual(noZoneRead.reason._tag, "Forbidden");
      });
    },
  );

  it.effect("lists targets across accounts and resolves domains to the most specific zone", () => {
    const other = { ...zone, id: "zone-2", account: { id: "account-2", name: "Other" } };
    const child = { ...zone, id: "zone-3", name: "mail.example.com" };
    const recording = recordedFetch([
      { body: page([zone, other, child, { ...zone, id: "zone-4", type: "internal" }]) },
    ]);
    const session = Cloudflare.provider({ fetch: recording.fetch }).session(
      credential({ accountId: null }),
    );
    return Effect.gen(function* () {
      const targets = yield* session.listTargets();
      assert.deepStrictEqual(
        targets.map(({ zone: name, context }) => ({ name, context })),
        [
          { name: "example.com", context: { accountId: "account-1", zoneId: "zone-1" } },
          { name: "example.com", context: { accountId: "account-2", zoneId: "zone-2" } },
          { name: "mail.example.com", context: { accountId: "account-1", zoneId: "zone-3" } },
        ],
      );
    });
  });

  it.effect("reports ambiguity, resolution, and missing zones", () => {
    const other = { ...zone, id: "zone-2", account: { id: "account-2", name: "Other" } };
    const child = { ...zone, id: "zone-3", name: "mail.example.com" };
    const definition = Cloudflare.provider({
      fetch: recordedFetch([
        { body: page([zone, other, child]) },
        { body: page([zone, other, child]) },
        { body: page([zone, other, child]) },
      ]).fetch,
    });
    const session = definition.session(credential({ accountId: null }));
    return Effect.gen(function* () {
      const ambiguous = yield* session.resolveTarget("app.example.com");
      assert.strictEqual(ambiguous._tag, "SelectionRequired");
      const resolved = yield* session.resolveTarget("x.mail.example.com");
      assert.strictEqual(resolved._tag, "Resolved");
      if (resolved._tag === "Resolved")
        assert.strictEqual(resolved.target.zone, "mail.example.com");
      const missing = yield* session.resolveTarget("example.net");
      assert.strictEqual(missing._tag, "NotFound");
    });
  });

  it.effect("scopes zone listing to the authorized account", () => {
    const recording = recordedFetch([{ body: page([zone]) }]);
    const session = Cloudflare.provider({ fetch: recording.fetch }).session(credential());
    return Effect.gen(function* () {
      yield* session.listTargets();
      assert.ok(recording.requests[0]?.url.includes("account.id=account-1"));
    });
  });

  it.effect("lists, decodes, creates, reads, and deletes records inside the zone", () => {
    const recording = recordedFetch([
      {
        body: page(
          [
            {
              id: "r1",
              name: "app.example.com",
              type: "CNAME",
              content: "edge.acme.dev",
              ttl: 1,
              proxied: false,
            },
            {
              id: "r2",
              name: "example.com",
              type: "CAA",
              ttl: 300,
              data: { flags: 0, tag: "issue", value: "letsencrypt.org" },
            },
          ],
          1,
          2,
        ),
      },
      {
        body: page(
          [
            {
              id: "r3",
              name: "_sip._tcp.example.com",
              type: "SRV",
              ttl: 60,
              data: { port: 5060, priority: 10, target: "sip.example.com", weight: 5 },
            },
            { id: "r4", name: "example.com", type: "HTTPS", ttl: 1, content: "1 . alpn=h2" },
            { id: "r5", name: "other.example.net", type: "TXT", ttl: 1, content: "outside" },
          ],
          2,
          2,
        ),
      },
      {
        body: single({ id: "r6", name: "new.example.com", type: "TXT", content: "v", ttl: 1 }),
        expect: { method: "POST", pathname: "/client/v4/zones/zone-1/dns_records" },
      },
      {
        body: failure(81044, "Record does not exist."),
        init: { status: 404 },
        expect: { pathname: "/client/v4/zones/zone-1/dns_records/missing" },
      },
      {
        body: single({ id: "r6" }),
        expect: { method: "DELETE", pathname: "/client/v4/zones/zone-1/dns_records/r6" },
      },
    ]);
    const dns = Cloudflare.provider({ fetch: recording.fetch }).session(credential()).dns(target);
    return Effect.gen(function* () {
      const records = yield* dns.list("example.com");
      assert.deepStrictEqual(
        records.map(({ record, providerRecordId }) => [
          providerRecordId,
          record._tag,
          record._tag === "Opaque" ? record.type : DnsRecord.data(record),
        ]),
        [
          ["r1", "CNAME", "edge.acme.dev"],
          ["r2", "CAA", "0 issue letsencrypt.org"],
          ["r3", "SRV", "10 5 5060 sip.example.com"],
          ["r4", "Opaque", "HTTPS"],
        ],
      );
      assert.strictEqual(records[0]?.record._tag === "CNAME" ? records[0].record.ttl : -1, null);
      const created = yield* dns.create(
        "example.com",
        DnsRecord.txt({ name: "new.example.com", value: "v" }),
      );
      assert.strictEqual(created.providerRecordId, "r6");
      assert.deepStrictEqual(JSON.parse(String(recording.requests[2]?.init?.body)), {
        name: "new.example.com",
        proxied: false,
        ttl: 1,
        type: "TXT",
        content: "v",
      });
      assert.strictEqual(yield* dns.get("example.com", "missing"), null);
      yield* dns.delete("example.com", "r6");
    });
  });

  it.effect("classifies provider failures by status", () => {
    const recording = recordedFetch([
      {
        body: failure(10000, "Rate limited"),
        init: { status: 429, headers: { "retry-after": "2" } },
      },
      { body: failure(81057, "Record already exists."), init: { status: 400 } },
      {
        body: "<html>",
        json: false,
        init: { status: 502, headers: { "content-type": "text/html" } },
      },
      { body: failure(9106, "Missing X-Auth-Key"), init: { status: 403 } },
      { body: failure(9000, "Conflict"), init: { status: 409 } },
      { body: failure(1003, "Invalid or missing zone id."), init: { status: 400 } },
    ]);
    const dns = Cloudflare.provider({ fetch: recording.fetch }).session(credential()).dns(target);
    return Effect.gen(function* () {
      const limited = yield* dns.list("example.com").pipe(Effect.flip);
      assert.strictEqual(limited.reason._tag, "ProviderUnavailable");
      if (limited.reason._tag === "ProviderUnavailable")
        assert.strictEqual(limited.reason.retryAfterMs, 2_000);
      const rejected = yield* dns
        .create("example.com", DnsRecord.txt({ name: "x.example.com", value: "v" }))
        .pipe(Effect.flip);
      assert.strictEqual(rejected.reason._tag, "ProviderConflict");
      if (rejected.reason._tag === "ProviderConflict")
        assert.strictEqual(rejected.reason.code, "81057");
      const html = yield* dns.list("example.com").pipe(Effect.flip);
      assert.strictEqual(html.reason._tag, "ProviderUnavailable");
      const forbidden = yield* dns.list("example.com").pipe(Effect.flip);
      assert.strictEqual(forbidden.reason._tag, "Forbidden");
      const conflict = yield* dns.list("example.com").pipe(Effect.flip);
      assert.strictEqual(conflict.reason._tag, "ProviderConflict");
      const bad = yield* dns.list("example.com").pipe(Effect.flip);
      assert.strictEqual(bad.reason._tag, "ProviderRejected");
      if (bad.reason._tag === "ProviderRejected") assert.strictEqual(bad.reason.code, "1003");
      const noZone = Cloudflare.provider({ fetch: recording.fetch })
        .session(credential())
        .dns({ zone: "example.com", context: { accountId: "account-1" }, label: "x" });
      const unsupported = yield* noZone.list("example.com").pipe(Effect.flip);
      assert.strictEqual(unsupported.reason._tag, "Unsupported");
    });
  });

  it.effect("runs the OAuth flow with PKCE and packs both tokens into the secret", () => {
    const recording = recordedFetch([
      {
        body: {
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3_600,
          token_type: "bearer",
        },
        expect: { method: "POST", pathname: "/oauth2/token" },
      },
      { body: page([zone]), expect: { pathname: "/client/v4/zones" } },
    ]);
    const definition = Cloudflare.provider({
      fetch: recording.fetch,
      oauth: { clientId: "client-1", clientSecret: Redacted.make("secret"), scopes: ["zone:read"] },
    });
    return Effect.gen(function* () {
      const oauth = definition.auth.oauth ?? bail("oauth");
      const started = yield* oauth.start({
        state: "state-1",
        callbackUrl: "https://app.example/cb",
        codeChallenge: "chal",
      });
      const url = new URL(started.authorizationUrl);
      assert.strictEqual(url.origin + url.pathname, "https://dash.cloudflare.com/oauth2/auth");
      assert.strictEqual(url.searchParams.get("code_challenge"), "chal");
      assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
      assert.strictEqual(url.searchParams.get("state"), "state-1");
      assert.strictEqual(url.searchParams.get("scope"), "zone:read");
      assert.strictEqual(url.searchParams.get("redirect_uri"), "https://app.example/cb");
      const issued = yield* oauth.complete({
        code: "code-1",
        callbackUrl: "https://app.example/cb",
        codeVerifier: "verifier",
        params: { state: "state-1", code: "code-1" },
      });
      assert.deepStrictEqual(JSON.parse(Redacted.value(issued.secret)), {
        accessToken: "access-1",
        refreshToken: "refresh-1",
      });
      assert.deepStrictEqual(issued.context, { accountId: "account-1" });
      assert.ok(issued.expiresAt !== null);
      const tokenRequest = new URLSearchParams(String(recording.requests[0]?.init?.body));
      assert.strictEqual(tokenRequest.get("grant_type"), "authorization_code");
      assert.strictEqual(tokenRequest.get("code_verifier"), "verifier");
      assert.strictEqual(
        new Headers(recording.requests[1]?.init?.headers).get("authorization"),
        "Bearer access-1",
      );
    });
  });

  it.effect("derives consent, exchange, and revocation from the issuer the host configured", () => {
    const recording = recordedFetch([
      {
        body: { access_token: "access-1", refresh_token: "refresh-1", token_type: "bearer" },
        expect: { method: "POST", pathname: "/cloudflare/oauth2/token" },
      },
      { body: page([zone]), expect: { pathname: "/cloudflare/client/v4/zones" } },
      { body: {}, expect: { method: "POST", pathname: "/cloudflare/oauth2/revoke" } },
    ]);
    const definition = Cloudflare.provider({
      // The emulator serves both, but they are different hosts in production, so they stay apart.
      baseUrl: "http://localhost:8788/cloudflare/client/v4",
      fetch: recording.fetch,
      oauth: {
        clientId: "client-1",
        clientSecret: Redacted.make("secret"),
        issuer: "http://localhost:8788/cloudflare",
      },
    });
    return Effect.gen(function* () {
      const oauth = definition.auth.oauth ?? bail("oauth");
      const started = yield* oauth.start({
        state: "state-1",
        callbackUrl: "https://app.example/cb",
        codeChallenge: "chal",
      });
      const url = new URL(started.authorizationUrl);
      assert.strictEqual(url.origin + url.pathname, "http://localhost:8788/cloudflare/oauth2/auth");
      const issued = yield* oauth.complete({
        code: "code-1",
        callbackUrl: "https://app.example/cb",
        codeVerifier: "verifier",
        params: { state: "state-1", code: "code-1" },
      });
      assert.deepStrictEqual(JSON.parse(Redacted.value(issued.secret)), {
        accessToken: "access-1",
        refreshToken: "refresh-1",
      });
      assert.strictEqual(
        recording.requests[0]?.url,
        "http://localhost:8788/cloudflare/oauth2/token",
      );
      yield* (oauth.revoke ?? bail("revoke"))({ secret: issued.secret, context: issued.context });
      assert.strictEqual(
        recording.requests[2]?.url,
        "http://localhost:8788/cloudflare/oauth2/revoke",
      );
    });
  });

  it.effect("refuses a plaintext OAuth issuer that is not on this machine", () => {
    const recording = recordedFetch([{ body: {} }]);
    const definition = Cloudflare.provider({
      fetch: recording.fetch,
      oauth: {
        clientId: "client-1",
        clientSecret: Redacted.make("secret"),
        issuer: "http://oauth.example.com",
      },
    });
    return Effect.gen(function* () {
      const error = yield* (definition.auth.oauth ?? bail("oauth"))
        .complete({
          code: "code-1",
          callbackUrl: "https://app.example/cb",
          codeVerifier: "verifier",
          params: { state: "state-1", code: "code-1" },
        })
        .pipe(Effect.flip);
      assert.strictEqual(error.reason._tag, "ProviderUnavailable");
      // The credential never left the process.
      assert.deepStrictEqual(recording.requests, []);
    });
  });

  it.effect("keeps Cloudflare's own OAuth server when the host configures none", () => {
    const definition = Cloudflare.provider({
      oauth: { clientId: "client-1", clientSecret: Redacted.make("secret") },
    });
    return Effect.gen(function* () {
      const started = yield* (definition.auth.oauth ?? bail("oauth")).start({
        state: "state-1",
        callbackUrl: "https://app.example/cb",
        codeChallenge: "chal",
      });
      assert.ok(started.authorizationUrl.startsWith(Cloudflare.server.authorization_endpoint));
    });
  });

  it.effect("refreshes credentials, keeping an unrotated refresh token", () => {
    const recording = recordedFetch([
      { body: { access_token: "access-2", expires_in: 3_600, token_type: "bearer" } },
      { body: { access_token: "access-3", refresh_token: "refresh-2", token_type: "bearer" } },
      { body: { error: "invalid_grant", error_description: "revoked" }, init: { status: 400 } },
    ]);
    const oauth =
      Cloudflare.provider({
        fetch: recording.fetch,
        oauth: { clientId: "client-1", clientSecret: Redacted.make("secret") },
      }).auth.oauth ?? bail("oauth");
    const stored: Provider.Credential = {
      secret: Redacted.make(JSON.stringify({ accessToken: "access-1", refreshToken: "refresh-1" })),
      context: { accountId: "account-1" },
    };
    return Effect.gen(function* () {
      const first = yield* oauth.refresh(stored);
      assert.deepStrictEqual(JSON.parse(Redacted.value(first.secret)), {
        accessToken: "access-2",
        refreshToken: "refresh-1",
      });
      assert.ok(first.expiresAt !== null);
      assert.strictEqual(
        new URLSearchParams(String(recording.requests[0]?.init?.body)).get("grant_type"),
        "refresh_token",
      );
      const second = yield* oauth.refresh(stored);
      assert.deepStrictEqual(JSON.parse(Redacted.value(second.secret)), {
        accessToken: "access-3",
        refreshToken: "refresh-2",
      });
      assert.strictEqual(second.expiresAt, null);
      const revoked = yield* oauth.refresh(stored).pipe(Effect.flip);
      assert.strictEqual(revoked.reason._tag, "Unauthenticated");
      const noRefresh = yield* oauth.refresh(credential()).pipe(Effect.flip);
      assert.strictEqual(noRefresh.reason._tag, "Unauthenticated");
    });
  });
});
