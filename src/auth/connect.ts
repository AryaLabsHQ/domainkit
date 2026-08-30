import { Clock, Crypto, Data, Effect, Schema } from "effect";

import { CryptoError } from "../plan/canonical-json.ts";
import type { Error as InvalidInputError } from "../invalid-input.ts";
import type * as DnsProvider from "../provider/provider.ts";
import * as DomainName from "../domain/domain-name.ts";
import * as ProviderAuthorization from "./authorization.ts";
import * as Binding from "./connection.ts";
import * as Repository from "./lifecycle-repository.ts";
import type * as ProviderContext from "./provider-context.ts";
import type * as Secret from "./secret.ts";

export interface Authentication {
  readonly capabilityEvidence: ReadonlyArray<ProviderAuthorization.CapabilityEvidence>;
  readonly credential: Binding.StoredCredential;
  readonly expiresAt: Date | null;
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
  Connected: { readonly aggregate: Repository.Aggregate };
  Redirect: { readonly authorizationUrl: URL; readonly continuationId: string };
}>;
export const StartResult = Data.taggedEnum<StartResult>();

export class Error extends Schema.TaggedError<Error>()("ConnectionError", {
  category: Schema.Literals(["authorization", "provider", "validation"]),
  message: Schema.String,
  operation: Schema.String,
  retry: Schema.Literals(["never", "after-user-action", "safe", "unknown"]),
}) {}

export interface BaseInput {
  readonly authorizedById: string;
  readonly grant: Binding.Grant;
  readonly ownerId: string;
}

export interface CompleteInput {
  readonly callbackUrl: URL;
  readonly continuationId: string;
  readonly continuations: ContinuationStore;
  readonly flow: InteractiveFlow;
}

export interface ExtendInput {
  readonly connectionId: string;
  readonly grant: Binding.Grant;
  readonly ownerId: string;
}

export interface RemoveDomainInput {
  readonly connectionId: string;
  readonly domain: string;
  readonly ownerId: string;
}

export type RemoveDomainResult = Data.TaggedEnum<{
  AlreadyRemoved: { readonly aggregate: Repository.Aggregate };
  Removed: { readonly aggregate: Repository.Aggregate };
}>;
export const RemoveDomainResult = Data.taggedEnum<RemoveDomainResult>();

const persist = Effect.fn("Connection.persist")(function* (
  input: BaseInput & {
    readonly authentication: Authentication;
    readonly method: "integration" | "oauth2" | "token";
    readonly providerId: string;
    readonly requiredCapabilities: ReadonlyArray<ProviderAuthorization.Capability>;
  },
) {
  const repository = yield* Repository.Service;
  const crypto = yield* Crypto.Crypto;
  const now = new Date(yield* Clock.currentTimeMillis);
  const missingCapability = input.requiredCapabilities.find(
    (capability) =>
      !input.authentication.capabilityEvidence.some((item) => item.capability === capability),
  );
  if (missingCapability !== undefined) {
    return yield* new Error({
      category: "authorization",
      message: `Provider authorization lacks evidence for ${missingCapability}`,
      operation: "Connection.persist",
      retry: "after-user-action",
    });
  }
  const existing = yield* repository.findByProviderAccount(
    input.providerId,
    input.authentication.providerAccountId,
  );
  const authorizationId =
    existing?.authorization.id ??
    (yield* crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new Error({
            category: "validation",
            message: cause.message,
            operation: "Connection.persist",
            retry: "safe",
          }),
      ),
    ));
  const existingBinding = existing?.bindings.find((binding) => binding.ownerId === input.ownerId);
  const binding: Binding.Connection = {
    authorizationId,
    createdAt: existingBinding?.createdAt ?? now,
    grant: Binding.includeDomains(existingBinding?.grant, input.grant),
    id:
      existingBinding?.id ??
      (yield* crypto.randomUUIDv4.pipe(
        Effect.mapError(
          (cause) =>
            new Error({
              category: "validation",
              message: cause.message,
              operation: "Connection.persist",
              retry: "safe",
            }),
        ),
      )),
    ownerId: input.ownerId,
  };
  const aggregate: Repository.Aggregate = {
    authorization: {
      authorizedById: input.authorizedById,
      capabilityEvidence: [...input.authentication.capabilityEvidence],
      createdAt: existing?.authorization.createdAt ?? now,
      expiresAt: input.authentication.expiresAt,
      id: authorizationId,
      method: input.method,
      providerAccountId: input.authentication.providerAccountId,
      providerContext: input.authentication.providerContext,
      providerId: input.providerId,
      requiredCapabilities: [...input.requiredCapabilities],
      revocation: { _tag: "Active" },
      scopes: [...input.authentication.scopes],
    },
    bindings: [
      ...(existing?.bindings.filter((candidate) => candidate.id !== binding.id) ?? []),
      binding,
    ],
    credential: input.authentication.credential,
  };
  return yield* repository.connect(aggregate);
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
      expiresAt: new Date(now + (input.method.ttlMs ?? 10 * 60_000)),
      grant: input.grant,
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
  const aggregate = yield* persist({
    authentication,
    authorizedById: input.authorizedById,
    grant: input.grant,
    method: "token",
    ownerId: input.ownerId,
    providerId: input.method.providerId,
    requiredCapabilities: input.method.requiredCapabilities,
  });
  return StartResult.Connected({ aggregate });
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
  return yield* persist({
    authentication,
    authorizedById: continuation.authorizedById,
    grant: continuation.grant,
    method: continuation.method,
    ownerId: continuation.ownerId,
    providerId: continuation.providerId,
    requiredCapabilities: continuation.requiredCapabilities,
  });
});

/** Extends one owner binding without repeating provider authentication. */
export const extend = Effect.fn("Connection.extend")(function* (input: ExtendInput) {
  const repository = yield* Repository.Service;
  const aggregate = yield* repository.getByConnectionId(input.connectionId);
  const binding = aggregate?.bindings.find(({ id }) => id === input.connectionId);
  if (aggregate === null || binding === undefined || binding.ownerId !== input.ownerId) {
    return yield* new Error({
      category: "authorization",
      message: "Connection does not belong to this owner",
      operation: "Connection.extend",
      retry: "never",
    });
  }
  if (aggregate.authorization.revocation._tag !== "Active") {
    return yield* new Error({
      category: "authorization",
      message: "Provider authorization is awaiting revocation",
      operation: "Connection.extend",
      retry: "after-user-action",
    });
  }
  const now = new Date(yield* Clock.currentTimeMillis);
  if (
    aggregate.authorization.expiresAt !== null &&
    (Number.isNaN(aggregate.authorization.expiresAt.getTime()) ||
      aggregate.authorization.expiresAt <= now)
  ) {
    return yield* new Error({
      category: "authorization",
      message: "Provider authorization has expired",
      operation: "Connection.extend",
      retry: "after-user-action",
    });
  }
  return yield* repository.bind(aggregate.authorization.id, {
    ...binding,
    grant: Binding.includeDomains(binding.grant, input.grant),
  });
});

/** Removes one domain from an owner binding without revoking provider authorization. */
export const removeDomain = Effect.fn("Connection.removeDomain")(function* (
  input: RemoveDomainInput,
) {
  const repository = yield* Repository.Service;
  const aggregate = yield* repository.getByConnectionId(input.connectionId);
  const binding = aggregate?.bindings.find(({ id }) => id === input.connectionId);
  if (aggregate === null || binding === undefined || binding.ownerId !== input.ownerId) {
    return yield* new Error({
      category: "authorization",
      message: "Connection does not belong to this owner",
      operation: "Connection.removeDomain",
      retry: "never",
    });
  }
  const domain = yield* DomainName.decode(input.domain).pipe(
    Effect.mapError(
      (cause) =>
        new Error({
          category: "validation",
          message: cause.message,
          operation: "Connection.removeDomain",
          retry: "never",
        }),
    ),
  );
  const updated = yield* repository.modifyBinding(input.connectionId, (current) => {
    if (!Binding.coversDomain(current.grant, domain)) {
      return { binding: current, value: false };
    }
    return {
      binding: { ...current, grant: Binding.removeDomain(current.grant, domain) },
      value: true,
    };
  });
  return updated.value
    ? RemoveDomainResult.Removed({ aggregate: updated.aggregate })
    : RemoveDomainResult.AlreadyRemoved({ aggregate: updated.aggregate });
});

export type Requirements = Repository.Service | Crypto.Crypto;
export type Failure = AuthenticationFailure | Repository.Error | CryptoError;
