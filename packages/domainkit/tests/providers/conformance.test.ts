import { assert, describe, it } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";

import { DnsRecord, DomainKit, Provider, Reason } from "../../src/index.ts";
import { Testing } from "../../src/entry/testing.ts";

const credential = { secret: Redacted.make("token"), context: { account: "fake" } };

describe("provider-author conformance contract", () => {
  it.effect("passes for the fake provider, even with unrelated records in the zone", () =>
    Effect.gen(function* () {
      const fake = Testing.provider({
        id: "third-party",
        zones: ["example.com"],
        records: [
          {
            zone: "example.com",
            record: DnsRecord.txt({ name: "existing.example.com", value: "preserve-me" }),
          },
        ],
      });
      yield* Testing.conformance.provider(fake, credential, "example.com", {
        prefix: "external-adapter",
      });
      assert.deepStrictEqual(
        fake.records("example.com").map((record) => record.name),
        ["existing.example.com"],
      );
    }),
  );

  it.effect("asks for rejectedToken when the token method requires a non-secret field", () => {
    const fake = Testing.provider({ id: "regional", zones: ["example.com"] });
    const regional: Provider.Definition = {
      ...fake,
      auth: {
        token: Provider.tokenAuth({
          label: "Regional token",
          requiredCapabilities: ["dns:read", "dns:write"],
          fields: Schema.Struct({
            token: Schema.RedactedFromValue(Schema.String),
            region: Schema.String,
          }),
          authenticate: ({ token }) =>
            Redacted.value(token) === "good"
              ? Effect.succeed({ secret: token, context: { account: "regional" }, expiresAt: null })
              : Effect.fail(
                  new DomainKit.Error({
                    reason: new Reason.Unauthenticated({ message: "regional rejected the token" }),
                  }),
                ),
        }),
      },
    };
    return Effect.gen(function* () {
      const failure = yield* Testing.conformance
        .provider(regional, credential, "example.com")
        .pipe(Effect.flip);
      assert.strictEqual(failure.reason._tag, "InvalidInput");
      assert.match(failure.message, /rejected-token: the token method requires region/);
      yield* Testing.conformance.provider(regional, credential, "example.com", {
        rejectedToken: { token: Redacted.make("bad"), region: Redacted.make("eu") },
      });
    });
  });

  it.effect("reports a broken readback as a typed failure and still cleans up", () =>
    Effect.gen(function* () {
      const fake = Testing.provider({ id: "hidden", zones: ["example.com"] });
      const hiding: Provider.Definition = {
        ...fake,
        session: (input) => {
          const session = fake.session(input);
          return {
            ...session,
            dns: (target) => {
              const dns = session.dns(target);
              return {
                ...dns,
                list: (zone) => dns.list(zone).pipe(Effect.map((records) => records.slice(0, 1))),
              };
            },
          };
        },
      };
      const failure = yield* Testing.conformance
        .provider(hiding, credential, "example.com")
        .pipe(Effect.flip);
      assert.strictEqual(failure.reason._tag, "InvalidInput");
      assert.match(failure.message, /create-readback-cleanup/);
      assert.deepStrictEqual(fake.records("example.com"), []);
    }),
  );
});
