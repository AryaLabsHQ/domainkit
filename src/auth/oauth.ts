import { Clock, Crypto, Effect } from "effect";
import * as oauth from "oauth4webapi";

import { Error as InvalidInputError } from "../invalid-input.ts";
import { CryptoError, sha256Text } from "../plan/canonical-json.ts";
import * as DnsProvider from "../provider/provider.ts";
import * as ConnectionStore from "../stores/connection.ts";
import * as CredentialStore from "../stores/credential.ts";
import type * as Storage from "../stores/error.ts";
import * as OAuthStateStore from "../stores/oauth-state.ts";
import * as Connection from "./connection.ts";
import type * as ProviderAuth from "./manifest.ts";
import { Value as Secret } from "./secret.ts";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface BeginInput {
  readonly client: ProviderAuth.OAuthClientConfiguration;
  readonly grant: Connection.Grant;
  readonly method: ProviderAuth.OAuthMethod;
  readonly redirectUri: string;
  readonly subjectId: string;
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
  | CryptoError
  | InvalidInputError
  | DnsProvider.Error
  | Storage.Error;

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
      grant: input.grant,
      method: input.method,
      redirectUri: input.redirectUri,
      stateHash,
      subjectId: input.subjectId,
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
  Connection.Connection,
  OAuthError,
  OAuthStateStore.Service | ConnectionStore.Service | CredentialStore.Service | Crypto.Crypto
> {
  return Effect.gen(function* () {
    const stateStore = yield* OAuthStateStore.Service;
    const connectionStore = yield* ConnectionStore.Service;
    const credentialStore = yield* CredentialStore.Service;
    const cryptoService = yield* Crypto.Crypto;
    const state = input.callbackUrl.searchParams.get("state");
    if (state === null) {
      return yield* new Connection.AuthorizationError({
        message: "OAuth callback is missing state",
      });
    }
    const now = yield* Clock.currentTimeMillis;
    const continuation = yield* stateStore.consume(yield* sha256Text(state), new Date(now));
    if (continuation === null) {
      return yield* new Connection.AuthorizationError({
        message: "OAuth continuation is expired, unknown, or already used",
      });
    }
    if (continuation.clientId !== input.client.clientId) {
      return yield* new Connection.AuthorizationError({
        message: "OAuth client does not match the continuation",
      });
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
    const id = yield* cryptoService.randomUUIDv4.pipe(
      Effect.mapError((cause) => new CryptoError({ message: cause.message })),
    );
    const connection: Connection.Connection = {
      accountId: subject.accountId,
      capabilities: [...continuation.method.capabilities],
      createdAt: new Date(now),
      expiresAt: subject.expiresAt,
      grant: continuation.grant,
      id,
      kind: "oauth2",
      providerId: input.providerId,
      scopes: (tokens.scope ?? continuation.method.scopes.join(" ")).split(" ").filter(Boolean),
      subjectId: continuation.subjectId,
    };
    yield* credentialStore.put(connection.id, {
      accessToken,
      refreshToken: tokens.refresh_token === undefined ? null : Secret.from(tokens.refresh_token),
      tokenType: tokens.token_type,
    });
    yield* connectionStore.put(connection);
    return connection;
  });
}

function refreshProgram(input: {
  readonly client: ProviderAuth.OAuthClientConfiguration;
  readonly connection: Connection.Connection;
  readonly fetch?: Fetch;
  readonly method: ProviderAuth.OAuthMethod;
}): Effect.Effect<void, OAuthError, CredentialStore.Service> {
  return Effect.gen(function* () {
    const credentialStore = yield* CredentialStore.Service;
    const credential = yield* requireCredential(input.connection.id, credentialStore);
    const refreshToken = credential.refreshToken;
    if (refreshToken === null) {
      return yield* new Connection.AuthorizationError({
        message: "Connection has no refresh token",
      });
    }
    const as = input.method.authorizationServer as oauth.AuthorizationServer;
    const client: oauth.Client = { client_id: input.client.clientId };
    const authentication = yield* effectClientAuthentication(input.method, input.client);
    const tokens = yield* providerRequest(input.connection.providerId, async (signal) => {
      const response = await oauth.refreshTokenGrantRequest(
        as,
        client,
        authentication,
        refreshToken.expose(),
        requestOptions(input.fetch, signal),
      );
      return oauth.processRefreshTokenResponse(as, client, response);
    });
    yield* credentialStore.put(input.connection.id, {
      accessToken: Secret.from(tokens.access_token),
      refreshToken:
        tokens.refresh_token === undefined
          ? credential.refreshToken
          : Secret.from(tokens.refresh_token),
      tokenType: tokens.token_type,
    });
  });
}

function revokeProgram(input: {
  readonly client: ProviderAuth.OAuthClientConfiguration;
  readonly connection: Connection.Connection;
  readonly fetch?: Fetch;
  readonly method: ProviderAuth.OAuthMethod;
}): Effect.Effect<void, OAuthError, CredentialStore.Service> {
  return Effect.gen(function* () {
    if (input.method.authorizationServer.revocation_endpoint === undefined) {
      return yield* new Connection.AuthorizationError({
        message: "Provider does not advertise token revocation",
      });
    }
    const credentialStore = yield* CredentialStore.Service;
    const credential = yield* requireCredential(input.connection.id, credentialStore);
    const as = input.method.authorizationServer as oauth.AuthorizationServer;
    const authentication = yield* effectClientAuthentication(input.method, input.client);
    yield* providerRequest(input.connection.providerId, async (signal) => {
      const response = await oauth.revocationRequest(
        as,
        { client_id: input.client.clientId },
        authentication,
        credential.accessToken.expose(),
        requestOptions(input.fetch, signal),
      );
      await oauth.processRevocationResponse(response);
    });
    yield* credentialStore.delete(input.connection.id);
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

function requireCredential(
  connectionId: string,
  store: CredentialStore.Interface,
): Effect.Effect<Connection.StoredCredential, Connection.AuthorizationError | Storage.Error> {
  return store.get(connectionId).pipe(
    Effect.flatMap((credential) =>
      credential === null
        ? Effect.fail(
            new Connection.AuthorizationError({
              message: "Connection credentials are unavailable",
            }),
          )
        : Effect.succeed(credential),
    ),
  );
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
