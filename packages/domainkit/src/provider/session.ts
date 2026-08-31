import { Data, Effect } from "effect";

import type * as Connection from "../auth/connection.ts";
import type * as ProviderAuthorization from "../auth/authorization.ts";
import type * as Secret from "../auth/secret.ts";
import type * as DomainName from "../domain/domain-name.ts";
import * as DnsProvider from "./provider.ts";

/** A credential-scoped provider session that discovers safe targets before DNS access. */
export interface Interface {
  /** The provider represented by this credential. */
  readonly providerId: string;
  /** Lists provider account and authoritative-zone targets visible to this credential. */
  readonly listTargets: (
    input?: ListTargetsInput,
  ) => Effect.Effect<ReadonlyArray<Connection.ProviderTarget>, DnsProvider.Error>;
  /** Resolves a domain without guessing when more than one account owns a matching zone. */
  readonly resolveTarget: (
    domain: DomainName.DomainName,
  ) => Effect.Effect<Resolution, DnsProvider.Error>;
  /** Creates the focused DNS-record capability bound to one exact discovered target. */
  readonly forTarget: (
    target: Connection.ProviderTarget,
  ) => Effect.Effect<DnsProvider.Interface, DnsProvider.Error>;
}

export interface ListTargetsInput {
  /** Restrict results to the authoritative zone candidates for this domain. */
  readonly domain?: DomainName.DomainName;
  /** Provider-specific account filter, when supported by the adapter. */
  readonly accountId?: string;
}

export type Resolution = Data.TaggedEnum<{
  NotFound: { readonly domain: DomainName.DomainName };
  Resolved: { readonly target: Connection.ProviderTarget };
  SelectionRequired: { readonly candidates: ReadonlyArray<Connection.ProviderTarget> };
}>;
export const Resolution = Data.taggedEnum<Resolution>();

/** The credential material a provider adapter needs to restore a session. */
export interface Credential {
  readonly accessToken: Secret.Value;
  readonly expiresAt: Date | null;
  readonly refreshToken: Secret.Value | null;
  readonly tokenType: string;
}

/** The non-secret authorization projection required when restoring a provider session. */
export type Authorization = Pick<
  ProviderAuthorization.ProviderAuthorization,
  | "capabilityEvidence"
  | "method"
  | "providerContext"
  | "providerId"
  | "requiredCapabilities"
  | "revocation"
>;

export interface RestoreInput {
  readonly authorization: Authorization;
  readonly credential: Credential;
}

/** Minimal Promise-shaped provider-session contract for hosts that do not use Effect directly. */
export interface AsyncInterface {
  readonly providerId: string;
  readonly listTargets: (
    input?: ListTargetsInput,
  ) => Promise<ReadonlyArray<Connection.ProviderTarget>>;
  readonly resolveTarget: (domain: DomainName.DomainName) => Promise<Resolution>;
  readonly forTarget: (target: Connection.ProviderTarget) => Promise<DnsProvider.AsyncInterface>;
}

/** Adapts a Promise-shaped session to the Effect-native session boundary. */
export const fromAsync = (session: AsyncInterface): Interface => ({
  providerId: session.providerId,
  listTargets: (input) =>
    Effect.tryPromise({
      try: () => session.listTargets(input),
      catch: (cause) => sessionFailure(session.providerId, "listTargets", cause),
    }),
  resolveTarget: (domain) =>
    Effect.tryPromise({
      try: () => session.resolveTarget(domain),
      catch: (cause) => sessionFailure(session.providerId, "resolveTarget", cause),
    }),
  forTarget: (target) =>
    Effect.tryPromise({
      try: () => session.forTarget(target),
      catch: (cause) => sessionFailure(session.providerId, "forTarget", cause),
    }).pipe(Effect.map(DnsProvider.fromAsync)),
});

/** Adapts an Effect-native session to the Promise facade. */
export const toAsync = (session: Interface): AsyncInterface => ({
  providerId: session.providerId,
  listTargets: (input) => Effect.runPromise(session.listTargets(input)),
  resolveTarget: (domain) => Effect.runPromise(session.resolveTarget(domain)),
  forTarget: (target) => Effect.runPromise(session.forTarget(target)).then(DnsProvider.toAsync),
});

function sessionFailure(providerId: string, operation: string, cause: unknown): DnsProvider.Error {
  return cause instanceof DnsProvider.Error
    ? cause
    : new DnsProvider.Error({
        message: cause instanceof globalThis.Error ? cause.message : String(cause),
        operation: `ProviderSession.${operation}`,
        providerId,
        reason: "transport",
      });
}
