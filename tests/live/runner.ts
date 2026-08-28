import { Effect, Layer, Schema as S } from "effect";

import * as DnsRecord from "../../src/domain/dns-record.ts";
import * as Digest from "../../src/plan/canonical-json.ts";
import * as Provisioning from "../../src/plan/plan.ts";
import * as DnsPlan from "../../src/plan/types.ts";
import * as DnsProvider from "../../src/provider/provider.ts";
import type * as LiveConfig from "./config.ts";

export class Error extends S.TaggedError<Error>()("LiveRunnerError", {
  message: S.String,
}) {}

export interface Input {
  readonly config: LiveConfig.Common;
  readonly provider: DnsProvider.Interface;
  readonly validateCredential: Effect.Effect<unknown, DnsProvider.Error>;
}

export const run = Effect.fn("LiveRunner.run")((input: Input) =>
  Effect.gen(function* () {
    yield* input.validateCredential;
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
    const plan = yield* Provisioning.create({
      requirements: [requirement],
      zone: input.config.zone,
    });

    if (input.config.command === "preview") {
      yield* print(DnsPlan.encode(plan));
      return;
    }
    if (plan.digest !== input.config.approvedDigest) {
      return yield* new Error({
        message: `Approved digest does not match the current plan. Current digest: ${plan.digest}`,
      });
    }

    const authorization = yield* Provisioning.authorize(plan);
    const receipt = yield* Provisioning.apply({ authorization, plan });
    yield* print(DnsPlan.encodeReceipt(receipt));
  }).pipe(
    Effect.provide(
      Layer.merge(Layer.succeed(DnsProvider.Service, input.provider), Digest.webCryptoLayer),
    ),
  ),
);

const print = Effect.fn("LiveRunner.print")((value: unknown) =>
  Effect.sync(() => console.log(JSON.stringify(value, null, 2))),
);
