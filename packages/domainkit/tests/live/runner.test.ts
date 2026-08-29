import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import * as DomainName from "../../src/domain/domain-name.ts";
import * as Digest from "../../src/plan/canonical-json.ts";
import { InMemoryDnsProvider } from "../../src/testing.ts";
import * as LiveRunner from "./runner.ts";

describe("live provider approval", () => {
  it.effect("binds the approval digest to the provider subject", () =>
    Effect.gen(function* () {
      const first = yield* LiveRunner.makeApproval("plan-digest", {
        providerId: "vercel",
        subjectId: "team-one",
        subjectType: "team",
      });
      const second = yield* LiveRunner.makeApproval("plan-digest", {
        providerId: "vercel",
        subjectId: "team-two",
        subjectType: "team",
      });
      assert.notStrictEqual(first.digest, second.digest);
    }).pipe(Effect.provide(Digest.webCryptoLayer)),
  );

  it.effect("applies, verifies, reports, and cleans a live-profile record", () => {
    const provider = InMemoryDnsProvider.make({ id: "live-test" });
    const providerScope = {
      providerId: provider.id,
      subjectId: "account-1",
      subjectType: "account" as const,
    };
    const output: Array<unknown> = [];
    const common = {
      allowedRecordName: DomainName.parse("_domainkit-live.example.com"),
      allowedZone: DomainName.parse("example.com"),
      recordName: DomainName.parse("_domainkit-live.example.com"),
      recordValue: "domainkit-live",
      zone: DomainName.parse("example.com"),
    };
    const validateCredential = Effect.succeed({
      accountId: "account-1",
      capabilities: ["dns:read", "dns:write"] as const,
      expiresAt: null,
      scopes: [],
    });
    const write = (value: unknown) => Effect.sync(() => output.push(value));
    return Effect.gen(function* () {
      yield* LiveRunner.run({
        config: { ...common, approvedDigest: null, command: "preview" },
        provider,
        providerScope,
        validateCredential,
        write,
      });
      const preview = output[0] as { readonly approval?: { readonly digest?: string } };
      const approvedDigest = preview.approval?.digest;
      if (approvedDigest === undefined) throw new Error("preview omitted approval digest");
      yield* LiveRunner.run({
        config: { ...common, approvedDigest, command: "apply" },
        provider,
        providerScope,
        validateCredential,
        write,
      });
      const result = output[1] as {
        readonly cleanup?: { readonly _tag?: string };
        readonly observation?: { readonly _tag?: string };
      };
      assert.strictEqual(result.observation?._tag, "Verified");
      assert.strictEqual(result.cleanup?._tag, "Complete");
      assert.deepStrictEqual(yield* provider.listRecords(common.zone), []);
    });
  });
});
