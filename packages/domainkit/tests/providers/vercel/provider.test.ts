import { assert, describe, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { DnsRecord, Provider, Vercel } from "../../../src/index.ts";
import { bail, recordedFetch } from "../recorded-fetch.ts";
import {
  domain,
  domainPage,
  personalDomain,
  record,
  recordPage,
  teamPage,
  user,
} from "./fixtures.ts";

const token = Redacted.make("vc-token");
const credential = (teamId: string | null = null): Provider.Credential => ({
  secret: token,
  context: { teamId },
});
const target: Provider.Target = {
  zone: "example.com",
  context: { teamId: "team-1" },
  label: "example.com (Team)",
};

describe("Vercel.provider", () => {
  it("offers tokens only unless an integration is configured", () => {
    assert.deepStrictEqual(Provider.methods(Vercel.provider()), ["token"]);
    assert.deepStrictEqual(
      Provider.methods(
        Vercel.provider({
          integration: { clientId: "c", clientSecret: Redacted.make("s"), slug: "domainkit" },
        }),
      ),
      ["token", "integration"],
    );
  });

  it.effect("authenticates a personal token against the user endpoint", () => {
    const recording = recordedFetch([
      { body: user, expect: { pathname: "/v2/user" } },
      { body: { error: { code: "forbidden", message: "nope" } }, init: { status: 403 } },
    ]);
    const definition = Vercel.provider({ fetch: recording.fetch });
    return Effect.gen(function* () {
      const issued = yield* (definition.auth.token ?? bail("token")).authenticate(token);
      assert.deepStrictEqual(issued.context, { teamId: null });
      assert.strictEqual(issued.expiresAt, null);
      const denied = yield* (definition.auth.token ?? bail("token"))
        .authenticate(token)
        .pipe(Effect.flip);
      assert.strictEqual(denied.reason._tag, "Forbidden");
    });
  });

  it.effect(
    "lists personal and team zones for a personal token, team zones only for a team credential",
    () => {
      const recording = recordedFetch([
        { body: domainPage([personalDomain]), expect: { pathname: "/v5/domains" } },
        {
          body: teamPage([{ id: "team-1", name: "Team", slug: "team" }]),
          expect: { pathname: "/v2/teams" },
        },
        {
          body: domainPage([
            domain,
            {
              ...domain,
              id: "d3",
              name: "external.dev",
              serviceType: "external",
              zone: false,
              intendedNameservers: [],
            },
          ]),
          expect: { pathname: "/v5/domains" },
        },
        { body: domainPage([domain]), expect: { pathname: "/v5/domains" } },
      ]);
      const definition = Vercel.provider({ fetch: recording.fetch });
      return Effect.gen(function* () {
        const all = yield* definition.session(credential()).listTargets();
        assert.deepStrictEqual(
          all.map(({ zone, context, label }) => ({ zone, context, label })),
          [
            { zone: "personal.dev", context: { teamId: null }, label: "personal.dev (personal)" },
            { zone: "example.com", context: { teamId: "team-1" }, label: "example.com (Team)" },
          ],
        );
        assert.ok(recording.requests[2]?.url.includes("teamId=team-1"));
        const team = yield* definition.session(credential("team-1")).listTargets();
        assert.strictEqual(team.length, 1);
        assert.ok(recording.requests[3]?.url.includes("teamId=team-1"));
      });
    },
  );

  it.effect("completes an integration install and checks the callback team", () => {
    const recording = recordedFetch([
      {
        body: {
          access_token: "access-1",
          installation_id: "icfg-1",
          team_id: "team-1",
          token_type: "Bearer",
          user_id: "user-1",
        },
        expect: { method: "POST", pathname: "/v2/oauth/access_token" },
      },
      { body: { access_token: "access-2", team_id: "team-2", user_id: "user-1" } },
    ]);
    const integration =
      Vercel.provider({
        fetch: recording.fetch,
        integration: {
          clientId: "client-1",
          clientSecret: Redacted.make("secret"),
          slug: "domainkit",
        },
      }).auth.integration ?? bail("integration");
    return Effect.gen(function* () {
      const started = yield* integration.start({
        state: "state-1",
        callbackUrl: "https://app.example/cb",
      });
      assert.strictEqual(
        started.authorizationUrl,
        "https://vercel.com/integrations/domainkit/new?source=external&state=state-1",
      );
      const issued = yield* integration.complete({
        code: "code-1",
        callbackUrl: "https://app.example/cb",
        params: { code: "code-1", state: "state-1", teamId: "team-1", configurationId: "icfg-1" },
      });
      assert.deepStrictEqual(issued.context, { teamId: "team-1" });
      assert.strictEqual(Redacted.value(issued.secret), "access-1");
      const body = new URLSearchParams(String(recording.requests[0]?.init?.body));
      assert.strictEqual(body.get("client_secret"), "secret");
      assert.strictEqual(body.get("redirect_uri"), "https://app.example/cb");
      const mismatch = yield* integration
        .complete({
          code: "code-2",
          callbackUrl: "https://app.example/cb",
          params: { teamId: "team-1" },
        })
        .pipe(Effect.flip);
      assert.strictEqual(mismatch.reason._tag, "Unauthenticated");
    });
  });

  it.effect("lists, decodes, creates, reads, and deletes records with the team scope", () => {
    const recording = recordedFetch([
      {
        body: recordPage(
          [
            record("CAA", "", '0 issue "letsencrypt.org"'),
            record("MX", "@", "mx.example.com", { mxPriority: 10 }),
          ],
          2,
        ),
      },
      {
        body: recordPage([
          record("SRV", "_sip._tcp", "10 5 5060 sip.example.com"),
          record("ALIAS", "www", "cname.vercel-dns.com"),
        ]),
      },
      {
        body: { uid: "record-new" },
        expect: { method: "POST", pathname: "/v2/domains/example.com/records" },
      },
      { body: recordPage([record("TXT", "new", "v")]) },
      {
        body: {},
        expect: { method: "DELETE", pathname: "/v2/domains/example.com/records/record-new" },
      },
    ]);
    const dns = Vercel.provider({ fetch: recording.fetch }).session(credential()).dns(target);
    return Effect.gen(function* () {
      const records = yield* dns.list("example.com");
      assert.deepStrictEqual(
        records.map(({ record: observed }) => [
          observed.name,
          observed._tag,
          observed._tag === "Opaque" ? observed.type : DnsRecord.data(observed),
        ]),
        [
          ["example.com", "CAA", "0 issue letsencrypt.org"],
          ["example.com", "MX", "10 mx.example.com"],
          ["_sip._tcp.example.com", "SRV", "10 5 5060 sip.example.com"],
          ["www.example.com", "Opaque", "ALIAS"],
        ],
      );
      assert.ok(recording.requests[1]?.url.includes("until=2"));
      const created = yield* dns.create(
        "example.com",
        DnsRecord.caa({ name: "example.com", flags: 0, tag: "issue", value: 'a"b', ttl: 120 }),
      );
      assert.strictEqual(created.providerRecordId, "record-new");
      assert.ok(recording.requests[2]?.url.includes("teamId=team-1"));
      assert.deepStrictEqual(JSON.parse(String(recording.requests[2]?.init?.body)), {
        name: "",
        ttl: 120,
        type: "CAA",
        value: '0 issue "a\\"b"',
      });
      const found = yield* dns.get("example.com", "record-txt");
      assert.strictEqual(found?._tag, "TXT");
      yield* dns.delete("example.com", "record-new");
      const outside = yield* dns
        .create("example.com", DnsRecord.txt({ name: "x.example.net", value: "v" }))
        .pipe(Effect.flip);
      assert.strictEqual(outside.reason._tag, "ProviderRejected");
    });
  });

  it.effect("classifies rate limits and authentication failures", () => {
    const recording = recordedFetch([
      {
        body: {
          error: {
            code: "rate_limited",
            message: "slow down",
            limit: { remaining: 0, resetMs: Date.now() + 5_000, total: 10 },
          },
        },
        init: { status: 429 },
      },
      { body: { error: { code: "invalid_token", message: "bad" } }, init: { status: 401 } },
      {
        body: { error: { code: "not_found", message: "Domain not found" } },
        init: { status: 404 },
      },
      { body: { error: { code: "conflict", message: "Record exists" } }, init: { status: 409 } },
      { body: { error: { code: "forbidden", message: "Not allowed" } }, init: { status: 403 } },
    ]);
    const dns = Vercel.provider({ fetch: recording.fetch }).session(credential()).dns(target);
    return Effect.gen(function* () {
      const limited = yield* dns.list("example.com").pipe(Effect.flip);
      assert.strictEqual(limited.reason._tag, "ProviderUnavailable");
      if (limited.reason._tag === "ProviderUnavailable")
        assert.ok((limited.reason.retryAfterMs ?? 0) > 0);
      const invalid = yield* dns.list("example.com").pipe(Effect.flip);
      assert.strictEqual(invalid.reason._tag, "Unauthenticated");
      const missing = yield* dns.list("example.com").pipe(Effect.flip);
      assert.strictEqual(missing.reason._tag, "NotFound");
      if (missing.reason._tag === "NotFound") {
        assert.strictEqual(missing.reason.entity, "zone");
        assert.strictEqual(missing.reason.id, "/v5/domains/example.com/records");
      }
      const conflict = yield* dns
        .create("example.com", DnsRecord.txt({ name: "x.example.com", value: "v" }))
        .pipe(Effect.flip);
      assert.strictEqual(conflict.reason._tag, "ProviderConflict");
      const forbidden = yield* dns.list("example.com").pipe(Effect.flip);
      assert.strictEqual(forbidden.reason._tag, "Forbidden");
    });
  });
});
