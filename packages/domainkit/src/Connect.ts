/**
 * Connect a provider, attach domains to it, and keep the credential alive. Interactive methods
 * (OAuth, integration) return a redirect and complete on callback; token methods connect in one
 * call. Reuse of an existing connection for a new domain is `attach`.
 */
import { Context, DateTime, Duration, Effect, Layer, Option, Redacted, Schema } from "effect";

import { Custody } from "./Custody.ts";
import * as DomainKitError from "./DomainKitError.ts";
import * as DomainName from "./DomainName.ts";
import { fresh } from "./internal/ids.ts";
import * as OAuth from "./internal/oauth.ts";
import { Principal } from "./Principal.ts";
import type * as Provider from "./Provider.ts";
import { Providers } from "./Providers.ts";
import * as Storage from "./Storage.ts";

type Fx<A> = Effect.Effect<A, DomainKitError.DomainKitError, Principal>;

export type Method =
  | { readonly _tag: "Token"; readonly token: Redacted.Redacted<string> }
  | { readonly _tag: "OAuth"; readonly returnTo?: string }
  | { readonly _tag: "Integration"; readonly returnTo?: string };
export const Method = {
  token: (token: Redacted.Redacted<string> | string): Method => ({
    _tag: "Token",
    token: typeof token === "string" ? Redacted.make(token) : token,
  }),
  oauth: (options: { readonly returnTo?: string } = {}): Method => ({ _tag: "OAuth", ...options }),
  integration: (options: { readonly returnTo?: string } = {}): Method => ({
    _tag: "Integration",
    ...options,
  }),
} as const;

/** Everything the UI needs about a domain's provider state. */
export interface Snapshot {
  readonly domain: string;
  readonly attachment: Storage.Attachment | null;
  readonly connection: Storage.Connection | null;
  readonly authorization: Pick<
    Storage.Authorization,
    "id" | "provider" | "method" | "capabilities" | "revocation"
  > | null;
  readonly lastReceiptId: string | null;
  /** Other connections of this owner that could serve this domain. */
  readonly reusable: ReadonlyArray<{
    readonly connection: Storage.Connection;
    readonly provider: string;
    readonly method: Storage.AuthMethod;
  }>;
  readonly providers: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly methods: ReadonlyArray<Provider.AuthMethod>;
  }>;
}

export type Started =
  | {
      readonly _tag: "Connected";
      readonly connection: Storage.Connection;
      readonly attachment: Storage.Attachment | null;
    }
  | {
      readonly _tag: "Redirect";
      readonly authorizationUrl: string;
      readonly continuationId: string;
    }
  | {
      readonly _tag: "SelectionRequired";
      readonly connection: Storage.Connection;
      readonly candidates: ReadonlyArray<Provider.Target>;
    };

export type Attached =
  | Storage.Attachment
  | { readonly _tag: "SelectionRequired"; readonly candidates: ReadonlyArray<Provider.Target> };

export type Refreshed = "current" | "refreshed" | "reconnect";

export interface Service {
  readonly inspect: (domain: string) => Fx<Snapshot>;
  /** Connect a provider and, when `domain` is given, attach it. Token methods finish here. */
  readonly start: (input: {
    readonly provider: string;
    readonly method: Method;
    readonly domain?: string;
    readonly callbackUrl?: string;
  }) => Fx<Started>;
  /** Finish an interactive connection from the provider callback (the full callback URL). */
  readonly complete: (input: {
    readonly continuationId: string;
    readonly callbackUrl: string;
  }) => Fx<Started>;
  readonly attach: (input: {
    readonly connectionId: string;
    readonly domain: string;
    readonly target?: Provider.Target;
  }) => Fx<Attached>;
  /** Records stay in DNS; DomainKit forgets the domain. Use `Cleanup` first to remove records. */
  readonly detach: (attachmentId: string) => Fx<void>;
  /** Detach every domain and revoke the credential at the provider when the method supports it. */
  readonly disconnect: (connectionId: string) => Fx<void>;
  /** Refresh a near-expiry credential, single-flighted. Called automatically before provider use. */
  readonly refresh: (connectionId: string) => Fx<Refreshed>;
  /** Live provider session for an attachment; used by Provision, Cleanup, Verify. */
  readonly session: (
    attachmentId: string,
  ) => Fx<{ readonly session: Provider.Session; readonly target: Provider.Target }>;
}

export class Connect extends Context.Service<Connect, Service>()("@domainkit/Connect") {}

/** Which owner-scoped reuse is allowed. Default: any connection of the same owner may serve any of its domains. */
export interface PolicyShape {
  readonly allowReuse: (input: {
    readonly connection: Storage.Connection;
    readonly domain: string;
  }) => Effect.Effect<boolean, never, Principal>;
  /** Refresh this long before expiry. Default 10 minutes. */
  readonly refreshBeforeMs: number;
  /** Continuation lifetime. Default 15 minutes. */
  readonly continuationTtlMs: number;
}
export const defaults: PolicyShape = {
  allowReuse: () => Effect.succeed(true),
  refreshBeforeMs: 10 * 60_000,
  continuationTtlMs: 15 * 60_000,
};
export class Policy extends Context.Reference<PolicyShape>("@domainkit/Connect/Policy", {
  defaultValue: () => defaults,
}) {}

// ---------------------------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------------------------

const Payload = Schema.Struct({
  method: Schema.Literals(["oauth", "integration"]),
  codeVerifier: Schema.NullOr(Schema.String),
  callbackUrl: Schema.String,
  domain: Schema.NullOr(Schema.String),
});

const Target = Schema.Struct({
  zone: Schema.String,
  context: Schema.Unknown,
  label: Schema.String,
});

const invalid = (message: string, field?: string) =>
  DomainKitError.fail(
    new DomainKitError.InvalidInput({ message, ...(field === undefined ? {} : { field }) }),
  );

export const make: Effect.Effect<Service, never, Storage.Storage | Custody | Providers> =
  Effect.gen(function* () {
    const storage = yield* Storage.Storage;
    const custody = yield* Custody;
    const providers = yield* Providers;

    const seal = (issued: Provider.IssuedCredential) =>
      Effect.gen(function* () {
        const ciphertext = yield* custody.seal(issued.secret);
        return new Storage.Credential({
          ciphertext,
          expiresAt: issued.expiresAt,
          rotatedAt: yield* DateTime.now,
        });
      });

    const open = (authorization: Storage.Authorization): Fx<Provider.Credential> =>
      Effect.gen(function* () {
        const row = yield* storage.authorizations.credential(authorization.id);
        const secret = yield* custody.open(row.ciphertext);
        return { secret, context: authorization.context };
      });

    const refresherFor = (definition: Provider.Definition, method: Storage.AuthMethod) =>
      method === "oauth"
        ? definition.auth.oauth?.refresh
        : method === "integration"
          ? definition.auth.integration?.refresh
          : undefined;

    const revokerFor = (definition: Provider.Definition, method: Storage.AuthMethod) =>
      method === "oauth"
        ? definition.auth.oauth?.revoke
        : method === "integration"
          ? definition.auth.integration?.revoke
          : undefined;

    const revokeAt = (authorization: Storage.Authorization): Fx<void> =>
      Effect.gen(function* () {
        const definition = yield* providers.get(authorization.provider);
        const revoke = revokerFor(definition, authorization.method);
        if (revoke === undefined) return;
        const credential = yield* open(authorization);
        yield* revoke(credential);
      });

    /** Finish revocations a crash interrupted; best effort, never blocks the caller. */
    const recover = storage.authorizations.recoverRevocations(revokeAt).pipe(Effect.ignore);

    const refresh: Service["refresh"] = (connectionId) =>
      Effect.gen(function* () {
        const policy = yield* Policy;
        const connection = yield* storage.connections.get(connectionId);
        const authorization = yield* storage.authorizations.get(connection.authorizationId);
        const definition = yield* providers.get(authorization.provider);
        const refresher = refresherFor(definition, authorization.method);
        const dueAt = (row: Storage.Credential, now: DateTime.Utc) =>
          row.expiresAt !== null &&
          DateTime.toEpochMillis(row.expiresAt) - DateTime.toEpochMillis(now) <=
            policy.refreshBeforeMs;
        const expired = (row: Storage.Credential, now: DateTime.Utc) =>
          row.expiresAt !== null &&
          DateTime.toEpochMillis(row.expiresAt) <= DateTime.toEpochMillis(now);
        const current = yield* storage.authorizations.credential(authorization.id);
        const now = yield* DateTime.now;
        if (!dueAt(current, now)) return "current" as const;
        if (refresher === undefined)
          return expired(current, now) ? ("reconnect" as const) : ("current" as const);
        return yield* storage
          .withLock(
            `refresh:${authorization.id}`,
            Effect.gen(function* () {
              const latest = yield* storage.authorizations.credential(authorization.id);
              if (!dueAt(latest, yield* DateTime.now)) return "current" as const;
              const secret = yield* custody.open(latest.ciphertext);
              const issued = yield* refresher({ secret, context: authorization.context });
              yield* storage.authorizations.rotate(authorization.id, yield* seal(issued));
              return "refreshed" as const;
            }),
          )
          .pipe(
            Effect.catchIf(
              (error) => error.reason._tag === "Busy" && !expired(current, now),
              () => Effect.succeed("current" as const),
            ),
            Effect.catchIf(
              (error) => error.reason._tag === "Unauthenticated",
              () => Effect.succeed("reconnect" as const),
            ),
          );
      });

    const sessionFor = (connection: Storage.Connection): Fx<Provider.Session> =>
      Effect.gen(function* () {
        const authorization = yield* storage.authorizations.get(connection.authorizationId);
        const reconnect = DomainKitError.fail(
          new DomainKitError.Reconnect({
            provider: authorization.provider,
            connectionId: connection.id,
          }),
        );
        if (authorization.revocation !== "active") return yield* reconnect;
        if ((yield* refresh(connection.id)) === "reconnect") return yield* reconnect;
        const definition = yield* providers.get(authorization.provider);
        return definition.session(yield* open(authorization));
      });

    const connectWith = (input: {
      readonly definition: Provider.Definition;
      readonly method: Storage.AuthMethod;
      readonly issued: Provider.IssuedCredential;
      readonly requiredCapabilities: ReadonlyArray<Storage.Capability>;
    }): Fx<{ readonly connection: Storage.Connection; readonly session: Provider.Session }> =>
      Effect.gen(function* () {
        const principal = yield* Principal;
        const session = input.definition.session(input.issued);
        const held = yield* session.capabilities();
        const missing = input.requiredCapabilities.filter(
          (capability) => !held.includes(capability),
        );
        if (missing.length > 0) {
          return yield* DomainKitError.fail(
            new DomainKitError.Forbidden({
              message: `${input.definition.name} credential lacks ${missing.join(", ")}`,
            }),
          );
        }
        const authorization = new Storage.Authorization({
          id: yield* fresh("auth"),
          ownerId: principal.ownerId,
          provider: input.definition.id,
          method: input.method,
          capabilities: held,
          context: input.issued.context,
          revocation: "active",
          createdBy: principal.actorId,
          createdAt: yield* DateTime.now,
        });
        yield* storage.authorizations.upsert({
          authorization,
          credential: yield* seal(input.issued),
        });
        const connection = yield* storage.connections.create(authorization.id);
        return { connection, session };
      });

    const attachWith = (input: {
      readonly connection: Storage.Connection;
      readonly session: Provider.Session;
      readonly domain: string;
      readonly target?: Provider.Target;
    }): Fx<Attached> =>
      Effect.gen(function* () {
        const domain = yield* DomainName.decode(input.domain);
        const existing = yield* storage.attachments.byDomain(domain);
        if (Option.isSome(existing)) {
          if (existing.value.connectionId === input.connection.id) return existing.value;
          return yield* invalid(`${domain} is already attached to another connection`, "domain");
        }
        const resolution: Provider.Resolution =
          input.target === undefined
            ? yield* input.session.resolveTarget(domain)
            : { _tag: "Resolved", target: input.target };
        switch (resolution._tag) {
          case "SelectionRequired":
            return { _tag: "SelectionRequired", candidates: resolution.candidates } as const;
          case "NotFound":
            return yield* DomainKitError.fail(
              new DomainKitError.NotFound({ entity: "zone", id: domain }),
            );
          case "Resolved":
            return yield* storage.attachments.create({
              connectionId: input.connection.id,
              domain,
              zone: resolution.target.zone,
              target: resolution.target,
            });
        }
      });

    const started = (connection: Storage.Connection, attached: Attached | null): Started =>
      attached === null
        ? { _tag: "Connected", connection, attachment: null }
        : attached instanceof Storage.Attachment
          ? { _tag: "Connected", connection, attachment: attached }
          : { _tag: "SelectionRequired", connection, candidates: attached.candidates };

    const inspect: Service["inspect"] = (input) =>
      Effect.gen(function* () {
        const domain = yield* DomainName.decode(input);
        const policy = yield* Policy;
        const attachment = Option.getOrNull(yield* storage.attachments.byDomain(domain));
        const connection =
          attachment === null ? null : yield* storage.connections.get(attachment.connectionId);
        const authorization =
          connection === null
            ? null
            : yield* storage.authorizations.get(connection.authorizationId);
        const latest =
          attachment === null
            ? Option.none()
            : yield* storage.attempts.latest(attachment.id, "provisioning");
        const reusable: Array<Snapshot["reusable"][number]> = [];
        for (const candidate of yield* storage.connections.list()) {
          if (candidate.id === connection?.id) continue;
          if (!(yield* policy.allowReuse({ connection: candidate, domain }))) continue;
          const candidateAuthorization = yield* storage.authorizations.get(
            candidate.authorizationId,
          );
          if (candidateAuthorization.revocation !== "active") continue;
          reusable.push({
            connection: candidate,
            provider: candidateAuthorization.provider,
            method: candidateAuthorization.method,
          });
        }
        return {
          domain,
          attachment,
          connection,
          authorization:
            authorization === null
              ? null
              : {
                  id: authorization.id,
                  provider: authorization.provider,
                  method: authorization.method,
                  capabilities: authorization.capabilities,
                  revocation: authorization.revocation,
                },
          lastReceiptId: Option.isSome(latest) ? (latest.value.receipt?.id ?? null) : null,
          reusable,
          providers: providers.list().map((definition) => ({
            id: definition.id,
            name: definition.name,
            methods: methodsOf(definition),
          })),
        };
      });

    const start: Service["start"] = (input) =>
      Effect.gen(function* () {
        yield* recover;
        const principal = yield* Principal;
        const policy = yield* Policy;
        const definition = yield* providers.get(input.provider);
        if (input.domain !== undefined) yield* DomainName.decode(input.domain);
        switch (input.method._tag) {
          case "Token": {
            const token = definition.auth.token;
            if (token === undefined) {
              return yield* invalid(`${definition.name} does not accept tokens`, "method");
            }
            const issued = yield* token.authenticate(input.method.token);
            const { connection, session } = yield* connectWith({
              definition,
              method: "token",
              issued,
              requiredCapabilities: token.requiredCapabilities,
            });
            const attached =
              input.domain === undefined
                ? null
                : yield* attachWith({ connection, session, domain: input.domain });
            return started(connection, attached);
          }
          case "OAuth":
          case "Integration": {
            const interactive =
              input.method._tag === "OAuth" ? definition.auth.oauth : definition.auth.integration;
            if (interactive === undefined) {
              return yield* invalid(
                `${definition.name} does not offer ${input.method._tag.toLowerCase()} connections`,
                "method",
              );
            }
            if (input.callbackUrl === undefined) {
              return yield* invalid("Interactive connections need a callbackUrl", "callbackUrl");
            }
            const continuationId = yield* fresh("cont");
            const pkce = input.method._tag === "OAuth" ? yield* OAuth.pkce() : null;
            const redirect =
              input.method._tag === "OAuth"
                ? yield* (interactive as Provider.OAuthAuth).start({
                    state: continuationId,
                    callbackUrl: input.callbackUrl,
                    codeChallenge: pkce?.codeChallenge ?? "",
                  })
                : yield* (interactive as Provider.IntegrationAuth).start({
                    state: continuationId,
                    callbackUrl: input.callbackUrl,
                  });
            yield* storage.continuations.put(
              new Storage.Continuation({
                id: continuationId,
                ownerId: principal.ownerId,
                actorId: principal.actorId,
                provider: definition.id,
                payload: Schema.encodeSync(Payload)({
                  method: input.method._tag === "OAuth" ? "oauth" : "integration",
                  codeVerifier: pkce?.codeVerifier ?? null,
                  callbackUrl: input.callbackUrl,
                  domain: input.domain ?? null,
                }),
                returnTo: input.method.returnTo ?? null,
                expiresAt: DateTime.addDuration(
                  yield* DateTime.now,
                  Duration.millis(policy.continuationTtlMs),
                ),
              }),
            );
            return {
              _tag: "Redirect",
              authorizationUrl: redirect.authorizationUrl,
              continuationId,
            };
          }
        }
      });

    const complete: Service["complete"] = (input) =>
      Effect.gen(function* () {
        // Validate the callback before spending the continuation, so a malformed or mismatched
        // callback leaves the pending flow intact. The provider code itself is single-use, so a
        // failed exchange or persistence after this point needs a fresh start.
        const callback = yield* Effect.try({
          try: () => new URL(input.callbackUrl),
          catch: () =>
            new DomainKitError.DomainKitError({
              reason: new DomainKitError.InvalidInput({
                message: "callbackUrl is not a URL",
                field: "callbackUrl",
              }),
            }),
        });
        const params = Object.fromEntries(callback.searchParams);
        const unauthenticated = (message: string) =>
          DomainKitError.fail(new DomainKitError.Unauthenticated({ message }));
        if (params.error !== undefined) {
          return yield* unauthenticated(`Provider returned ${params.error}`);
        }
        if (params.state !== input.continuationId) {
          return yield* unauthenticated("Callback state does not match the continuation");
        }
        const code = params.code;
        if (code === undefined) return yield* unauthenticated("Callback has no code");
        const continuation = yield* storage.continuations.consume(input.continuationId);
        const payload = yield* DomainKitError.decode(Payload, continuation.payload, "continuation");
        const definition = yield* providers.get(continuation.provider);
        const issued =
          payload.method === "oauth"
            ? yield* Effect.gen(function* () {
                const oauth = definition.auth.oauth;
                if (oauth === undefined || payload.codeVerifier === null) {
                  return yield* invalid(
                    `${definition.name} does not offer oauth connections`,
                    "method",
                  );
                }
                return yield* oauth.complete({
                  code,
                  callbackUrl: payload.callbackUrl,
                  codeVerifier: payload.codeVerifier,
                  params,
                });
              })
            : yield* Effect.gen(function* () {
                const integration = definition.auth.integration;
                if (integration === undefined) {
                  return yield* invalid(
                    `${definition.name} does not offer integration connections`,
                    "method",
                  );
                }
                return yield* integration.complete({
                  code,
                  callbackUrl: payload.callbackUrl,
                  params,
                });
              });
        const { connection, session } = yield* connectWith({
          definition,
          method: payload.method,
          issued,
          requiredCapabilities: [],
        });
        const attached =
          payload.domain === null
            ? null
            : yield* attachWith({ connection, session, domain: payload.domain });
        return started(connection, attached);
      });

    const attach: Service["attach"] = (input) =>
      Effect.gen(function* () {
        const connection = yield* storage.connections.get(input.connectionId);
        const session = yield* sessionFor(connection);
        return yield* attachWith({
          connection,
          session,
          domain: input.domain,
          ...(input.target === undefined ? {} : { target: input.target }),
        });
      });

    const disconnect: Service["disconnect"] = (connectionId) =>
      Effect.gen(function* () {
        yield* recover;
        const connection = yield* storage.connections.get(connectionId);
        const attachments = yield* storage.attachments.list(connectionId);
        yield* Effect.forEach(attachments, (attachment) =>
          storage.attachments.remove(attachment.id),
        );
        yield* storage.connections.remove(connectionId);
        const remaining = (yield* storage.connections.list()).some(
          (candidate) => candidate.authorizationId === connection.authorizationId,
        );
        if (remaining) return;
        const authorization = yield* storage.authorizations.get(connection.authorizationId);
        yield* storage.authorizations.revoke(authorization.id, revokeAt(authorization));
      });

    const session: Service["session"] = (attachmentId) =>
      Effect.gen(function* () {
        const attachment = yield* storage.attachments.get(attachmentId);
        const connection = yield* storage.connections.get(attachment.connectionId);
        const target = yield* DomainKitError.decode(Target, attachment.target, "target");
        return { session: yield* sessionFor(connection), target };
      });

    return {
      inspect,
      start,
      complete,
      attach,
      detach: (attachmentId) => storage.attachments.remove(attachmentId),
      disconnect,
      refresh,
      session,
    };
  });

export const layer: Layer.Layer<Connect, never, Storage.Storage | Custody | Providers> =
  Layer.effect(Connect)(make);

const methodsOf = (definition: Provider.Definition): ReadonlyArray<Provider.AuthMethod> => {
  const found: Array<Provider.AuthMethod> = [];
  if (definition.auth.token !== undefined) found.push("token");
  if (definition.auth.oauth !== undefined) found.push("oauth");
  if (definition.auth.integration !== undefined) found.push("integration");
  return found;
};

const accessor =
  <Args extends ReadonlyArray<unknown>, A>(
    pick: (service: Service) => (...args: Args) => Fx<A>,
  ): ((...args: Args) => Effect.Effect<A, DomainKitError.DomainKitError, Principal | Connect>) =>
  (...args) =>
    Effect.flatMap(Connect, (service) => pick(service)(...args));

export const inspect = accessor((service) => service.inspect);
export const start = accessor((service) => service.start);
export const complete = accessor((service) => service.complete);
export const attach = accessor((service) => service.attach);
export const detach = accessor((service) => service.detach);
export const disconnect = accessor((service) => service.disconnect);
export const refresh = accessor((service) => service.refresh);
export const session = accessor((service) => service.session);
