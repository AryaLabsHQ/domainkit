import { Clock, Crypto, Effect } from "effect";
import * as oauth from "oauth4webapi";

import { Error as InvalidInputError } from "../invalid-input.ts";
import { CryptoError, sha256Text } from "../plan/canonical-json.ts";
import * as DnsProvider from "../provider/provider.ts";
import type * as Storage from "../stores/error.ts";
import * as OAuthStateStore from "../stores/oauth-state.ts";
import * as Connection from "./connection.ts";
import * as ProviderAuthorization from "./authorization.ts";
import * as Connect from "./connect.ts";
import * as Lifecycle from "./lifecycle-repository.ts";
import type * as ProviderAuth from "./manifest.ts";
import { Value as Secret } from "./secret.ts";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface BeginInput {
  readonly client: ProviderAuth.OAuthClientConfiguration;
  readonly method: ProviderAuth.OAuthMethod;
  readonly authorizationId?: string;
  readonly ownerId: string;
  readonly redirectUri: string;
  readonly authorizedById: string;
  readonly ttlMs?: number;
}

export interface OAuthSubjectResolver {
  (
    tokens: oauth.TokenEndpointResponse,
    accessToken: Secret,
  ): Effect.Effect<
    { readonly accountId: string; readonly expiresAt: Date | null },
    InvalidInputError | DnsProvider.Error
  >;
}

export type OAuthError =
  | Connection.AuthorizationError
  | Connect.Error
  | CryptoError
  | InvalidInputError
  | DnsProvider.Error
  | Storage.Error
  | Lifecycle.Error;

function beginProgram(
  input: BeginInput,
): Effect.Effect<
  { readonly authorizationUrl: URL },
  CryptoError | Storage.Error,
  OAuthStateStore.Service | Crypto.Crypto
> {
  return Effect.gen(function* () {
    const stateStore = yield* OAuthStateStore.Service;
    const cryptoService = yield* Crypto.Crypto;
    const now = yield* Clock.currentTimeMillis;
    const state = base64Url(yield* cryptoBytes(cryptoService, 32));
    const codeVerifier = base64Url(yield* cryptoBytes(cryptoService, 32));
    const challenge = base64Url(
      yield* cryptoService
        .digest("SHA-256", new TextEncoder().encode(codeVerifier))
        .pipe(Effect.mapError((cause) => new CryptoError({ message: cause.message }))),
    );
    const stateHash = yield* sha256Text(state);
    const authorizationUrl = new URL(input.method.authorizationServer.authorization_endpoint);
    authorizationUrl.search = new URLSearchParams({
      client_id: input.client.clientId,
      code_challenge: challenge,
      code_challenge_method: "S256",
      redirect_uri: input.redirectUri,
      response_type: "code",
      scope: input.method.scopes.join(" "),
      state,
    }).toString();

    yield* stateStore.put({
      clientId: input.client.clientId,
      codeVerifier: Secret.from(codeVerifier),
      expiresAt: new Date(now + (input.ttlMs ?? 10 * 60_000)),
      method: input.method,
      ...(input.authorizationId === undefined ? {} : { authorizationId: input.authorizationId }),
      ownerId: input.ownerId,
      redirectUri: input.redirectUri,
      stateHash,
      authorizedById: input.authorizedById,
    });
    return { authorizationUrl };
  });
}

function completeProgram(input: {
  readonly callbackUrl: URL;
  readonly client: ProviderAuth.OAuthClientConfiguration;
  readonly fetch?: Fetch;
  readonly providerId: string;
  readonly resolveSubject: OAuthSubjectResolver;
}): Effect.Effect<
  { readonly connection: Connection.ProviderConnection },
  OAuthError,
  OAuthStateStore.Service | Lifecycle.Service | Crypto.Crypto
> {
  return Effect.gen(function* () {
    const stateStore = yield* OAuthStateStore.Service;
    const state = input.callbackUrl.searchParams.get("state");
    if (state === null) {
      return yield* Connection.authorizationError(
        "OAuth callback is missing state",
        "OAuth.complete",
      );
    }
    const now = yield* Clock.currentTimeMillis;
    const continuation = yield* stateStore.consume(yield* sha256Text(state), new Date(now));
    if (continuation === null) {
      return yield* Connection.authorizationError(
        "OAuth continuation is expired, unknown, or already used",
        "OAuth.complete",
      );
    }
    if (continuation.clientId !== input.client.clientId) {
      return yield* Connection.authorizationError(
        "OAuth client does not match the continuation",
        "OAuth.complete",
      );
    }

    const as = continuation.method.authorizationServer as oauth.AuthorizationServer;
    const client: oauth.Client = { client_id: continuation.clientId };
    const authentication = yield* effectClientAuthentication(continuation.method, input.client);
    const tokens = yield* providerRequest(input.providerId, async (signal) => {
      const callbackParameters = oauth.validateAuthResponse(as, client, input.callbackUrl, state);
      const response = await oauth.authorizationCodeGrantRequest(
        as,
        client,
        authentication,
        callbackParameters,
        continuation.redirectUri,
        continuation.codeVerifier.expose(),
        requestOptions(input.fetch, signal),
      );
      return oauth.processAuthorizationCodeResponse(as, client, response);
    });
    const accessToken = Secret.from(tokens.access_token);
    const subject = yield* input.resolveSubject(tokens, accessToken);
    const aggregate = yield* Connect.connect({
      authentication: {
        capabilityEvidence: continuation.method.capabilities.map((capability) => ({
          capability,
          evidence: ProviderAuthorization.Evidence.Introspected({ observedAt: new Date(now) }),
        })),
        credential: {
          accessToken,
          refreshToken:
            tokens.refresh_token === undefined ? null : Secret.from(tokens.refresh_token),
          tokenType: tokens.token_type,
        },
        expiresAt: subject.expiresAt,
        providerAccountId: subject.accountId,
        providerContext: { value: {}, version: `${input.providerId}.v1` },
        scopes: (tokens.scope ?? continuation.method.scopes.join(" ")).split(" ").filter(Boolean),
      },
      authorizedById: continuation.authorizedById,
      ...(continuation.authorizationId === undefined
        ? {}
        : { authorizationId: continuation.authorizationId }),
      method: "oauth2",
      ownerId: continuation.ownerId,
      providerId: input.providerId,
      requiredCapabilities: [...continuation.method.capabilities],
    });
    const storedConnection = aggregate.connections.find(
      ({ ownerId }) => ownerId === continuation.ownerId,
    );
    if (storedConnection === undefined) {
      return yield* Connection.authorizationError(
        "Provider authorization returned no organization connection",
        "OAuth.complete",
      );
    }
    return {
      connection: Connection.project(storedConnection, aggregate.authorization, new Date(now)),
    };
  });
}

function refreshProgram(input: {
  readonly client: ProviderAuth.OAuthClientConfiguration;
  readonly authorization: ProviderAuthorization.ProviderAuthorization;
  readonly fetch?: Fetch;
  readonly method: ProviderAuth.OAuthMethod;
}): Effect.Effect<void, OAuthError, Lifecycle.Service> {
  return Effect.gen(function* () {
    const lifecycle = yield* Lifecycle.Service;
    const aggregate = yield* lifecycle.get(input.authorization.id);
    if (aggregate === null) {
      return yield* Connection.authorizationError(
        "Connection credentials are unavailable",
        "OAuth.refresh",
      );
    }
    const credential = aggregate.credential;
    const refreshToken = credential.refreshToken;
    if (refreshToken === null) {
      return yield* Connection.authorizationError(
        "Connection has no refresh token",
        "OAuth.refresh",
      );
    }
    const as = input.method.authorizationServer as oauth.AuthorizationServer;
    const client: oauth.Client = { client_id: input.client.clientId };
    const authentication = yield* effectClientAuthentication(input.method, input.client);
    const tokens = yield* providerRequest(input.authorization.providerId, async (signal) => {
      const response = await oauth.refreshTokenGrantRequest(
        as,
        client,
        authentication,
        refreshToken.expose(),
        requestOptions(input.fetch, signal),
      );
      return oauth.processRefreshTokenResponse(as, client, response);
    });
    const expiresAt =
      typeof tokens.expires_in === "number"
        ? new Date(Date.now() + tokens.expires_in * 1_000)
        : input.authorization.expiresAt;
    yield* lifecycle.rotate(
      input.authorization.id,
      {
        accessToken: Secret.from(tokens.access_token),
        refreshToken:
          tokens.refresh_token === undefined
            ? credential.refreshToken
            : Secret.from(tokens.refresh_token),
        tokenType: tokens.token_type,
      },
      expiresAt,
    );
  });
}

function revokeProgram(input: {
  readonly client: ProviderAuth.OAuthClientConfiguration;
  readonly authorization: ProviderAuthorization.ProviderAuthorization;
  readonly fetch?: Fetch;
  readonly method: ProviderAuth.OAuthMethod;
}): Effect.Effect<void, OAuthError, Lifecycle.Service> {
  return Effect.gen(function* () {
    if (input.method.authorizationServer.revocation_endpoint === undefined) {
      return yield* Connection.authorizationError(
        "Provider does not advertise token revocation",
        "OAuth.revoke",
      );
    }
    const lifecycle = yield* Lifecycle.Service;
    const aggregate = yield* lifecycle.get(input.authorization.id);
    if (aggregate === null) {
      return yield* Connection.authorizationError(
        "Connection credentials are unavailable",
        "OAuth.revoke",
      );
    }
    const credential = aggregate.credential;
    const as = input.method.authorizationServer as oauth.AuthorizationServer;
    const authentication = yield* effectClientAuthentication(input.method, input.client);
    yield* providerRequest(input.authorization.providerId, async (signal) => {
      const response = await oauth.revocationRequest(
        as,
        { client_id: input.client.clientId },
        authentication,
        credential.accessToken.expose(),
        requestOptions(input.fetch, signal),
      );
      await oauth.processRevocationResponse(response);
    });
  });
}

function effectClientAuthentication(
  method: ProviderAuth.OAuthMethod,
  client: ProviderAuth.OAuthClientConfiguration,
): Effect.Effect<oauth.ClientAuth, InvalidInputError> {
  return Effect.try({
    try: () => clientAuthentication(method, client),
    catch: (cause) =>
      cause instanceof InvalidInputError
        ? cause
        : new InvalidInputError({ message: "OAuth client authentication is invalid" }),
  });
}

function clientAuthentication(
  method: ProviderAuth.OAuthMethod,
  client: ProviderAuth.OAuthClientConfiguration,
): oauth.ClientAuth {
  switch (method.clientAuth) {
    case "none":
      return oauth.None();
    case "client_secret_basic":
      if (client.clientSecret === undefined) {
        throw new InvalidInputError({ message: "Client secret is required" });
      }
      return oauth.ClientSecretBasic(client.clientSecret.expose());
    case "client_secret_post":
      if (client.clientSecret === undefined) {
        throw new InvalidInputError({ message: "Client secret is required" });
      }
      return oauth.ClientSecretPost(client.clientSecret.expose());
  }
}

function requestOptions(
  fetchImplementation: Fetch | undefined,
  signal: AbortSignal,
): oauth.TokenEndpointRequestOptions {
  return fetchImplementation === undefined
    ? { signal }
    : {
        signal,
        [oauth.customFetch]: (url, options) =>
          fetchImplementation(url, { ...options, body: options.body }),
      };
}

function providerRequest<A>(providerId: string, request: (signal: AbortSignal) => Promise<A>) {
  return Effect.tryPromise({
    try: request,
    catch: (cause) =>
      cause instanceof Connection.AuthorizationError || cause instanceof InvalidInputError
        ? cause
        : new DnsProvider.Error({
            cause,
            message: safeOAuthMessage(cause),
            operation: "oauthRequest",
            providerId,
          }),
  });
}

function cryptoBytes(
  cryptoService: Crypto.Crypto,
  size: number,
): Effect.Effect<Uint8Array, CryptoError> {
  return cryptoService
    .randomBytes(size)
    .pipe(Effect.mapError((cause) => new CryptoError({ message: cause.message })));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function safeOAuthMessage(cause: unknown): string {
  return cause instanceof Error ? cause.name : "OAuth provider request failed";
}

export const begin = Effect.fn("OAuth.begin")(beginProgram);
export const complete = Effect.fn("OAuth.complete")(completeProgram);
export const refresh = Effect.fn("OAuth.refresh")(refreshProgram);
export const revoke = Effect.fn("OAuth.revoke")(revokeProgram);
