import { Clock, Crypto, Effect, Layer } from "effect";

import {
  beginOAuth as beginOAuthEffect,
  type BeginOAuthInput as EffectBeginOAuthInput,
  completeOAuth as completeOAuthEffect,
  type Fetch,
  refreshOAuth as refreshOAuthEffect,
  revokeOAuth as revokeOAuthEffect,
} from "./auth/oauth.ts";
import { Secret } from "./auth/secret.ts";
import { connectToken as connectTokenEffect } from "./auth/token.ts";
import type {
  Connection,
  ConnectionGrant,
  OAuthClientConfiguration,
  OAuthMethod,
  OAuthSubjectResolver,
  TokenValidation,
} from "./auth/types.ts";
import { InvalidInputError, ProviderError } from "./errors.ts";
import { webCryptoLayer } from "./plan/canonical-json.ts";
import { authorizePlanForConnection as authorizePlanForConnectionEffect } from "./plan/connection-authorization.ts";
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
import {
  connectionLayerFromPromise,
  credentialLayerFromPromise,
  oauthStateLayerFromPromise,
  type PromiseConnectionStore,
  type PromiseCredentialStore,
  type PromiseOAuthStateStore,
} from "./stores/contracts.ts";
import { layerDnsResolverFromPromise, type PromiseDnsResolver } from "./verification/resolver.ts";
import {
  type RecordVerification,
  verifyRecord as verifyRecordEffect,
} from "./verification/verify.ts";

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

export function authorizePlanForConnection(
  input: Parameters<typeof authorizePlanForConnectionEffect>[0],
): Promise<PlanAuthorization> {
  return Effect.runPromise(
    authorizePlanForConnectionEffect(input).pipe(Effect.provide(webCryptoLayer)),
  );
}

export interface BeginOAuthInput extends EffectBeginOAuthInput {
  readonly now?: () => Date;
  readonly stateStore: PromiseOAuthStateStore;
}

export function beginOAuth(input: BeginOAuthInput): Promise<{ readonly authorizationUrl: URL }> {
  const { now, stateStore, ...programInput } = input;
  return runWithLayer(
    beginOAuthEffect(programInput),
    Layer.merge(oauthStateLayerFromPromise(stateStore), webCryptoLayer),
    now,
  );
}

export function completeOAuth(input: {
  readonly callbackUrl: URL;
  readonly client: OAuthClientConfiguration;
  readonly connectionStore: PromiseConnectionStore;
  readonly credentialStore: PromiseCredentialStore;
  readonly fetch?: Fetch;
  readonly now?: () => Date;
  readonly providerId: string;
  readonly resolveSubject: OAuthSubjectResolver;
  readonly stateStore: PromiseOAuthStateStore;
}): Promise<Connection> {
  const program = completeOAuthEffect({
    callbackUrl: input.callbackUrl,
    client: input.client,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    providerId: input.providerId,
    resolveSubject: (tokens, accessToken) =>
      Effect.tryPromise({
        try: () => input.resolveSubject(tokens, accessToken),
        catch: (cause) => providerFailure(input.providerId, cause),
      }),
  });
  return runWithLayer(
    program,
    Layer.mergeAll(
      oauthStateLayerFromPromise(input.stateStore),
      connectionLayerFromPromise(input.connectionStore),
      credentialLayerFromPromise(input.credentialStore),
      webCryptoLayer,
    ),
    input.now,
  );
}

export function refreshOAuth(input: {
  readonly client: OAuthClientConfiguration;
  readonly connection: Connection;
  readonly credentialStore: PromiseCredentialStore;
  readonly fetch?: Fetch;
  readonly method: OAuthMethod;
}): Promise<void> {
  return runWithLayer(
    refreshOAuthEffect({
      client: input.client,
      connection: input.connection,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      method: input.method,
    }),
    credentialLayerFromPromise(input.credentialStore),
  );
}

export function revokeOAuth(input: {
  readonly client: OAuthClientConfiguration;
  readonly connection: Connection;
  readonly credentialStore: PromiseCredentialStore;
  readonly fetch?: Fetch;
  readonly method: OAuthMethod;
}): Promise<void> {
  return runWithLayer(
    revokeOAuthEffect({
      client: input.client,
      connection: input.connection,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      method: input.method,
    }),
    credentialLayerFromPromise(input.credentialStore),
  );
}

export function connectToken(input: {
  readonly connectionStore: PromiseConnectionStore;
  readonly credentialStore: PromiseCredentialStore;
  readonly grant: ConnectionGrant;
  readonly now?: () => Date;
  readonly providerId: string;
  readonly subjectId: string;
  readonly token: Secret;
  readonly validate: (token: Secret) => Promise<TokenValidation>;
}): Promise<Connection> {
  const program = connectTokenEffect({
    grant: input.grant,
    providerId: input.providerId,
    subjectId: input.subjectId,
    token: input.token,
    validate: (token) =>
      Effect.tryPromise({
        try: () => input.validate(token),
        catch: (cause) => providerFailure(input.providerId, cause),
      }),
  });
  return runWithLayer(
    program,
    Layer.mergeAll(
      connectionLayerFromPromise(input.connectionStore),
      credentialLayerFromPromise(input.credentialStore),
      webCryptoLayer,
    ),
    input.now,
  );
}

export function verifyRecord(input: {
  readonly provider: PromiseDnsProvider;
  readonly record: Parameters<typeof verifyRecordEffect>[0]["record"];
  readonly resolver: PromiseDnsResolver;
  readonly zone: Parameters<typeof verifyRecordEffect>[0]["zone"];
}): Promise<RecordVerification> {
  return Effect.runPromise(
    verifyRecordEffect({ record: input.record, zone: input.zone }).pipe(
      Effect.provide(
        Layer.merge(
          layerDnsProviderFromPromise(input.provider),
          layerDnsResolverFromPromise(input.resolver),
        ),
      ),
    ),
  );
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

function runWithLayer<A, E, R>(
  program: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R>,
  clock?: () => Date,
): Promise<A> {
  const provided = program.pipe(Effect.provide(layer));
  return Effect.runPromise(
    clock === undefined
      ? (provided as Effect.Effect<A, E>)
      : (provided.pipe(Effect.provideService(Clock.Clock, fixedClock(clock))) as Effect.Effect<
          A,
          E
        >),
  );
}

function providerFailure(providerId: string, cause: unknown): ProviderError | InvalidInputError {
  return cause instanceof InvalidInputError || cause instanceof ProviderError
    ? cause
    : new ProviderError({
        message: cause instanceof Error ? cause.name : "Provider callback failed",
        providerId,
      });
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
