import { Effect, Layer, Schema as S } from "effect";

import type * as ProviderAuth from "../../src/auth/manifest.ts";
import * as DnsRecord from "../../src/domain/dns-record.ts";
import * as Deletion from "../../src/plan/deletion.ts";
import * as Digest from "../../src/plan/canonical-json.ts";
import * as Provisioning from "../../src/plan/plan.ts";
import * as DnsPlan from "../../src/plan/types.ts";
import * as DnsProvider from "../../src/provider/provider.ts";
import * as Verification from "../../src/verification/verify.ts";
import type * as LiveConfig from "./config.ts";

export class Error extends S.TaggedError<Error>()("LiveRunnerError", {
  message: S.String,
}) {}

export const ProviderScope = S.Struct({
  providerId: S.String,
  subjectId: S.String,
  subjectType: S.Literals(["account", "team"]),
});
export interface ProviderScope extends S.Schema.Type<typeof ProviderScope> {}

const Approval = S.Struct({
  planDigest: S.String,
  providerId: S.String,
  subjectId: S.String,
  subjectType: S.Literals(["account", "team"]),
  version: S.Literal("domainkit.live-approval.v1"),
});

export interface Input {
  readonly config: LiveConfig.Common;
  readonly provider: DnsProvider.Interface;
  readonly providerScope: ProviderScope;
  readonly validateCredential: Effect.Effect<ProviderAuth.TokenValidation, DnsProvider.Error>;
  readonly write?: (value: unknown) => Effect.Effect<void>;
}

export const run = Effect.fn("LiveRunner.run")((input: Input) =>
  Effect.gen(function* () {
    const write = input.write ?? print;
    const validation = yield* input.validateCredential;
    if (
      input.provider.id !== input.providerScope.providerId ||
      validation.accountId !== input.providerScope.subjectId
    ) {
      return yield* new Error({
        message: "Validated credential scope does not match the approval scope",
      });
    }
    const requirement = yield* DnsRecord.decode({
      _tag: "TXT",
      metadata: {
        ownership: "tester",
        provenance: "domainkit-live-harness",
        purpose: "provider-conformance",
      },
      name: input.config.recordName,
      policy: "append",
      ttl: 300,
      value: input.config.recordValue,
    });
    const { plan } = yield* Provisioning.create({
      requirements: [requirement],
      target: Provisioning.Target.ExactZone({ zone: input.config.zone }),
    });
    const approval = yield* makeApproval(plan.digest, input.providerScope);

    if (input.config.command === "preview") {
      yield* write({ approval, plan: DnsPlan.encode(plan) });
      return;
    }
    if (approval.digest !== input.config.approvedDigest) {
      return yield* new Error({
        message: `Approved digest does not match the current plan and provider scope. Current digest: ${approval.digest}`,
      });
    }

    const authorization = yield* Provisioning.authorize(plan);
    const receipt = yield* Provisioning.apply({ authorization, plan });
    const observation = yield* Verification.observe({
      provider: Verification.Provider.Enabled({ zone: input.config.zone }),
      publicDns: Verification.PublicDns.Disabled(),
      record: requirement,
    });
    const cleanup = yield* Effect.gen(function* () {
      const deletion = yield* Deletion.create({ plan, receipt });
      return yield* Deletion.apply({
        authorization: yield* Deletion.authorize(deletion),
        plan: deletion,
      });
    }).pipe(
      Effect.match({
        onFailure: (failure) => ({ _tag: "Failed" as const, failure }),
        onSuccess: (cleanupReceipt) => ({ _tag: "Complete" as const, cleanupReceipt }),
      }),
    );
    yield* write({
      cleanup:
        cleanup._tag === "Complete"
          ? { _tag: cleanup._tag, receipt: cleanup.cleanupReceipt }
          : { _tag: cleanup._tag, message: cleanup.failure.message },
      createdRecordIds: receipt.operations.map(({ providerRecordId }) => providerRecordId),
      observation,
      providerScope: input.providerScope,
      receipt: DnsPlan.encodeReceipt(receipt),
      recordName: input.config.recordName,
      zone: input.config.zone,
    });
    if (cleanup._tag === "Failed") return yield* cleanup.failure;
  }).pipe(
    Effect.provide(
      Layer.merge(Layer.succeed(DnsProvider.Service, input.provider), Digest.webCryptoLayer),
    ),
  ),
);

export const makeApproval = Effect.fn("LiveRunner.makeApproval")(
  (planDigest: string, scope: ProviderScope) =>
    Effect.gen(function* () {
      const value: S.Schema.Type<typeof Approval> = {
        planDigest,
        ...scope,
        version: "domainkit.live-approval.v1",
      };
      return { ...value, digest: yield* Digest.sha256Encoded(Approval, value) };
    }),
);

const print = Effect.fn("LiveRunner.print")((value: unknown) =>
  Effect.sync(() => console.log(JSON.stringify(value, null, 2))),
);
