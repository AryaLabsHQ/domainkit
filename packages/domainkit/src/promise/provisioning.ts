import { Effect, Layer } from "effect";

import type * as Connection from "../auth/connection.ts";
import type * as ProviderAuthorization from "../auth/authorization.ts";
import * as ConnectionAuthorization from "../plan/connection-authorization.ts";
import { webCryptoLayer } from "../plan/canonical-json.ts";
import * as ProvisioningEffect from "../plan/plan.ts";
import type * as DnsPlan from "../plan/types.ts";
import * as DnsProvider from "../provider/provider.ts";
import * as ZoneDiscoveryEffect from "../discovery/zone-discovery.ts";
import * as ZoneDiscovery from "./zone-discovery.ts";

export interface ExactCreateInput extends ProvisioningEffect.ExactCreateInput {
  readonly provider: DnsProvider.AsyncInterface;
}

export interface DiscoverCreateInput extends ProvisioningEffect.DiscoverCreateInput {
  readonly sources: ReadonlyArray<ZoneDiscovery.Source>;
}

export function create(input: ExactCreateInput): Promise<ProvisioningEffect.ResolvedCreateResult>;
export function create(input: DiscoverCreateInput): Promise<ProvisioningEffect.CreateResult>;
export function create(
  input: ExactCreateInput | DiscoverCreateInput,
): Promise<ProvisioningEffect.CreateResult> {
  if ("sources" in input) {
    const { sources, ...programInput } = input;
    return Effect.runPromise(
      ProvisioningEffect.create(programInput).pipe(
        Effect.provide(
          Layer.merge(
            Layer.succeed(
              ZoneDiscoveryEffect.Service,
              ZoneDiscoveryEffect.make(sources.map(ZoneDiscovery.toEffectSource)),
            ),
            webCryptoLayer,
          ),
        ),
      ),
    );
  }
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
  readonly allowPartial?: boolean;
  readonly authorization: ProviderAuthorization.ProviderAuthorization;
  readonly connection: Connection.Connection;
  readonly domain: string;
  readonly operationIds?: ReadonlyArray<string>;
  readonly plan: DnsPlan.DnsPlan;
}): Promise<DnsPlan.PlanAuthorization> {
  return Effect.runPromise(
    ConnectionAuthorization.authorize(input).pipe(Effect.provide(webCryptoLayer)),
  );
}

export const renderManualInstructions = ProvisioningEffect.renderManualInstructions;
export { CreateResult, Target } from "../plan/plan.ts";
