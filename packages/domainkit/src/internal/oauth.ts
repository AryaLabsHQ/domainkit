import { DateTime, Effect, Redacted } from "effect";
import * as oauth from "oauth4webapi";

import * as Errors from "./error.ts";
import * as Reason from "../Reason.ts";
import type { Fetch } from "./http.ts";

export interface Server {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly revocation_endpoint?: string;
}

export type ClientAuth = "client_secret_basic" | "client_secret_post" | "none";

export interface Client {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string> | null;
  readonly clientAuth: ClientAuth;
}

/** A PKCE pair: the verifier stays in the continuation, the challenge goes to the provider. */
export const pkce = (): Effect.Effect<
  { readonly codeVerifier: string; readonly codeChallenge: string },
  Errors.DomainKitError
> =>
  Effect.tryPromise({
    try: async () => {
      const codeVerifier = oauth.generateRandomCodeVerifier();
      return { codeVerifier, codeChallenge: await oauth.calculatePKCECodeChallenge(codeVerifier) };
    },
    catch: () =>
      new Errors.DomainKitError({
        reason: new Reason.CryptoFailed({ operation: "digest" }),
      }),
  });

export const authorizationUrl = (input: {
  readonly server: Server;
  readonly clientId: string;
  readonly scopes: ReadonlyArray<string>;
  readonly state: string;
  readonly callbackUrl: string;
  readonly codeChallenge: string;
}): string => {
  const url = new URL(input.server.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    redirect_uri: input.callbackUrl,
    response_type: "code",
    scope: input.scopes.join(" "),
    state: input.state,
  }).toString();
  return url.toString();
};

export interface Tokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: DateTime.Utc | null;
  readonly scope: string | null;
}

const clientAuth = (client: Client): oauth.ClientAuth => {
  if (client.clientAuth === "none") return oauth.None();
  const secret = client.clientSecret === null ? "" : Redacted.value(client.clientSecret);
  return client.clientAuth === "client_secret_basic"
    ? oauth.ClientSecretBasic(secret)
    : oauth.ClientSecretPost(secret);
};

/**
 * oauth4webapi refuses plaintext endpoints, which is right for every server that carries a
 * credential over a network. An `http:` endpoint on this machine carries it nowhere: loopback, or
 * `host.docker.internal`, which a container resolves to its own host and which never leaves it.
 * That is the one exception; any other `http:` endpoint stays refused however a host configured it.
 */
const sameMachine = (endpoint: string | undefined): boolean => {
  const url = endpoint === undefined ? null : URL.parse(endpoint);
  if (url === null || url.protocol !== "http:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "host.docker.internal" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
};

const requestOptions = (
  endpoint: string | undefined,
  fetch: Fetch | undefined,
  signal: AbortSignal,
): oauth.TokenEndpointRequestOptions => ({
  signal,
  ...(sameMachine(endpoint) ? { [oauth.allowInsecureRequests]: true } : {}),
  ...(fetch === undefined
    ? {}
    : { [oauth.customFetch]: (url, init) => fetch(url, { ...init, body: init.body }) }),
});

const tokens = (response: oauth.TokenEndpointResponse, now: DateTime.Utc): Tokens => ({
  accessToken: response.access_token,
  refreshToken: response.refresh_token ?? null,
  expiresAt:
    typeof response.expires_in === "number"
      ? DateTime.add(now, { seconds: response.expires_in })
      : null,
  scope: response.scope ?? null,
});

const failure = (provider: string, cause: unknown): Errors.DomainKitError => {
  if (cause instanceof oauth.ResponseBodyError) {
    const terminal = ["invalid_grant", "invalid_client", "unauthorized_client"].includes(
      cause.error,
    );
    return new Errors.DomainKitError({
      reason: terminal
        ? new Reason.Unauthenticated({
            message: `${provider} rejected the grant: ${cause.error}`,
          })
        : new Reason.ProviderRejected({
            provider,
            code: cause.error,
            message: cause.error_description ?? cause.error,
          }),
    });
  }
  if (cause instanceof oauth.AuthorizationResponseError) {
    return new Errors.DomainKitError({
      reason: new Reason.Unauthenticated({
        message: `${provider} authorization failed: ${cause.error}`,
      }),
    });
  }
  return new Errors.DomainKitError({
    reason: new Reason.ProviderUnavailable({
      provider,
      message: cause instanceof Error ? cause.message : `${provider} OAuth request failed`,
    }),
  });
};

export const exchangeCode = (input: {
  readonly provider: string;
  readonly server: Server;
  readonly client: Client;
  readonly code: string;
  readonly state: string;
  readonly callbackUrl: string;
  readonly codeVerifier: string;
  readonly fetch?: Fetch;
}): Effect.Effect<Tokens, Errors.DomainKitError> =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const server = input.server as oauth.AuthorizationServer;
    const client: oauth.Client = { client_id: input.client.clientId };
    const response = yield* Effect.tryPromise({
      try: async (signal) => {
        const params = oauth.validateAuthResponse(
          server,
          client,
          new URLSearchParams({ code: input.code, state: input.state }),
          input.state,
        );
        const reply = await oauth.authorizationCodeGrantRequest(
          server,
          client,
          clientAuth(input.client),
          params,
          input.callbackUrl,
          input.codeVerifier,
          requestOptions(input.server.token_endpoint, input.fetch, signal),
        );
        return oauth.processAuthorizationCodeResponse(server, client, reply);
      },
      catch: (cause) => failure(input.provider, cause),
    });
    return tokens(response, now);
  });

export const refresh = (input: {
  readonly provider: string;
  readonly server: Server;
  readonly client: Client;
  readonly refreshToken: string;
  readonly fetch?: Fetch;
}): Effect.Effect<Tokens, Errors.DomainKitError> =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const server = input.server as oauth.AuthorizationServer;
    const client: oauth.Client = { client_id: input.client.clientId };
    const response = yield* Effect.tryPromise({
      try: async (signal) => {
        const reply = await oauth.refreshTokenGrantRequest(
          server,
          client,
          clientAuth(input.client),
          input.refreshToken,
          requestOptions(input.server.token_endpoint, input.fetch, signal),
        );
        return oauth.processRefreshTokenResponse(server, client, reply);
      },
      catch: (cause) => failure(input.provider, cause),
    });
    const next = tokens(response, now);
    return { ...next, refreshToken: next.refreshToken ?? input.refreshToken };
  });

export const revoke = (input: {
  readonly provider: string;
  readonly server: Server;
  readonly client: Client;
  readonly token: string;
  readonly fetch?: Fetch;
}): Effect.Effect<void, Errors.DomainKitError> =>
  Effect.tryPromise({
    try: async (signal) => {
      const server = input.server as oauth.AuthorizationServer;
      const client: oauth.Client = { client_id: input.client.clientId };
      const reply = await oauth.revocationRequest(
        server,
        client,
        clientAuth(input.client),
        input.token,
        requestOptions(input.server.revocation_endpoint, input.fetch, signal),
      );
      await oauth.processRevocationResponse(reply);
    },
    catch: (cause) => failure(input.provider, cause),
  });
