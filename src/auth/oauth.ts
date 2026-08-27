import * as oauth from "oauth4webapi";

import { AuthorizationError, InvalidInputError, ProviderError } from "../errors.ts";
import { sha256 } from "../plan/canonical-json.ts";
import type { ConnectionStore, CredentialStore, OAuthStateStore } from "../stores/contracts.ts";
import { Secret } from "./secret.ts";
import type {
  Connection,
  OAuthClientConfiguration,
  OAuthMethod,
  OAuthSubjectResolver,
  StoredCredential,
} from "./types.ts";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface BeginOAuthInput {
  readonly client: OAuthClientConfiguration;
  readonly grant: Connection["grant"];
  readonly method: OAuthMethod;
  readonly now?: () => Date;
  readonly redirectUri: string;
  readonly stateStore: OAuthStateStore;
  readonly subjectId: string;
  readonly ttlMs?: number;
}

export async function beginOAuth(
  input: BeginOAuthInput,
): Promise<{ readonly authorizationUrl: URL }> {
  const now = (input.now ?? (() => new Date()))();
  const state = oauth.generateRandomState();
  const codeVerifier = oauth.generateRandomCodeVerifier();
  const challenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  const stateHash = await sha256(state);
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

  await input.stateStore.put({
    clientId: input.client.clientId,
    codeVerifier: Secret.from(codeVerifier),
    expiresAt: new Date(now.getTime() + (input.ttlMs ?? 10 * 60_000)).toISOString(),
    grant: input.grant,
    method: input.method,
    redirectUri: input.redirectUri,
    stateHash,
    subjectId: input.subjectId,
  });
  return { authorizationUrl };
}

export async function completeOAuth(input: {
  readonly callbackUrl: URL;
  readonly client: OAuthClientConfiguration;
  readonly connectionStore: ConnectionStore;
  readonly credentialStore: CredentialStore;
  readonly fetch?: Fetch;
  readonly now?: () => Date;
  readonly providerId: string;
  readonly resolveSubject: OAuthSubjectResolver;
  readonly stateStore: OAuthStateStore;
}): Promise<Connection> {
  const state = input.callbackUrl.searchParams.get("state");
  if (state === null) throw new AuthorizationError({ message: "OAuth callback is missing state" });
  const continuation = await input.stateStore.consume(
    await sha256(state),
    (input.now ?? (() => new Date()))(),
  );
  if (continuation === null) {
    throw new AuthorizationError({
      message: "OAuth continuation is expired, unknown, or already used",
    });
  }
  if (continuation.clientId !== input.client.clientId) {
    throw new AuthorizationError({ message: "OAuth client does not match the continuation" });
  }

  const as = continuation.method.authorizationServer as oauth.AuthorizationServer;
  const client: oauth.Client = { client_id: continuation.clientId };
  try {
    const callbackParameters = oauth.validateAuthResponse(as, client, input.callbackUrl, state);
    const response = await oauth.authorizationCodeGrantRequest(
      as,
      client,
      clientAuthentication(continuation.method, input.client),
      callbackParameters,
      continuation.redirectUri,
      continuation.codeVerifier.expose(),
      requestOptions(input.fetch),
    );
    const tokens = await oauth.processAuthorizationCodeResponse(as, client, response);
    const accessToken = Secret.from(tokens.access_token);
    const subject = await input.resolveSubject(tokens, accessToken);
    const now = (input.now ?? (() => new Date()))();
    const connection: Connection = {
      accountId: subject.accountId,
      capabilities: [...continuation.method.capabilities],
      createdAt: now.toISOString(),
      expiresAt: subject.expiresAt,
      grant: continuation.grant,
      id: crypto.randomUUID(),
      kind: "oauth2",
      providerId: input.providerId,
      scopes: (tokens.scope ?? continuation.method.scopes.join(" ")).split(" ").filter(Boolean),
      subjectId: continuation.subjectId,
    };
    await input.credentialStore.put(connection.id, {
      accessToken,
      refreshToken: tokens.refresh_token === undefined ? null : Secret.from(tokens.refresh_token),
      tokenType: tokens.token_type,
    });
    await input.connectionStore.put(connection);
    return connection;
  } catch (cause) {
    if (cause instanceof AuthorizationError || cause instanceof InvalidInputError) throw cause;
    throw new ProviderError({ message: safeOAuthMessage(cause), providerId: input.providerId });
  }
}

export async function refreshOAuth(input: {
  readonly client: OAuthClientConfiguration;
  readonly connection: Connection;
  readonly credentialStore: CredentialStore;
  readonly fetch?: Fetch;
  readonly method: OAuthMethod;
}): Promise<void> {
  const credential = await requireCredential(input.connection.id, input.credentialStore);
  if (credential.refreshToken === null) {
    throw new AuthorizationError({ message: "Connection has no refresh token" });
  }
  const as = input.method.authorizationServer as oauth.AuthorizationServer;
  const client: oauth.Client = { client_id: input.client.clientId };
  try {
    const response = await oauth.refreshTokenGrantRequest(
      as,
      client,
      clientAuthentication(input.method, input.client),
      credential.refreshToken.expose(),
      requestOptions(input.fetch),
    );
    const tokens = await oauth.processRefreshTokenResponse(as, client, response);
    await input.credentialStore.put(input.connection.id, {
      accessToken: Secret.from(tokens.access_token),
      refreshToken:
        tokens.refresh_token === undefined
          ? credential.refreshToken
          : Secret.from(tokens.refresh_token),
      tokenType: tokens.token_type,
    });
  } catch (cause) {
    throw new ProviderError({
      message: safeOAuthMessage(cause),
      providerId: input.connection.providerId,
    });
  }
}

export async function revokeOAuth(input: {
  readonly client: OAuthClientConfiguration;
  readonly connection: Connection;
  readonly credentialStore: CredentialStore;
  readonly fetch?: Fetch;
  readonly method: OAuthMethod;
}): Promise<void> {
  if (input.method.authorizationServer.revocation_endpoint === undefined) {
    throw new AuthorizationError({ message: "Provider does not advertise token revocation" });
  }
  const credential = await requireCredential(input.connection.id, input.credentialStore);
  const as = input.method.authorizationServer as oauth.AuthorizationServer;
  try {
    const response = await oauth.revocationRequest(
      as,
      { client_id: input.client.clientId },
      clientAuthentication(input.method, input.client),
      credential.accessToken.expose(),
      requestOptions(input.fetch),
    );
    await oauth.processRevocationResponse(response);
    await input.credentialStore.delete(input.connection.id);
  } catch (cause) {
    throw new ProviderError({
      message: safeOAuthMessage(cause),
      providerId: input.connection.providerId,
    });
  }
}

function clientAuthentication(
  method: OAuthMethod,
  client: OAuthClientConfiguration,
): oauth.ClientAuth {
  switch (method.clientAuth) {
    case "none":
      return oauth.None();
    case "client_secret_basic":
      if (client.clientSecret === undefined)
        throw new InvalidInputError({ message: "Client secret is required" });
      return oauth.ClientSecretBasic(client.clientSecret.expose());
    case "client_secret_post":
      if (client.clientSecret === undefined)
        throw new InvalidInputError({ message: "Client secret is required" });
      return oauth.ClientSecretPost(client.clientSecret.expose());
  }
}

function requestOptions(fetchImplementation?: Fetch): oauth.TokenEndpointRequestOptions {
  return fetchImplementation === undefined
    ? {}
    : {
        [oauth.customFetch]: (url, options) =>
          fetchImplementation(url, {
            ...options,
            body: options.body,
          }),
      };
}

async function requireCredential(
  connectionId: string,
  store: CredentialStore,
): Promise<StoredCredential> {
  const credential = await store.get(connectionId);
  if (credential === null)
    throw new AuthorizationError({ message: "Connection credentials are unavailable" });
  return credential;
}

function safeOAuthMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.name;
  return "OAuth provider request failed";
}
