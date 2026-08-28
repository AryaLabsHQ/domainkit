import { Effect, Layer } from "effect";

import { webCryptoLayer } from "../plan/canonical-json.ts";
import * as DeletionEffect from "../plan/deletion.ts";
import type * as DnsPlan from "../plan/types.ts";
import * as DnsProvider from "../provider/provider.ts";

export function create(input: {
  readonly plan: DnsPlan.DnsPlan;
  readonly provider: DnsProvider.AsyncInterface;
  readonly receipt: DnsPlan.ApplyReceipt;
  readonly ttlMs?: number;
}): Promise<DeletionEffect.Plan> {
  return Effect.runPromise(
    DeletionEffect.create({
      plan: input.plan,
      receipt: input.receipt,
      ...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs }),
    }).pipe(
      Effect.provide(Layer.merge(DnsProvider.layerFromAsync(input.provider), webCryptoLayer)),
    ),
  );
}

export function authorize(
  plan: DeletionEffect.Plan,
  operationIds?: ReadonlyArray<string>,
): Promise<DeletionEffect.Authorization> {
  return Effect.runPromise(
    DeletionEffect.authorize(plan, operationIds).pipe(Effect.provide(webCryptoLayer)),
  );
}

export function apply(input: {
  readonly authorization: DeletionEffect.Authorization;
  readonly plan: DeletionEffect.Plan;
  readonly priorReceipt?: DeletionEffect.Receipt;
  readonly provider: DnsProvider.AsyncInterface;
}): Promise<DeletionEffect.Receipt> {
  return Effect.runPromise(
    DeletionEffect.apply({
      authorization: input.authorization,
      plan: input.plan,
      ...(input.priorReceipt === undefined ? {} : { priorReceipt: input.priorReceipt }),
    }).pipe(
      Effect.provide(Layer.merge(DnsProvider.layerFromAsync(input.provider), webCryptoLayer)),
    ),
  );
}

export { Authorization, Error, Operation, PartialError, Plan, Receipt } from "../plan/deletion.ts";
export type {
  ApplyError,
  Authorization as DeletionAuthorization,
  CreateError,
  Operation as DeletionOperation,
  Plan as DeletionPlan,
  Receipt as DeletionReceipt,
} from "../plan/deletion.ts";
