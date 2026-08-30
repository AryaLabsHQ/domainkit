import { Crypto, Effect, Schema } from "effect";
import * as oauth from "oauth4webapi";

import type * as ProviderAuth from "./manifest.ts";
import * as Connection from "./connect.ts";
import * as Secret from "./secret.ts";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface Payload {
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly state: string;
}

export const start = Effect.fn("AuthorizationCode.start")(function* (input: {
  readonly client: ProviderAuth.OAuthClientConfiguration;
  readonly method: ProviderAuth.OAuthMethod;
  readonly redirectUri: string;
  readonly state: string;
}) {
  const crypto = yield* Crypto.Crypto;
  const codeVerifier = base64Url(yield* randomBytes(crypto, 32));
  const challenge = base64Url(yield* digest(crypto, codeVerifier));
  const authorizationUrl = new URL(input.method.authorizationServer.authorization_endpoint);
  authorizationUrl.search = new URLSearchParams({
    client_id: input.client.clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: input.method.scopes.join(" "),
    state: input.state,
  }).toString();
  return {
    authorizationUrl,
    payload: Secret.make(
      JSON.stringify({ codeVerifier, redirectUri: input.redirectUri, state: input.state }),
    ),
  };
});

export const complete = Effect.fn("AuthorizationCode.complete")(function* (input: {
  readonly callbackUrl: URL;
  readonly client: ProviderAuth.OAuthClientConfiguration;
  readonly fetch?: Fetch;
  readonly method: ProviderAuth.OAuthMethod;
  readonly payload: Secret.Value;
  readonly providerId: string;
}) {
  const payload = yield* decodePayload(input.payload);
  if (input.callbackUrl.searchParams.get("state") !== payload.state) {
    return yield* failure("Authorization callback state does not match its continuation");
  }
  const server = input.method.authorizationServer as oauth.AuthorizationServer;
  const client: oauth.Client = { client_id: input.client.clientId };
  const authentication = yield* clientAuthentication(input.method, input.client);
  return yield* Effect.tryPromise({
    try: async (signal) => {
      const callback = oauth.validateAuthResponse(server, client, input.callbackUrl, payload.state);
      const response = await oauth.authorizationCodeGrantRequest(
        server,
        client,
        authentication,
        callback,
        payload.redirectUri,
        payload.codeVerifier,
        requestOptions(input.fetch, signal),
      );
      return oauth.processAuthorizationCodeResponse(server, client, response);
    },
    catch: (cause) =>
      new Connection.Error({
        category: "provider",
        message: cause instanceof globalThis.Error ? cause.name : "OAuth provider request failed",
        operation: "AuthorizationCode.complete",
        retry: "unknown",
      }),
  });
});

const PayloadSchema = Schema.Struct({
  codeVerifier: Schema.String,
  redirectUri: Schema.String,
  state: Schema.String,
});

function decodePayload(payload: Secret.Value): Effect.Effect<Payload, Connection.Error> {
  return Schema.decodeUnknownEffect(Schema.fromJsonString(PayloadSchema))(payload.expose()).pipe(
    Effect.mapError(
      () =>
        new Connection.Error({
          category: "authorization",
          message: "OAuth continuation payload is invalid",
          operation: "AuthorizationCode",
          retry: "after-user-action",
        }),
    ),
  );
}

function clientAuthentication(
  method: ProviderAuth.OAuthMethod,
  client: ProviderAuth.OAuthClientConfiguration,
): Effect.Effect<oauth.ClientAuth, Connection.Error> {
  switch (method.clientAuth) {
    case "none":
      return Effect.succeed(oauth.None());
    case "client_secret_basic":
      return client.clientSecret === undefined
        ? failure("OAuth client secret is required")
        : Effect.succeed(oauth.ClientSecretBasic(client.clientSecret.expose()));
    case "client_secret_post":
      return client.clientSecret === undefined
        ? failure("OAuth client secret is required")
        : Effect.succeed(oauth.ClientSecretPost(client.clientSecret.expose()));
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

const failure = (message: string): Effect.Effect<never, Connection.Error> =>
  Effect.fail(
    new Connection.Error({
      category: "authorization",
      message,
      operation: "AuthorizationCode",
      retry: "after-user-action",
    }),
  );

function randomBytes(
  crypto: Crypto.Crypto,
  size: number,
): Effect.Effect<Uint8Array, Connection.Error> {
  return crypto.randomBytes(size).pipe(
    Effect.mapError(
      (cause) =>
        new Connection.Error({
          category: "validation",
          message: cause.message,
          operation: "AuthorizationCode.start",
          retry: "safe",
        }),
    ),
  );
}

function digest(crypto: Crypto.Crypto, value: string): Effect.Effect<Uint8Array, Connection.Error> {
  return crypto.digest("SHA-256", new TextEncoder().encode(value)).pipe(
    Effect.mapError(
      (cause) =>
        new Connection.Error({
          category: "validation",
          message: cause.message,
          operation: "AuthorizationCode.start",
          retry: "safe",
        }),
    ),
  );
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
