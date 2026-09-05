/**
 * Connect a provider, attach domains to it, and keep the credential alive. Interactive methods
 * (OAuth, integration) return a redirect and complete on callback; token methods connect in one
 * call. Reuse of an existing connection for a new domain is `attach`.
 */
import { Context, Data, DateTime, Duration, Effect, Layer, Option, Redacted, Schema } from "effect";

import * as Custody from "./Custody.ts";
import * as Errors from "./internal/error.ts";
import * as Reason from "./Reason.ts";
import * as DomainName from "./DomainName.ts";
import { fresh } from "./internal/ids.ts";
import * as OAuth from "./internal/oauth.ts";
import * as Principal from "./Principal.ts";
import * as Provider from "./Provider.ts";
import * as Providers from "./Providers.ts";
import * as Resolver from "./Resolver.ts";
import * as Storage from "./Storage.ts";

type Fx<A> = Effect.Effect<A, Errors.DomainKitError, Principal.Service>;

export type Method = Data.TaggedEnum<{
  /** Values keyed by the provider's declared `auth.token.fields`. */
  Token: { readonly values: Provider.TokenValues };
  OAuth: { readonly returnTo?: string };
  Integration: { readonly returnTo?: string };
}>;
const MethodEnum = Data.taggedEnum<Method>();
/** `token` accepts a lone string (`{ token }`) or a record; every value is wrapped in `Redacted`. */
export const Method = {
  ...MethodEnum,
  token: (
    values: string | Readonly<Record<string, Redacted.Redacted<string> | string | undefined>>,
  ): Method =>
    MethodEnum.Token({
      values:
        typeof values === "string"
          ? { token: Redacted.make(values) }
          : Object.fromEntries(
              Object.entries(values).map(([name, value]) => [
                name,
                typeof value === "string" ? Redacted.make(value) : value,
              ]),
            ),
    }),
  oauth: (options: { readonly returnTo?: string } = {}): Method => MethodEnum.OAuth(options),
  integration: (options: { readonly returnTo?: string } = {}): Method =>
    MethodEnum.Integration(options),
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
  /** How many domains this domain's connection serves, including this one; `0` without one. */
  readonly connectionDomains: number;
  /** Other connections of this owner that could serve this domain. */
  readonly reusable: ReadonlyArray<{
    readonly connection: Storage.Connection;
    readonly provider: string;
    readonly method: Storage.AuthMethod;
  }>;
  readonly providers: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly methods: ReadonlyArray<Provider.MethodDescriptor>;
  }>;
}

export type Started = Data.TaggedEnum<{
  Connected: {
    readonly connection: Storage.Connection;
    readonly attachment: Storage.Attachment | null;
  };
  Redirect: { readonly authorizationUrl: string; readonly continuationId: string };
  SelectionRequired: {
    readonly connection: Storage.Connection;
    readonly candidates: ReadonlyArray<Provider.Target>;
  };
}>;
export const Started = Data.taggedEnum<Started>();

/** `attach` either attached the domain or needs the caller to pick a zone. */
export type Selection = Data.TaggedEnum<{
  SelectionRequired: { readonly candidates: ReadonlyArray<Provider.Target> };
}>;
export const Selection = Data.taggedEnum<Selection>();

export type Attached = Storage.Attachment | Selection;

export type Refreshed = "current" | "refreshed" | "reconnect";

/** Which of the principal's connections serves a domain, from nameserver evidence and zone lists. */
export type Discovery = Data.TaggedEnum<{
  Resolved: { readonly connectionId: string; readonly target: Provider.Target };
  SelectionRequired: {
    readonly candidates: ReadonlyArray<{
      readonly connectionId: string;
      readonly target: Provider.Target;
    }>;
  };
  /**
   * No connection reaches the domain. `host` names the one registered provider whose declared
   * nameserver suffixes cover every authoritative nameserver; `null` when none or several do.
   */
  NotFound: {
    readonly nameservers: ReadonlyArray<string>;
    readonly host: { readonly provider: string } | null;
  };
}>;
export const Discovery = Data.taggedEnum<Discovery>();

/** One zone a connection reaches, with the connection that reaches it. */
export interface Zone {
  readonly connectionId: string;
  readonly provider: string;
  readonly target: Provider.Target;
}

/**
 * A connection's standing in a zone listing. `reconnect` is a credential the provider turned down:
 * the connection is still the owner's, and the other connections' zones came back regardless.
 */
export interface ZoneConnection {
  readonly connectionId: string;
  readonly provider: string;
  readonly status: "connected" | "reconnect";
}

/** Every zone the principal's connections reach, and how each connection is standing. */
export interface Zones {
  /** Ordered by zone, then by connection, so two listings of the same state read the same. */
  readonly zones: ReadonlyArray<Zone>;
  readonly connections: ReadonlyArray<ZoneConnection>;
  /** Every provider a customer could connect from here, so an offer needs no second call. */
  readonly providers: Snapshot["providers"];
}

export interface Interface {
  readonly inspect: (domain: string) => Fx<Snapshot>;
  /**
   * Every zone the principal's connections can serve, from `Provider.Session.listTargets`. A
   * connection whose credential the provider turned down is marked `reconnect` in `connections`
   * and contributes no zones; the rest still list.
   */
  readonly zones: (options?: { readonly provider?: string }) => Fx<Zones>;
  /**
   * Resolve the domain's authoritative nameservers, then match them against the zones each of
   * the principal's connections can reach: the closest zone wins, a decisive nameserver match
   * breaks ties, and anything else needs a selection.
   */
  readonly discover: (domain: string) => Fx<Discovery>;
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

export class Service extends Context.Service<Service, Interface>()("@domainkit/Connect") {}

/** Which owner-scoped reuse is allowed. Default: any connection of the same owner may serve any of its domains. */
export interface PolicyShape {
  readonly allowReuse: (input: {
    readonly connection: Storage.Connection;
    readonly domain: string;
  }) => Effect.Effect<boolean, never, Principal.Service>;
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
  Errors.fail(new Reason.InvalidInput({ message, ...(field === undefined ? {} : { field }) }));

/** Nameserver hostnames compare case-insensitively and without a trailing dot. */
const normalize = (name: string) => name.toLowerCase().replace(/\.$/, "");

export const make: Effect.Effect<
  Interface,
  never,
  Storage.Service | Custody.Service | Providers.Service | Resolver.Service
> = Effect.gen(function* () {
  const storage = yield* Storage.Service;
  const custody = yield* Custody.Service;
  const providers = yield* Providers.Service;
  const resolver = yield* Resolver.Service;

  const seal = (issued: Provider.IssuedCredential) =>
    Effect.gen(function* () {
      const ciphertext = yield* custody.seal(issued.secret);
      return new Storage.Credential({
        ciphertext,
        expiresAt: issued.expiresAt,
        rotatedAt: yield* DateTime.now,
      });
    });

  /** Plaintext credential with the context decoded from its stored envelope. */
  const open = (authorization: Storage.Authorization): Fx<Provider.Credential> =>
    Effect.gen(function* () {
      const definition = yield* providers.get(authorization.provider);
      const row = yield* storage.authorizations.credential(authorization.id);
      const secret = yield* custody.open(row.ciphertext);
      const context = yield* Provider.decodeContext(definition, authorization.context);
      return { secret, context };
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

  const refresh: Interface["refresh"] = (connectionId) =>
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
            // Disconnect's two-phase revocation does not take this lock: re-read the row here
            // so a revocation that started meanwhile skips the refresh instead of racing it.
            const live = yield* storage.authorizations.get(authorization.id).pipe(
              Effect.map(Option.some),
              Effect.catchIf(
                (error) => error.reason._tag === "NotFound",
                () => Effect.succeed(Option.none<Storage.Authorization>()),
              ),
            );
            if (Option.isNone(live) || live.value.revocation !== "active") {
              return "reconnect" as const;
            }
            const latest = yield* storage.authorizations.credential(authorization.id);
            if (!dueAt(latest, yield* DateTime.now)) return "current" as const;
            const secret = yield* custody.open(latest.ciphertext);
            const context = yield* Provider.decodeContext(definition, live.value.context);
            const issued = yield* refresher({ secret, context });
            // A revocation that completed while the provider was issuing leaves no row to
            // rotate; revoke the fresh credential so it does not stay live without a home.
            yield* storage.authorizations
              .rotate(authorization.id, yield* seal(issued))
              .pipe(
                Effect.tapError((error) =>
                  error.reason._tag === "NotFound"
                    ? (revokerFor(definition, authorization.method)?.(issued) ?? Effect.void).pipe(
                        Effect.ignore,
                      )
                    : Effect.void,
                ),
              );
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
      const reconnect = Errors.fail(
        new Reason.Reconnect({
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
      const principal = yield* Principal.Service;
      const session = input.definition.session(input.issued);
      const held = yield* session.capabilities();
      const missing = input.requiredCapabilities.filter((capability) => !held.includes(capability));
      if (missing.length > 0) {
        return yield* Errors.fail(
          new Reason.Forbidden({
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
        context: yield* Provider.encodeContext(input.definition, input.issued.context),
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
    readonly definition: Provider.Definition;
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
          : Provider.Resolution.Resolved({ target: input.target });
      switch (resolution._tag) {
        case "SelectionRequired":
          return Selection.SelectionRequired({ candidates: resolution.candidates });
        case "NotFound":
          return yield* Errors.fail(new Reason.NotFound({ entity: "zone", id: domain }));
        case "Resolved":
          return yield* storage.attachments.create({
            connectionId: input.connection.id,
            domain,
            zone: resolution.target.zone,
            label: resolution.target.label,
            target: {
              ...resolution.target,
              context: yield* Provider.encodeContext(input.definition, resolution.target.context),
            },
          });
      }
    });

  const started = (connection: Storage.Connection, attached: Attached | null): Started =>
    attached === null
      ? Started.Connected({ connection, attachment: null })
      : attached instanceof Storage.Attachment
        ? Started.Connected({ connection, attachment: attached })
        : Started.SelectionRequired({ connection, candidates: attached.candidates });

  /** Authoritative nameservers for the closest zone that answers an NS query. */
  const authoritative = (candidates: ReadonlyArray<DomainName.Model>) =>
    Effect.gen(function* () {
      for (const zone of candidates) {
        const outcomes = yield* resolver.resolve(zone, "NS");
        const names = outcomes.flatMap((outcome) =>
          outcome._tag === "Answered"
            ? outcome.answer.records.flatMap((record) =>
                record._tag === "NS" ? [record.nameserver] : [],
              )
            : [],
        );
        if (names.length > 0) return [...new Set(names)].sort();
      }
      return [] as ReadonlyArray<string>;
    });

  const discover: Interface["discover"] = (input) =>
    Effect.gen(function* () {
      const domain = yield* DomainName.decode(input);
      const candidates = DomainName.candidates(domain);
      const nameservers = yield* authoritative(candidates);
      const reachable: Array<{
        readonly connectionId: string;
        readonly target: Provider.Target;
      }> = [];
      for (const connection of yield* storage.connections.list()) {
        const targets = yield* sessionFor(connection).pipe(
          Effect.flatMap((session) => session.listTargets()),
          Effect.catch(() => Effect.succeed([] as ReadonlyArray<Provider.Target>)),
        );
        for (const target of targets) {
          if (candidates.includes(target.zone as DomainName.Model)) {
            reachable.push({ connectionId: connection.id, target });
          }
        }
      }
      for (const zone of candidates) {
        const matches = reachable
          .filter(({ target }) => target.zone === zone)
          .sort((left, right) => left.connectionId.localeCompare(right.connectionId));
        if (matches.length === 0) continue;
        const [only] = matches;
        if (matches.length === 1 && only !== undefined) return Discovery.Resolved(only);
        const decisive = matches.filter(({ target }) => {
          const configured = new Set((target.nameservers ?? []).map(normalize));
          return nameservers.length > 0 && nameservers.every((name) => configured.has(name));
        });
        const [winner] = decisive;
        if (decisive.length === 1 && winner !== undefined) return Discovery.Resolved(winner);
        return Discovery.SelectionRequired({ candidates: matches });
      }
      return Discovery.NotFound({ nameservers, host: hostOf(nameservers) });
    });

  /** The one registered provider whose declared suffixes cover every nameserver, else `null`. */
  const hostOf = (nameservers: ReadonlyArray<string>): { readonly provider: string } | null => {
    if (nameservers.length === 0) return null;
    const names = nameservers.map(normalize);
    const hosts = providers.list().filter((definition) => {
      const suffixes = (definition.nameservers ?? []).map(normalize);
      return (
        suffixes.length > 0 &&
        names.every((name) =>
          suffixes.some((suffix) => name === suffix || name.endsWith(`.${suffix}`)),
        )
      );
    });
    const [host] = hosts;
    return hosts.length === 1 && host !== undefined ? { provider: host.id } : null;
  };

  const zones: Interface["zones"] = (options = {}) =>
    Effect.gen(function* () {
      const reachable: Array<Zone> = [];
      const connections: Array<ZoneConnection> = [];
      const filter = options.provider === undefined ? undefined : { provider: options.provider };
      for (const connection of yield* storage.connections.list(filter)) {
        const authorization = yield* storage.authorizations.get(connection.authorizationId);
        // A credential the provider turned down is one connection's problem, not the listing's:
        // it is reported as needing a reconnect and every other connection still answers. Any
        // other failure is the listing's own, so it is raised rather than dressed up as an
        // authorization the customer has to grant again.
        const targets = yield* sessionFor(connection).pipe(
          Effect.flatMap((session) => session.listTargets()),
          Effect.map(Option.some),
          Effect.catchIf(
            (error) =>
              error.reason._tag === "Reconnect" ||
              error.reason._tag === "Unauthenticated" ||
              error.reason._tag === "Forbidden",
            () => Effect.succeed(Option.none<ReadonlyArray<Provider.Target>>()),
          ),
        );
        connections.push({
          connectionId: connection.id,
          provider: authorization.provider,
          status: Option.isNone(targets) ? "reconnect" : "connected",
        });
        if (Option.isNone(targets)) continue;
        for (const target of targets.value) {
          reachable.push({
            connectionId: connection.id,
            provider: authorization.provider,
            target,
          });
        }
      }
      return {
        zones: reachable.sort(
          (left, right) =>
            left.target.zone.localeCompare(right.target.zone) ||
            left.connectionId.localeCompare(right.connectionId),
        ),
        connections,
        providers: providers.list().map((definition) => ({
          id: definition.id,
          name: definition.name,
          methods: Provider.describeMethods(definition),
        })),
      };
    });

  const inspect: Interface["inspect"] = (input) =>
    Effect.gen(function* () {
      const domain = yield* DomainName.decode(input);
      const policy = yield* Policy;
      const attachment = Option.getOrNull(yield* storage.attachments.byDomain(domain));
      const connection =
        attachment === null ? null : yield* storage.connections.get(attachment.connectionId);
      const authorization =
        connection === null ? null : yield* storage.authorizations.get(connection.authorizationId);
      const latest =
        attachment === null
          ? Option.none()
          : yield* storage.attempts.latest(attachment.id, "provisioning");
      // Letting a connection go takes every domain on it, so the UI has to be able to say how many.
      const attached = connection === null ? [] : yield* storage.attachments.list(connection.id);
      const reusable: Array<Snapshot["reusable"][number]> = [];
      for (const candidate of yield* storage.connections.list()) {
        if (candidate.id === connection?.id) continue;
        if (!(yield* policy.allowReuse({ connection: candidate, domain }))) continue;
        const candidateAuthorization = yield* storage.authorizations.get(candidate.authorizationId);
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
        connectionDomains: attached.length,
        reusable,
        providers: providers.list().map((definition) => ({
          id: definition.id,
          name: definition.name,
          methods: Provider.describeMethods(definition),
        })),
      };
    });

  const start: Interface["start"] = (input) =>
    Effect.gen(function* () {
      yield* recover;
      const principal = yield* Principal.Service;
      const policy = yield* Policy;
      const definition = yield* providers.get(input.provider);
      if (input.domain !== undefined) yield* DomainName.decode(input.domain);
      switch (input.method._tag) {
        case "Token": {
          const token = definition.auth.token;
          if (token === undefined) {
            return yield* invalid(`${definition.name} does not accept tokens`, "method");
          }
          const issued = yield* token.authenticate(input.method.values);
          const { connection, session } = yield* connectWith({
            definition,
            method: "token",
            issued,
            requiredCapabilities: token.requiredCapabilities,
          });
          const attached =
            input.domain === undefined
              ? null
              : yield* attachWith({ definition, connection, session, domain: input.domain });
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
          return Started.Redirect({
            authorizationUrl: redirect.authorizationUrl,
            continuationId,
          });
        }
      }
    });

  const complete: Interface["complete"] = (input) =>
    Effect.gen(function* () {
      // The continuation is spent only after the credential and connection are persisted, so a
      // failure before that (bad callback, provider outage, storage outage) leaves the flow
      // retryable. Concurrent callbacks for the same continuation serialize on a lock; the
      // loser sees Busy or NotFound. A provider code is single-use, so a retry after the
      // provider already redeemed it fails Unauthenticated and the customer starts over.
      const callback = yield* Effect.try({
        try: () => new URL(input.callbackUrl),
        catch: () =>
          new Errors.DomainKitError({
            reason: new Reason.InvalidInput({
              message: "callbackUrl is not a URL",
              field: "callbackUrl",
            }),
          }),
      });
      const params = Object.fromEntries(callback.searchParams);
      const unauthenticated = (message: string) =>
        Errors.fail(new Reason.Unauthenticated({ message }));
      if (params.error !== undefined) {
        return yield* unauthenticated(`Provider returned ${params.error}`);
      }
      if (params.state !== input.continuationId) {
        return yield* unauthenticated("Callback state does not match the continuation");
      }
      const code = params.code;
      if (code === undefined) return yield* unauthenticated("Callback has no code");
      return yield* storage.withLock(
        `continuation:${input.continuationId}`,
        Effect.gen(function* () {
          const continuation = yield* storage.continuations.get(input.continuationId);
          const payload = yield* Errors.decode(Payload, continuation.payload, "continuation");
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
              : yield* attachWith({ definition, connection, session, domain: payload.domain });
          // The connection is durable at this point. Whatever happens to the continuation
          // now (expired, already spent, or a storage failure while spending it) no longer
          // changes the outcome: the row expires on its own and a replayed callback fails at
          // the provider, so the persisted result is returned.
          yield* storage.continuations.consume(input.continuationId).pipe(Effect.ignore);
          return started(connection, attached);
        }),
      );
    });

  const attach: Interface["attach"] = (input) =>
    Effect.gen(function* () {
      const connection = yield* storage.connections.get(input.connectionId);
      const authorization = yield* storage.authorizations.get(connection.authorizationId);
      const definition = yield* providers.get(authorization.provider);
      const session = yield* sessionFor(connection);
      return yield* attachWith({
        definition,
        connection,
        session,
        domain: input.domain,
        ...(input.target === undefined ? {} : { target: input.target }),
      });
    });

  const disconnect: Interface["disconnect"] = (connectionId) =>
    Effect.gen(function* () {
      yield* recover;
      const connection = yield* storage.connections.get(connectionId);
      const attachments = yield* storage.attachments.list(connectionId);
      yield* Effect.forEach(attachments, (attachment) => storage.attachments.remove(attachment.id));
      yield* storage.connections.remove(connectionId);
      const remaining = (yield* storage.connections.list()).some(
        (candidate) => candidate.authorizationId === connection.authorizationId,
      );
      if (remaining) return;
      const authorization = yield* storage.authorizations.get(connection.authorizationId);
      yield* storage.authorizations.revoke(authorization.id, revokeAt(authorization));
    });

  const session: Interface["session"] = (attachmentId) =>
    Effect.gen(function* () {
      const attachment = yield* storage.attachments.get(attachmentId);
      const connection = yield* storage.connections.get(attachment.connectionId);
      const authorization = yield* storage.authorizations.get(connection.authorizationId);
      const definition = yield* providers.get(authorization.provider);
      const stored = yield* Errors.decode(Target, attachment.target, "target");
      const target: Provider.Target = {
        ...stored,
        context: yield* Provider.decodeContext(definition, stored.context),
      };
      const built = yield* sessionFor(connection);
      // The zone must still be reachable by this credential: it may have moved account, been
      // deleted, or become a kind the provider cannot host records in.
      const reachable = yield* built.listTargets();
      if (!reachable.some((candidate) => candidate.zone === target.zone)) {
        return yield* Errors.fail(new Reason.NotFound({ entity: "zone", id: target.zone }));
      }
      return { session: built, target };
    });

  return {
    inspect,
    zones,
    discover,
    start,
    complete,
    attach,
    detach: (attachmentId) => storage.attachments.remove(attachmentId),
    disconnect,
    refresh,
    session,
  };
});

export const layer: Layer.Layer<
  Service,
  never,
  Storage.Service | Custody.Service | Providers.Service | Resolver.Service
> = Layer.effect(Service)(make);

const accessor =
  <Args extends ReadonlyArray<unknown>, A>(
    pick: (service: Interface) => (...args: Args) => Fx<A>,
  ): ((...args: Args) => Effect.Effect<A, Errors.DomainKitError, Principal.Service | Service>) =>
  (...args) =>
    Effect.flatMap(Service, (service) => pick(service)(...args));

export const inspect = accessor((service) => service.inspect);
export const zones = accessor((service) => service.zones);
export const discover = accessor((service) => service.discover);
export const start = accessor((service) => service.start);
export const complete = accessor((service) => service.complete);
export const attach = accessor((service) => service.attach);
export const detach = accessor((service) => service.detach);
export const disconnect = accessor((service) => service.disconnect);
export const refresh = accessor((service) => service.refresh);
export const session = accessor((service) => service.session);
