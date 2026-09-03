import { assert, describe, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";

import { DnsRecord, type Provider } from "../../src/index.ts";
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
