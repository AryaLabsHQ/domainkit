import { Effect, Layer } from "effect";

import type * as Connection from "../auth/connection.ts";
import * as ConnectionAuthorization from "../plan/connection-authorization.ts";
import { webCryptoLayer } from "../plan/canonical-json.ts";
import * as ProvisioningEffect from "../plan/plan.ts";
import type * as DnsPlan from "../plan/types.ts";
import * as DnsProvider from "../provider/provider.ts";

export interface CreateInput extends ProvisioningEffect.CreateInput {
  readonly provider: DnsProvider.AsyncInterface;
}

export function create(input: CreateInput): Promise<DnsPlan.DnsPlan> {
  const { provider, ...programInput } = input;
  return Effect.runPromise(
    ProvisioningEffect.create(programInput).pipe(
      Effect.provide(Layer.merge(DnsProvider.layerFromAsync(provider), webCryptoLayer)),
    ),
  );
}

export function authorize(
  plan: DnsPlan.DnsPlan,
  operationIds?: ReadonlyArray<string>,
  options: { readonly allowPartial?: boolean } = {},
): Promise<DnsPlan.PlanAuthorization> {
  return Effect.runPromise(
    ProvisioningEffect.authorize(plan, operationIds, options).pipe(Effect.provide(webCryptoLayer)),
  );
}

export function apply(input: {
  readonly authorization: DnsPlan.PlanAuthorization;
  readonly plan: DnsPlan.DnsPlan;
  readonly provider: DnsProvider.AsyncInterface;
}): Promise<DnsPlan.ApplyReceipt> {
  return Effect.runPromise(
    ProvisioningEffect.apply({ authorization: input.authorization, plan: input.plan }).pipe(
      Effect.provide(Layer.merge(DnsProvider.layerFromAsync(input.provider), webCryptoLayer)),
    ),
  );
}

export function authorizeForConnection(input: {
  readonly accountId: string;
  readonly allowPartial?: boolean;
  readonly connection: Connection.Connection;
  readonly operationIds?: ReadonlyArray<string>;
  readonly plan: DnsPlan.DnsPlan;
}): Promise<DnsPlan.PlanAuthorization> {
  return Effect.runPromise(
    ConnectionAuthorization.authorize(input).pipe(Effect.provide(webCryptoLayer)),
  );
}

export const renderManualInstructions = ProvisioningEffect.renderManualInstructions;
