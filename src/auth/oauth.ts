import { Clock, Crypto, Effect } from "effect";
import * as oauth from "oauth4webapi";

import {
  AuthorizationError,
  CryptoError,
  InvalidInputError,
  ProviderError,
  type StorageError,
} from "../errors.ts";
import { sha256 } from "../plan/canonical-json.ts";
import {
  ConnectionStore,
  type ConnectionStoreService,
  CredentialStore,
  type CredentialStoreService,
  OAuthStateStore,
  type OAuthStateStoreService,
} from "../stores/contracts.ts";
import { Secret } from "./secret.ts";
import type {
  Connection,
  OAuthClientConfiguration,
  OAuthMethod,
  StoredCredential,
} from "./types.ts";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface BeginOAuthInput {
  readonly client: OAuthClientConfiguration;
  readonly grant: Connection["grant"];
  readonly method: OAuthMethod;
  readonly redirectUri: string;
  readonly subjectId: string;
  readonly ttlMs?: number;
}

export interface OAuthSubjectResolver {
  (
    tokens: oauth.TokenEndpointResponse,
    accessToken: Secret,
  ): Effect.Effect<
    { readonly accountId: string; readonly expiresAt: string | null },
    InvalidInputError | ProviderError
  >;
}

export type OAuthError =
  | AuthorizationError
  | CryptoError
  | InvalidInputError
  | ProviderError
  | StorageError;

export function beginOAuth(
  input: BeginOAuthInput,
): Effect.Effect<
  { readonly authorizationUrl: URL },
  CryptoError | StorageError,
  OAuthStateStoreService | Crypto.Crypto
> {
  return Effect.gen(function* () {
    const stateStore = yield* OAuthStateStore;
    const cryptoService = yield* Crypto.Crypto;
    const now = yield* Clock.currentTimeMillis;
    const state = base64Url(yield* cryptoBytes(cryptoService, 32));
    const codeVerifier = base64Url(yield* cryptoBytes(cryptoService, 32));
    const challenge = base64Url(
      yield* cryptoService
        .digest("SHA-256", new TextEncoder().encode(codeVerifier))
        .pipe(Effect.mapError((cause) => new CryptoError({ message: cause.message }))),
    );
    const stateHash = yield* sha256(state);
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
      expiresAt: new Date(now + (input.ttlMs ?? 10 * 60_000)).toISOString(),
      grant: input.grant,
      method: input.method,
      redirectUri: input.redirectUri,
      stateHash,
      subjectId: input.subjectId,
    });
    return { authorizationUrl };
  });
}

export function completeOAuth(input: {
  readonly callbackUrl: URL;
  readonly client: OAuthClientConfiguration;
  readonly fetch?: Fetch;
  readonly providerId: string;
  readonly resolveSubject: OAuthSubjectResolver;
}): Effect.Effect<
  Connection,
  OAuthError,
  OAuthStateStoreService | ConnectionStoreService | CredentialStoreService | Crypto.Crypto
> {
  return Effect.gen(function* () {
    const stateStore = yield* OAuthStateStore;
    const connectionStore = yield* ConnectionStore;
    const credentialStore = yield* CredentialStore;
    const cryptoService = yield* Crypto.Crypto;
    const state = input.callbackUrl.searchParams.get("state");
    if (state === null) {
      return yield* new AuthorizationError({ message: "OAuth callback is missing state" });
    }
    const now = yield* Clock.currentTimeMillis;
    const continuation = yield* stateStore.consume(yield* sha256(state), new Date(now));
    if (continuation === null) {
      return yield* new AuthorizationError({
        message: "OAuth continuation is expired, unknown, or already used",
      });
    }
    if (continuation.clientId !== input.client.clientId) {
      return yield* new AuthorizationError({
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
    const connection: Connection = {
      accountId: subject.accountId,
      capabilities: [...continuation.method.capabilities],
      createdAt: new Date(now).toISOString(),
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

export function refreshOAuth(input: {
  readonly client: OAuthClientConfiguration;
  readonly connection: Connection;
  readonly fetch?: Fetch;
  readonly method: OAuthMethod;
}): Effect.Effect<void, OAuthError, CredentialStoreService> {
  return Effect.gen(function* () {
    const credentialStore = yield* CredentialStore;
    const credential = yield* requireCredential(input.connection.id, credentialStore);
    if (credential.refreshToken === null) {
      return yield* new AuthorizationError({ message: "Connection has no refresh token" });
    }
    const as = input.method.authorizationServer as oauth.AuthorizationServer;
    const client: oauth.Client = { client_id: input.client.clientId };
    const authentication = yield* effectClientAuthentication(input.method, input.client);
    const tokens = yield* providerRequest(input.connection.providerId, async (signal) => {
      const response = await oauth.refreshTokenGrantRequest(
        as,
        client,
        authentication,
        credential.refreshToken!.expose(),
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

export function revokeOAuth(input: {
  readonly client: OAuthClientConfiguration;
  readonly connection: Connection;
  readonly fetch?: Fetch;
  readonly method: OAuthMethod;
}): Effect.Effect<void, OAuthError, CredentialStoreService> {
  return Effect.gen(function* () {
    if (input.method.authorizationServer.revocation_endpoint === undefined) {
      return yield* new AuthorizationError({
        message: "Provider does not advertise token revocation",
      });
    }
    const credentialStore = yield* CredentialStore;
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
  method: OAuthMethod,
  client: OAuthClientConfiguration,
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
  method: OAuthMethod,
  client: OAuthClientConfiguration,
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
  store: CredentialStoreService,
): Effect.Effect<StoredCredential, AuthorizationError | StorageError> {
  return store
    .get(connectionId)
    .pipe(
      Effect.flatMap((credential) =>
        credential === null
          ? Effect.fail(
              new AuthorizationError({ message: "Connection credentials are unavailable" }),
            )
          : Effect.succeed(credential),
      ),
    );
}

function providerRequest<A>(providerId: string, request: (signal: AbortSignal) => Promise<A>) {
  return Effect.tryPromise({
    try: request,
    catch: (cause) =>
      cause instanceof AuthorizationError || cause instanceof InvalidInputError
        ? cause
        : new ProviderError({ message: safeOAuthMessage(cause), providerId }),
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
