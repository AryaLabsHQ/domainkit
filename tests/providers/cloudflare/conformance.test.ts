import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { Digest, DnsProvider, DnsRecord, Provisioning, Secret } from "../../../src/effect.ts";
import * as Cloudflare from "../../../src/providers/cloudflare/index.ts";
import { page, recordedFetch, single, zone } from "./fixtures.ts";

const requirement = DnsRecord.parse({
  _tag: "CNAME",
  metadata: { ownership: "customer", provenance: "test", purpose: "tracking" },
  name: "track.example.com",
  policy: "exclusive",
  target: "target.example.net",
  ttl: 300,
});
const capabilities = ["dns:read", "dns:write"] as const;

describe("Cloudflare provider conformance", () => {
  it.effect("plans, authorizes, creates, and confirms additive state", () => {
    const created = {
      content: "target.example.net",
      id: "created-record",
      name: "track.example.com",
      proxied: false,
      ttl: 300,
      type: "CNAME",
    };
    const recording = recordedFetch([
      { body: page([zone]) },
      { body: page([]) },
      { body: page([zone]) },
      { body: page([]) },
      { body: page([zone]) },
      { body: page([]) },
      { body: page([zone]) },
      { body: single(created) },
    ]);
    const provider = Cloudflare.make({
      accountId: "account-1",
      capabilities,
      fetch: recording.fetch,
      token: Secret.make("token"),
    });
    const layer = Layer.merge(Layer.succeed(DnsProvider.Service, provider), Digest.webCryptoLayer);

    return Effect.gen(function* () {
      const { plan } = yield* Provisioning.create({
        requirements: [requirement],
        target: Provisioning.Target.ExactZone({ zone: "example.com" }),
      });
      assert.strictEqual(plan.operations[0]?._tag, "create");
      const authorization = yield* Provisioning.authorize(plan);
      const receipt = yield* Provisioning.apply({ authorization, plan });
      assert.strictEqual(receipt.status, "complete");
      assert.strictEqual(receipt.operations[0]?.providerRecordId, "created-record");
      assert.strictEqual(
        recording.requests.filter(({ init }) => init?.method === "POST").length,
        1,
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "no-ops exact state and blocks portable or opaque CNAME conflicts without writes",
    () => {
      const exact = {
        content: "target.example.net",
        id: "exact-record",
        name: "track.example.com",
        proxied: false,
        ttl: 300,
        type: "CNAME",
      };
      const conflicting = {
        content: "occupied",
        id: "conflicting-record",
        name: "track.example.com",
        proxied: false,
        ttl: 300,
        type: "TXT",
      };
      const exactRecording = recordedFetch([{ body: page([zone]) }, { body: page([exact]) }]);
      const conflictRecording = recordedFetch([
        { body: page([zone]) },
        { body: page([conflicting]) },
      ]);
      const opaqueConflictRecording = recordedFetch([
        { body: page([zone]) },
        {
          body: page([
            {
              data: {},
              id: "https-record",
              name: "track.example.com",
              proxied: false,
              ttl: 300,
              type: "HTTPS",
            },
          ]),
        },
      ]);

      return Effect.gen(function* () {
        const exactProvider = Cloudflare.make({
          accountId: "account-1",
          capabilities,
          fetch: exactRecording.fetch,
          token: Secret.make("token"),
        });
        const { plan: exactPlan } = yield* Provisioning.create({
          requirements: [requirement],
          target: Provisioning.Target.ExactZone({ zone: "example.com" }),
        }).pipe(
          Effect.provide(
            Layer.merge(Layer.succeed(DnsProvider.Service, exactProvider), Digest.webCryptoLayer),
          ),
        );
        assert.strictEqual(exactPlan.operations[0]?._tag, "noop");

        const conflictProvider = Cloudflare.make({
          accountId: "account-1",
          capabilities,
          fetch: conflictRecording.fetch,
          token: Secret.make("token"),
        });
        const { plan: conflictPlan } = yield* Provisioning.create({
          requirements: [requirement],
          target: Provisioning.Target.ExactZone({ zone: "example.com" }),
        }).pipe(
          Effect.provide(
            Layer.merge(
              Layer.succeed(DnsProvider.Service, conflictProvider),
              Digest.webCryptoLayer,
            ),
          ),
        );
        assert.strictEqual(conflictPlan.operations[0]?._tag, "conflict");

        const opaqueConflictProvider = Cloudflare.make({
          accountId: "account-1",
          capabilities,
          fetch: opaqueConflictRecording.fetch,
          token: Secret.make("token"),
        });
        const { plan: opaqueConflictPlan } = yield* Provisioning.create({
          requirements: [requirement],
          target: Provisioning.Target.ExactZone({ zone: "example.com" }),
        }).pipe(
          Effect.provide(
            Layer.merge(
              Layer.succeed(DnsProvider.Service, opaqueConflictProvider),
              Digest.webCryptoLayer,
            ),
          ),
        );
        assert.strictEqual(opaqueConflictPlan.operations[0]?._tag, "conflict");
        if (opaqueConflictPlan.operations[0]?._tag === "conflict") {
          assert.strictEqual(opaqueConflictPlan.operations[0].existing[0]?._tag, "Opaque");
        }
        assert.ok(
          [
            ...exactRecording.requests,
            ...conflictRecording.requests,
            ...opaqueConflictRecording.requests,
          ].every(({ init }) => init?.method !== "POST"),
        );
      });
    },
  );
});
