import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { Digest, DnsProvider, DnsRecord, Provisioning, Secret } from "../../../src/effect.ts";
import * as Vercel from "../../../src/providers/vercel/index.ts";
import {
  authoritativeConfig,
  domainEnvelope,
  record,
  recordedFetch,
  recordPage,
} from "./fixtures.ts";

const requirement = DnsRecord.parse({
  _tag: "CNAME",
  metadata: { ownership: "customer", provenance: "test", purpose: "tracking" },
  name: "track.example.com",
  policy: "exclusive",
  target: "target.example.net",
  ttl: 300,
});
const capabilities = ["dns:read", "dns:write"] as const;

describe("Vercel provider conformance", () => {
  it.effect("plans, authorizes, creates, and confirms additive state", () => {
    const recording = recordedFetch([
      { body: authoritativeConfig },
      { body: domainEnvelope },
      { body: recordPage([]) },
      { body: authoritativeConfig },
      { body: domainEnvelope },
      { body: recordPage([]) },
      { body: authoritativeConfig },
      { body: domainEnvelope },
      { body: recordPage([]) },
      { body: authoritativeConfig },
      { body: domainEnvelope },
      { body: { uid: "created-record" } },
    ]);
    const provider = make(recording.fetch);
    const layer = Layer.merge(Layer.succeed(DnsProvider.Service, provider), Digest.webCryptoLayer);
    return Effect.gen(function* () {
      const plan = yield* Provisioning.create({ requirements: [requirement], zone: "example.com" });
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
      const exact = record("CNAME", "track", "target.example.net", { ttl: 300 });
      const conflicting = record("TXT", "track", "occupied", { ttl: 300 });
      const exactRecording = recordedFetch([
        { body: authoritativeConfig },
        { body: domainEnvelope },
        { body: recordPage([exact]) },
      ]);
      const conflictRecording = recordedFetch([
        { body: authoritativeConfig },
        { body: domainEnvelope },
        { body: recordPage([conflicting]) },
      ]);
      const opaqueConflictRecording = recordedFetch([
        { body: authoritativeConfig },
        { body: domainEnvelope },
        { body: recordPage([record("ALIAS", "track", "alias.vercel-dns.com")]) },
      ]);
      return Effect.gen(function* () {
        const exactPlan = yield* Provisioning.create({
          requirements: [requirement],
          zone: "example.com",
        }).pipe(
          Effect.provide(
            Layer.merge(
              Layer.succeed(DnsProvider.Service, make(exactRecording.fetch)),
              Digest.webCryptoLayer,
            ),
          ),
        );
        assert.strictEqual(exactPlan.operations[0]?._tag, "noop");
        const conflictPlan = yield* Provisioning.create({
          requirements: [requirement],
          zone: "example.com",
        }).pipe(
          Effect.provide(
            Layer.merge(
              Layer.succeed(DnsProvider.Service, make(conflictRecording.fetch)),
              Digest.webCryptoLayer,
            ),
          ),
        );
        assert.strictEqual(conflictPlan.operations[0]?._tag, "conflict");

        const opaqueConflictPlan = yield* Provisioning.create({
          requirements: [requirement],
          zone: "example.com",
        }).pipe(
          Effect.provide(
            Layer.merge(
              Layer.succeed(DnsProvider.Service, make(opaqueConflictRecording.fetch)),
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

function make(fetch: Vercel.Fetch): Vercel.Interface {
  return Vercel.make({
    capabilities,
    context: { _tag: "team", teamId: "team-1" },
    fetch,
    token: Secret.make("token"),
  });
}
