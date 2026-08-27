import { Effect, Layer } from "effect";

import * as Connection from "../auth/connection.ts";
import * as OAuthEffect from "../auth/oauth.ts";
import type * as ProviderAuth from "../auth/manifest.ts";
import { Error as InvalidInputError } from "../invalid-input.ts";
import { webCryptoLayer } from "../plan/canonical-json.ts";
import * as DnsProvider from "../provider/provider.ts";
import * as ConnectionStore from "../stores/connection.ts";
import * as CredentialStore from "../stores/credential.ts";
import * as OAuthStateStore from "../stores/oauth-state.ts";

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
  readonly connectionStore: ConnectionStore.AsyncInterface;
  readonly credentialStore: CredentialStore.AsyncInterface;
  readonly fetch?: OAuthEffect.Fetch;
  readonly providerId: string;
  readonly resolveSubject: ProviderAuth.AsyncOAuthSubjectResolver;
  readonly stateStore: OAuthStateStore.AsyncInterface;
}): Promise<Connection.Connection> {
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
        Layer.mergeAll(
          OAuthStateStore.layerFromAsync(input.stateStore),
          ConnectionStore.layerFromAsync(input.connectionStore),
          CredentialStore.layerFromAsync(input.credentialStore),
          webCryptoLayer,
        ),
      ),
    ),
  );
}

export function refresh(input: {
  readonly client: ProviderAuth.OAuthClientConfiguration;
  readonly connection: Connection.Connection;
  readonly credentialStore: CredentialStore.AsyncInterface;
  readonly fetch?: OAuthEffect.Fetch;
  readonly method: ProviderAuth.OAuthMethod;
}): Promise<void> {
  return Effect.runPromise(
    OAuthEffect.refresh({
      client: input.client,
      connection: input.connection,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      method: input.method,
    }).pipe(Effect.provide(CredentialStore.layerFromAsync(input.credentialStore))),
  );
}

export function revoke(input: {
  readonly client: ProviderAuth.OAuthClientConfiguration;
  readonly connection: Connection.Connection;
  readonly credentialStore: CredentialStore.AsyncInterface;
  readonly fetch?: OAuthEffect.Fetch;
  readonly method: ProviderAuth.OAuthMethod;
}): Promise<void> {
  return Effect.runPromise(
    OAuthEffect.revoke({
      client: input.client,
      connection: input.connection,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      method: input.method,
    }).pipe(Effect.provide(CredentialStore.layerFromAsync(input.credentialStore))),
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
        message: cause instanceof Error ? cause.message : "Provider callback failed",
        operation,
        providerId,
      });
}

export type Fetch = OAuthEffect.Fetch;
