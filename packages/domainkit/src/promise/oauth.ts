import { Effect, Layer } from "effect";

import * as OAuthEffect from "../auth/oauth.ts";
import { Error as InvalidInputError } from "../invalid-input.ts";
import { webCryptoLayer } from "../plan/canonical-json.ts";
import * as DnsProvider from "../provider/provider.ts";
import * as OAuthStateStore from "../stores/oauth-state.ts";
import * as Lifecycle from "./managed-dns-connections.ts";
import type * as ProviderAuth from "../auth/manifest.ts";
import type * as ProviderAuthorization from "../auth/authorization.ts";

export interface BeginInput extends OAuthEffect.BeginInput {
  readonly stateStore: OAuthStateStore.AsyncInterface;
}

export function begin(input: BeginInput): Promise<{ readonly authorizationUrl: URL }> {
  const { stateStore, ...programInput } = input;
  return Effect.runPromise(
    OAuthEffect.begin(programInput).pipe(
      Effect.provide(Layer.merge(OAuthStateStore.layerFromAsync(stateStore), webCryptoLayer)),
    ),
  );
}

export function complete(input: {
  readonly callbackUrl: URL;
  readonly client: ProviderAuth.OAuthClientConfiguration;
  readonly fetch?: OAuthEffect.Fetch;
  readonly providerId: string;
  readonly repository: Lifecycle.AsyncInterface;
  readonly resolveSubject: ProviderAuth.AsyncOAuthSubjectResolver;
  readonly stateStore: OAuthStateStore.AsyncInterface;
}): Promise<{ readonly connection: import("../auth/connection.ts").ProviderConnection }> {
  return Effect.runPromise(
    OAuthEffect.complete({
      callbackUrl: input.callbackUrl,
      client: input.client,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      providerId: input.providerId,
      resolveSubject: (tokens, accessToken) =>
        Effect.tryPromise({
          try: () => input.resolveSubject(tokens, accessToken),
          catch: (cause) => providerFailure(input.providerId, "resolveSubject", cause),
        }),
    }).pipe(
      Effect.provide(
        Layer.merge(
          OAuthStateStore.layerFromAsync(input.stateStore),
          Layer.merge(Lifecycle.layerFromAsync(input.repository), webCryptoLayer),
        ),
      ),
    ),
  );
}

export function refresh(input: {
  readonly authorization: ProviderAuthorization.ProviderAuthorization;
  readonly client: ProviderAuth.OAuthClientConfiguration;
  readonly fetch?: OAuthEffect.Fetch;
  readonly method: ProviderAuth.OAuthMethod;
  readonly repository: Lifecycle.AsyncInterface;
}): Promise<void> {
  return Effect.runPromise(
    OAuthEffect.refresh({
      client: input.client,
      authorization: input.authorization,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      method: input.method,
    }).pipe(Effect.provide(Lifecycle.layerFromAsync(input.repository))),
  );
}

export function revoke(input: {
  readonly authorization: ProviderAuthorization.ProviderAuthorization;
  readonly client: ProviderAuth.OAuthClientConfiguration;
  readonly fetch?: OAuthEffect.Fetch;
  readonly method: ProviderAuth.OAuthMethod;
  readonly repository: Lifecycle.AsyncInterface;
}): Promise<void> {
  return Effect.runPromise(
    OAuthEffect.revoke({
      client: input.client,
      authorization: input.authorization,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      method: input.method,
    }).pipe(Effect.provide(Lifecycle.layerFromAsync(input.repository))),
  );
}

function providerFailure(
  providerId: string,
  operation: string,
  cause: unknown,
): DnsProvider.Error | InvalidInputError {
  return cause instanceof InvalidInputError || cause instanceof DnsProvider.Error
    ? cause
    : new DnsProvider.Error({
        cause,
        message: cause instanceof globalThis.Error ? cause.message : "Provider callback failed",
        operation,
        providerId,
      });
}

export type Fetch = OAuthEffect.Fetch;
