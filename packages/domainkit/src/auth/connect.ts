import { Clock, Crypto, Data, Effect, Schema } from "effect";

import { CryptoError } from "../plan/canonical-json.ts";
import type { Error as InvalidInputError } from "../invalid-input.ts";
import type * as DnsProvider from "../provider/provider.ts";
import * as ProviderAuthorization from "./authorization.ts";
import * as Connection from "./connection.ts";
import * as Repository from "./lifecycle-repository.ts";
import type * as ProviderContext from "./provider-context.ts";
import type * as Secret from "./secret.ts";

export interface Authentication {
  readonly capabilityEvidence: ReadonlyArray<ProviderAuthorization.CapabilityEvidence>;
  readonly credential: Connection.StoredCredential;
  readonly expiresAt: Date | null;
  /** Provider-specific subject identity used only during authentication; targets are selected later. */
  readonly providerAccountId: string;
  readonly providerContext: ProviderContext.Envelope;
  readonly scopes: ReadonlyArray<string>;
}

export type AuthenticationFailure = Error | InvalidInputError | DnsProvider.Error;

export interface InteractiveStart {
  readonly authorizationUrl: URL;
  readonly payload: Secret.Value;
}

export interface Continuation extends BaseInput {
  readonly expiresAt: Date;
  readonly id: string;
  readonly method: "integration" | "oauth2";
  readonly payload: Secret.Value;
  readonly providerId: string;
  readonly requiredCapabilities: ReadonlyArray<ProviderAuthorization.Capability>;
}

export interface ContinuationStore {
  readonly consume: (id: string, now: Date) => Effect.Effect<Continuation | null, Error>;
  readonly put: (continuation: Continuation) => Effect.Effect<void, Error>;
}

export interface InteractiveFlow {
  readonly complete: (
    payload: Secret.Value,
    callbackUrl: URL,
  ) => Effect.Effect<Authentication, AuthenticationFailure>;
  readonly method: "integration" | "oauth2";
  readonly providerId: string;
  readonly requiredCapabilities: ReadonlyArray<ProviderAuthorization.Capability>;
  readonly start: (
    continuationId: string,
  ) => Effect.Effect<InteractiveStart, AuthenticationFailure, Crypto.Crypto>;
}

export type Method = Data.TaggedEnum<{
  Interactive: {
    readonly continuations: ContinuationStore;
    readonly flow: InteractiveFlow;
    readonly ttlMs?: number;
  };
  Token: {
    readonly authenticate: (
      token: Secret.Value,
    ) => Effect.Effect<Authentication, AuthenticationFailure>;
    readonly providerId: string;
    readonly requiredCapabilities: ReadonlyArray<ProviderAuthorization.Capability>;
    readonly token: Secret.Value;
  };
}>;
export const Method = Data.taggedEnum<Method>();

export type StartResult = Data.TaggedEnum<{
  Connected: { readonly connection: Connection.ProviderConnection };
  Redirect: { readonly authorizationUrl: URL; readonly continuationId: string };
}>;
export const StartResult = Data.taggedEnum<StartResult>();

export class Error extends Schema.TaggedError<Error>()("ConnectionError", {
  category: Schema.Literals(["authorization", "provider", "validation"]),
  message: Schema.String,
  operation: Schema.String,
  retry: Schema.Literals(["never", "after-user-action", "safe", "unknown"]),
}) {}

/** Inputs shared by token and interactive connection flows. */
export interface BaseInput {
  readonly authorizedById: string;
  /** Existing authorization may be supplied only after the host completed fresh provider proof. */
  readonly authorizationId?: string;
  readonly ownerId: string;
}

export interface CompleteInput {
  readonly callbackUrl: URL;
  readonly continuationId: string;
  readonly continuations: ContinuationStore;
  readonly flow: InteractiveFlow;
}

export interface ConnectInput extends BaseInput {
  readonly authentication: Authentication;
  readonly method: "integration" | "oauth2" | "token";
  readonly providerId: string;
  readonly requiredCapabilities: ReadonlyArray<ProviderAuthorization.Capability>;
}

const missingCapability = (
  authentication: Authentication,
  requiredCapabilities: ReadonlyArray<ProviderAuthorization.Capability>,
): ProviderAuthorization.Capability | undefined =>
  requiredCapabilities.find(
    (capability) =>
      !authentication.capabilityEvidence.some((item) => item.capability === capability),
  );

const freshId = Effect.fn("Connection.freshId")(function* () {
  const crypto = yield* Crypto.Crypto;
  return yield* crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new Error({
          category: "validation",
          message: cause.message,
          operation: "Connection.connect",
          retry: "safe",
        }),
    ),
  );
});

/** Persist one authenticated provider connection, optionally reusing a proven authorization. */
export const connect = Effect.fn("Connection.connect")(function* (input: ConnectInput) {
  const repository = yield* Repository.Service;
  const now = new Date(yield* Clock.currentTimeMillis);
  const missing = missingCapability(input.authentication, input.requiredCapabilities);
  if (missing !== undefined) {
    return yield* new Error({
      category: "authorization",
      message: `Provider authorization lacks evidence for ${missing}`,
      operation: "Connection.connect",
      retry: "after-user-action",
    });
  }

  const existing =
    input.authorizationId === undefined ? null : yield* repository.get(input.authorizationId);
  if (input.authorizationId !== undefined && existing === null) {
    return yield* new Error({
      category: "authorization",
      message: "Provider authorization does not exist",
      operation: "Connection.connect",
      retry: "after-user-action",
    });
  }
  if (existing?.authorization.revocation._tag === "Pending") {
    return yield* new Error({
      category: "authorization",
      message: "Provider authorization is awaiting revocation recovery",
      operation: "Connection.connect",
      retry: "after-user-action",
    });
  }
  if (
    existing !== null &&
    (existing.authorization.providerId !== input.providerId ||
      existing.authorization.method !== input.method)
  ) {
    return yield* new Error({
      category: "authorization",
      message: "Provider proof does not match the existing authorization",
      operation: "Connection.connect",
      retry: "never",
    });
  }

  const authorizationId = existing?.authorization.id ?? (yield* freshId());
  const authorization: ProviderAuthorization.ProviderAuthorization =
    existing === null
      ? {
          authorizedById: input.authorizedById,
          capabilityEvidence: [...input.authentication.capabilityEvidence],
          createdAt: now,
          expiresAt: input.authentication.expiresAt,
          id: authorizationId,
          method: input.method,
          providerContext: input.authentication.providerContext,
          providerId: input.providerId,
          requiredCapabilities: [...input.requiredCapabilities],
          revocation: { _tag: "Active" },
          scopes: [...input.authentication.scopes],
        }
      : {
          ...existing.authorization,
          capabilityEvidence: mergeEvidence(
            existing.authorization.capabilityEvidence,
            input.authentication.capabilityEvidence,
          ),
          expiresAt: input.authentication.expiresAt,
          method: input.method,
          providerContext: input.authentication.providerContext,
          requiredCapabilities: [...input.requiredCapabilities],
          revocation: { _tag: "Active" },
          scopes: [...input.authentication.scopes],
        };
  const existingConnection = yield* repository.findConnection(input.ownerId, authorizationId);
  const connection: Connection.StoredConnection = {
    authorizationId,
    createdAt: existingConnection?.createdAt ?? now,
    id: existingConnection?.id ?? (yield* freshId()),
    method: input.method,
    ownerId: input.ownerId,
    providerId: input.providerId,
  };
  return yield* repository.connect({
    authorization,
    connection,
    credential: input.authentication.credential,
    ...(existing === null ? {} : { expectedAuthorizationId: existing.authorization.id }),
    ...(existingConnection === null ? {} : { expectedConnectionId: existingConnection.id }),
  });
});

export const start = Effect.fn("Connection.start")(function* (
  input: BaseInput & { readonly method: Method },
) {
  if (input.method._tag === "Interactive") {
    const crypto = yield* Crypto.Crypto;
    const now = yield* Clock.currentTimeMillis;
    const continuationId = yield* crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new Error({
            category: "validation",
            message: cause.message,
            operation: "Connection.start",
            retry: "safe",
          }),
      ),
    );
    const started = yield* input.method.flow.start(continuationId);
    yield* input.method.continuations.put({
      authorizedById: input.authorizedById,
      ...(input.authorizationId === undefined ? {} : { authorizationId: input.authorizationId }),
      expiresAt: new Date(now + (input.method.ttlMs ?? 10 * 60_000)),
      id: continuationId,
      method: input.method.flow.method,
      ownerId: input.ownerId,
      payload: started.payload,
      providerId: input.method.flow.providerId,
      requiredCapabilities: [...input.method.flow.requiredCapabilities],
    });
    return StartResult.Redirect({
      authorizationUrl: started.authorizationUrl,
      continuationId,
    });
  }
  const authentication = yield* input.method.authenticate(input.method.token);
  const aggregate = yield* connect({
    authentication,
    authorizedById: input.authorizedById,
    ...(input.authorizationId === undefined ? {} : { authorizationId: input.authorizationId }),
    method: "token",
    ownerId: input.ownerId,
    providerId: input.method.providerId,
    requiredCapabilities: input.method.requiredCapabilities,
  });
  const storedConnection = aggregate.connections.find(({ ownerId }) => ownerId === input.ownerId);
  if (storedConnection === undefined) {
    return yield* new Error({
      category: "validation",
      message: "Connected provider authorization returned no organization connection",
      operation: "Connection.start",
      retry: "safe",
    });
  }
  return StartResult.Connected({
    connection: Connection.project(storedConnection, aggregate.authorization),
  });
});

export const complete = Effect.fn("Connection.complete")(function* (input: CompleteInput) {
  const continuation = yield* input.continuations.consume(
    input.continuationId,
    new Date(yield* Clock.currentTimeMillis),
  );
  if (continuation === null) {
    return yield* new Error({
      category: "authorization",
      message: "Connection continuation is expired, unknown, or already consumed",
      operation: "Connection.complete",
      retry: "after-user-action",
    });
  }
  if (
    continuation.providerId !== input.flow.providerId ||
    continuation.method !== input.flow.method
  ) {
    return yield* new Error({
      category: "authorization",
      message: "Connection continuation does not match the provider flow",
      operation: "Connection.complete",
      retry: "never",
    });
  }
  const authentication = yield* input.flow.complete(continuation.payload, input.callbackUrl);
  const aggregate = yield* connect({
    authentication,
    authorizedById: continuation.authorizedById,
    ...(continuation.authorizationId === undefined
      ? {}
      : { authorizationId: continuation.authorizationId }),
    method: continuation.method,
    ownerId: continuation.ownerId,
    providerId: continuation.providerId,
    requiredCapabilities: continuation.requiredCapabilities,
  });
  const storedConnection = aggregate.connections.find(
    ({ ownerId }) => ownerId === continuation.ownerId,
  );
  if (storedConnection === undefined) {
    return yield* new Error({
      category: "validation",
      message: "Connected provider authorization returned no organization connection",
      operation: "Connection.complete",
      retry: "safe",
    });
  }
  return Connection.project(storedConnection, aggregate.authorization);
});

function mergeEvidence(
  current: ReadonlyArray<ProviderAuthorization.CapabilityEvidence>,
  incoming: ReadonlyArray<ProviderAuthorization.CapabilityEvidence>,
): ReadonlyArray<ProviderAuthorization.CapabilityEvidence> {
  const byCapability = new Map(current.map((item) => [item.capability, item]));
  for (const item of incoming) byCapability.set(item.capability, item);
  return [...byCapability.values()];
}

export type Requirements = Repository.Service | Crypto.Crypto;
export type Failure = AuthenticationFailure | Repository.Error | CryptoError;
