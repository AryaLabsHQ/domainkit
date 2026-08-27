import { Effect, Layer } from "effect";

import type * as DomainName from "../domain/domain-name.ts";
import type * as DnsRecord from "../domain/dns-record.ts";
import * as DnsProvider from "../provider/provider.ts";
import * as DnsResolver from "../verification/resolver.ts";
import * as VerificationEffect from "../verification/verify.ts";

export function record(input: {
  readonly provider: DnsProvider.AsyncInterface;
  readonly record: DnsRecord.DnsRecord;
  readonly resolver: DnsResolver.AsyncInterface;
  readonly zone: DomainName.DomainName;
}): Promise<VerificationEffect.Result> {
  return Effect.runPromise(
    VerificationEffect.record({ record: input.record, zone: input.zone }).pipe(
      Effect.provide(
        Layer.merge(
          DnsProvider.layerFromAsync(input.provider),
          DnsResolver.layerFromAsync(input.resolver),
        ),
      ),
    ),
  );
}
