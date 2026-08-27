import { Clock, Crypto, Effect, Layer } from "effect";

import { webCryptoLayer } from "./plan/canonical-json.ts";
import {
  applyPlan as applyPlanEffect,
  authorizePlan as authorizePlanEffect,
  createPlan as createPlanEffect,
  type CreatePlanInput as EffectCreatePlanInput,
} from "./plan/plan.ts";
import type { ApplyReceipt, DnsPlan, PlanAuthorization } from "./plan/types.ts";
import {
  type DnsProviderService,
  layerDnsProviderFromPromise,
  type PromiseDnsProvider,
} from "./provider/provider.ts";

export interface CreatePlanInput extends EffectCreatePlanInput {
  readonly provider: PromiseDnsProvider;
}

/** Promise facade over the canonical Effect planning program. */
export function createPlan(input: CreatePlanInput): Promise<DnsPlan> {
  const { provider, ...programInput } = input;
  return runWithProvider(createPlanEffect(programInput), provider);
}

/** Promise facade over digest-bound Effect authorization. */
export function authorizePlan(
  plan: DnsPlan,
  operationIds?: ReadonlyArray<string>,
  options: { readonly allowPartial?: boolean } = {},
): Promise<PlanAuthorization> {
  return Effect.runPromise(
    authorizePlanEffect(plan, operationIds, options).pipe(Effect.provide(webCryptoLayer)),
  );
}

/** Promise facade over the canonical Effect apply interpreter. */
export function applyPlan(input: {
  readonly authorization: PlanAuthorization;
  readonly now?: () => Date;
  readonly plan: DnsPlan;
  readonly provider: PromiseDnsProvider;
}): Promise<ApplyReceipt> {
  const program = applyPlanEffect({ authorization: input.authorization, plan: input.plan });
  const withClock =
    input.now === undefined
      ? program
      : program.pipe(Effect.provideService(Clock.Clock, fixedClock(input.now)));
  return runWithProvider(withClock, input.provider);
}

function runWithProvider<A, E>(
  program: Effect.Effect<A, E, DnsProviderService | Crypto.Crypto>,
  provider: PromiseDnsProvider,
): Promise<A> {
  return Effect.runPromise(
    program.pipe(
      Effect.provide(Layer.merge(layerDnsProviderFromPromise(provider), webCryptoLayer)),
    ),
  );
}

function fixedClock(now: () => Date): Clock.Clock {
  const millis = () => now().getTime();
  const nanos = () => BigInt(millis()) * 1_000_000n;
  return {
    currentTimeMillisUnsafe: millis,
    currentTimeMillis: Effect.sync(millis),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: nanos,
    monotonicTimeNanos: Effect.sync(nanos),
    sleep: () => Effect.void,
  };
}
