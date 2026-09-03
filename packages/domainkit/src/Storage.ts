/**
 * Everything DomainKit persists, behind one service the host installs once. Every method requires
 * `Principal` and is scoped by it. `@domainkit/capsuledb` ships the Postgres implementation;
 * `domainkit/testing` ships the memory one; both pass `Testing.conformance.storage`.
 *
 * Storage never sees plaintext credentials: `Connect` seals secrets through `Custody` before
 * writing a `Credential` row and opens them after reading one.
 *
 * Grouped by noun so the 25-odd methods stay navigable. Implementations must satisfy the
 * invariants documented per group; the conformance suite checks them.
 */
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";

import * as Approval from "./Approval.ts";
import * as DnsRecord from "./DnsRecord.ts";
import * as DomainKitError from "./DomainKitError.ts";
import { makeMemory } from "./internal/storage-memory.ts";
import * as Plan from "./Plan.ts";
import { Principal, type Shape as PrincipalShape } from "./Principal.ts";
import * as Receipt from "./Receipt.ts";

export type Fx<A> = Effect.Effect<A, DomainKitError.DomainKitError, Principal>;

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

export const Capability = Schema.Literals(["dns:read", "dns:write"]);
export type Capability = typeof Capability.Type;

export const AuthMethod = Schema.Literals(["token", "oauth", "integration"]);
export type AuthMethod = typeof AuthMethod.Type;

/** Sealed provider credential plus the metadata needed without unsealing it. */
export class Credential extends Schema.Class<Credential>("@domainkit/Storage/Credential")({
  ciphertext: Schema.String,
  expiresAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  rotatedAt: Schema.DateTimeUtcFromString,
}) {}

/** One provider authorization (an OAuth grant or a token) owned by a principal. */
export class Authorization extends Schema.Class<Authorization>("@domainkit/Storage/Authorization")({
  id: Schema.String,
  ownerId: Schema.String,
  provider: Schema.String,
  method: AuthMethod,
  capabilities: Schema.Array(Capability),
  /** Provider-specific account context (account id, team id, ...) decoded by the provider's `context` schema. */
  context: Schema.Unknown,
  revocation: Schema.Literals(["active", "pending", "revoked"]),
  createdBy: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
}) {}

/** A connection is the principal-facing handle over an authorization; one authorization, many domains. */
export class Connection extends Schema.Class<Connection>("@domainkit/Storage/Connection")({
  id: Schema.String,
  ownerId: Schema.String,
  authorizationId: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
}) {}

export class Attachment extends Schema.Class<Attachment>("@domainkit/Storage/Attachment")({
  id: Schema.String,
  ownerId: Schema.String,
  connectionId: Schema.String,
  domain: Schema.String,
  zone: Schema.String,
  /** Provider zone identity (zone id, account id) decoded by the provider's `context` schema. */
  target: Schema.Unknown,
  createdAt: Schema.DateTimeUtcFromString,
}) {}

/** Interactive-flow state between `Connect.start` and `Connect.complete`. */
export class Continuation extends Schema.Class<Continuation>("@domainkit/Storage/Continuation")({
  id: Schema.String,
  ownerId: Schema.String,
  actorId: Schema.String,
  provider: Schema.String,
  payload: Schema.Unknown,
  returnTo: Schema.NullOr(Schema.String),
  expiresAt: Schema.DateTimeUtcFromString,
}) {}

export const AttemptStatus = Schema.Literals([
  "planned",
  "approved",
  "applying",
  "complete",
  "partial",
  "failed",
  "expired",
  "rejected",
]);
export type AttemptStatus = typeof AttemptStatus.Type;

/** Who declined the plan, why, and when. Terminal: the domain needs a new plan. */
export const Rejection = Schema.Struct({
  actorId: Schema.String,
  reason: Schema.NullOr(Schema.String),
  at: Schema.DateTimeUtcFromString,
});
export type Rejection = typeof Rejection.Type;

/** One durable plan -> approval -> receipt lifecycle. */
export class Attempt extends Schema.Class<Attempt>("@domainkit/Storage/Attempt")({
  id: Plan.PlanId,
  ownerId: Schema.String,
  attachmentId: Schema.String,
  kind: Plan.Kind,
  status: AttemptStatus,
  plan: Plan.Plan,
  approval: Schema.NullOr(Approval.Approval),
  receipt: Schema.NullOr(Receipt.Receipt),
  rejection: Schema.NullOr(Rejection),
  /** Cleanup attempts point at the provisioning receipt they undo. */
  sourceReceiptId: Schema.NullOr(Receipt.ReceiptId),
  leaseExpiresAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  /** Why the last apply stopped before any write; cleared on the next claim. */
  failure: Schema.NullOr(Schema.String),
  updatedAt: Schema.DateTimeUtcFromString,
}) {}

export const RequirementStatus = Schema.Literals(["satisfied", "missing", "mismatch", "unknown"]);
export type RequirementStatus = typeof RequirementStatus.Type;

export const Overall = Schema.Literals(["ready", "pending", "failed"]);
export type Overall = typeof Overall.Type;

/**
 * Latest observed readiness for one domain, written by `Verify.observe`. Keyed by domain so
 * observe-only hosts (no attachment, public DNS alone) get the same row; `attachmentId` links the
 * attachment when one exists.
 */
export class Readiness extends Schema.Class<Readiness>("@domainkit/Storage/Readiness")({
  domain: Schema.String,
  attachmentId: Schema.NullOr(Schema.String),
  ownerId: Schema.String,
  overall: Overall,
  requirements: Schema.Array(
    Schema.Struct({
      operationId: Schema.NullOr(Plan.OperationId),
      record: DnsRecord.DnsRecord,
      status: RequirementStatus,
      /** Encoded `Verify.Evidence` values. */
      evidence: Schema.Array(Schema.Unknown),
    }),
  ),
  /** Encoded `Verify.HostEvidence` values, keyed by `source` on merge. */
  host: Schema.Array(Schema.Unknown),
  /** When the current pending streak began; drives the backoff ladder. */
  pendingSince: Schema.NullOr(Schema.DateTimeUtcFromString),
  checkedAt: Schema.DateTimeUtcFromString,
  nextCheckAt: Schema.NullOr(Schema.DateTimeUtcFromString),
}) {}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

export interface Service {
  readonly authorizations: {
    /**
     * Insert, or CAS-replace when `expectedId` is set: the row must exist under this owner with an
     * active revocation state, else `NotFound` / `Busy`.
     */
    readonly upsert: (input: {
      readonly authorization: Authorization;
      readonly credential: Credential;
      readonly expectedId?: string;
    }) => Fx<Authorization>;
    readonly get: (id: string) => Fx<Authorization>;
    readonly credential: (id: string) => Fx<Credential>;
    readonly rotate: (id: string, credential: Credential) => Fx<void>;
    readonly promoteCapabilities: (id: string, capabilities: ReadonlyArray<Capability>) => Fx<void>;
    /**
     * Two-phase: mark `pending`, run `revoke` outside any transaction, then delete. A failed
     * `revoke` leaves the row pending; `recoverRevocations` finishes it later.
     */
    readonly revoke: <E, R>(
      id: string,
      revoke: Effect.Effect<void, E, R>,
    ) => Effect.Effect<void, DomainKitError.DomainKitError | E, Principal | R>;
    readonly recoverRevocations: <E, R>(
      revoke: (authorization: Authorization) => Effect.Effect<void, E, R>,
    ) => Effect.Effect<number, DomainKitError.DomainKitError | E, Principal | R>;
  };
  readonly connections: {
    readonly create: (authorizationId: string) => Fx<Connection>;
    readonly get: (id: string) => Fx<Connection>;
    readonly list: (filter?: { readonly provider?: string }) => Fx<ReadonlyArray<Connection>>;
    /** Fails `InvalidInput` while attachments still reference the connection. */
    readonly remove: (id: string) => Fx<void>;
  };
  readonly attachments: {
    /** One attachment per (owner, domain); a duplicate fails `InvalidInput`. */
    readonly create: (input: {
      readonly connectionId: string;
      readonly domain: string;
      readonly zone: string;
      readonly target: unknown;
    }) => Fx<Attachment>;
    readonly get: (id: string) => Fx<Attachment>;
    readonly byDomain: (domain: string) => Fx<Option.Option<Attachment>>;
    readonly list: (connectionId: string) => Fx<ReadonlyArray<Attachment>>;
    readonly remove: (id: string) => Fx<void>;
  };
  readonly continuations: {
    readonly put: (continuation: Continuation) => Fx<void>;
    /** Read without spending; a late read fails `Expired`. */
    readonly get: (id: string) => Fx<Continuation>;
    /** Exactly-once: the second consume of the same id fails `NotFound`; a late one fails `Expired`. */
    readonly consume: (id: string) => Fx<Continuation>;
  };
  readonly attempts: {
    readonly create: (attempt: Attempt) => Fx<Attempt>;
    readonly get: (id: Plan.PlanId) => Fx<Attempt>;
    readonly byApproval: (id: Approval.ApprovalId) => Fx<Attempt>;
    readonly byReceipt: (id: Receipt.ReceiptId) => Fx<Attempt>;
    readonly latest: (attachmentId: string, kind: Plan.Kind) => Fx<Option.Option<Attempt>>;
    /** `planned` -> `approved`; approving again with the same approval id is a no-op, anything else fails `Stale`. */
    readonly approve: (id: Plan.PlanId, approval: Approval.Approval) => Fx<Attempt>;
    /**
     * `planned` -> `rejected` (terminal). Rejecting again returns the row unchanged; any other
     * status fails `Stale`, `expired` fails `Expired`, and a digest mismatch fails `Stale`.
     */
    readonly reject: (
      id: Plan.PlanId,
      input: {
        readonly digest: Plan.Digest;
        readonly actorId: string;
        readonly reason: string | null;
      },
    ) => Fx<Attempt>;
    /**
     * Atomic transition to `applying` with a lease from `approved`, `failed`, or an expired
     * `applying`; fails `Busy` while a lease is live and `Stale` from any other status.
     */
    readonly claim: (id: Plan.PlanId, lease: DateTime.Utc) => Fx<Attempt>;
    readonly complete: (id: Plan.PlanId, receipt: Receipt.Receipt) => Fx<Attempt>;
    readonly fail: (id: Plan.PlanId, message: string) => Fx<Attempt>;
  };
  readonly readiness: {
    /** One row per (owner, domain); `attachmentId`, when set, must exist for the owner. */
    readonly put: (readiness: Readiness) => Fx<void>;
    readonly get: (domain: string) => Fx<Option.Option<Readiness>>;
  };
  /** Single-flight guard keyed by string (credential refresh, apply). Fails `Busy` rather than waiting. */
  readonly withLock: <A, E, R>(
    key: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | DomainKitError.DomainKitError, R | Principal>;
}

export class Storage extends Context.Service<Storage, Service>()("@domainkit/Storage") {}

export interface MemoryOptions {
  /** Fault injection: runs before every mutation commits; failing here leaves state untouched. */
  readonly beforeCommit?: (operation: string) => Effect.Effect<void, DomainKitError.DomainKitError>;
}

/** In-memory implementation for tests and local development. Not for production. */
export const layerMemory: Layer.Layer<Storage> = Layer.sync(Storage)(() => makeMemory());

/** `layerMemory` with fault injection for storage-failure tests. */
export const layerMemoryWith = (options: MemoryOptions): Layer.Layer<Storage> =>
  Layer.sync(Storage)(() => makeMemory(options));

export { makeMemory };

// ---------------------------------------------------------------------------------------------
// Async adapter
// ---------------------------------------------------------------------------------------------

/**
 * A Promise-shaped implementation for hosts that persist without Effect. Every method takes the
 * principal explicitly. Rejections become `StorageFailed`; reject with a `DomainKitError` to keep
 * a typed reason. Two-phase revocation and locking are split into plain steps so no callback has
 * to run an Effect.
 */
export interface AsyncService {
  readonly authorizations: {
    readonly upsert: (
      principal: PrincipalShape,
      input: {
        readonly authorization: Authorization;
        readonly credential: Credential;
        readonly expectedId?: string;
      },
    ) => Promise<Authorization>;
    readonly get: (principal: PrincipalShape, id: string) => Promise<Authorization>;
    readonly credential: (principal: PrincipalShape, id: string) => Promise<Credential>;
    readonly rotate: (
      principal: PrincipalShape,
      id: string,
      credential: Credential,
    ) => Promise<void>;
    readonly promoteCapabilities: (
      principal: PrincipalShape,
      id: string,
      capabilities: ReadonlyArray<Capability>,
    ) => Promise<void>;
    /** Mark `pending` durably; must be idempotent. */
    readonly prepareRevocation: (principal: PrincipalShape, id: string) => Promise<Authorization>;
    /** Delete the authorization after the provider confirmed revocation. */
    readonly completeRevocation: (principal: PrincipalShape, id: string) => Promise<void>;
    readonly pendingRevocations: (
      principal: PrincipalShape,
    ) => Promise<ReadonlyArray<Authorization>>;
  };
  readonly connections: {
    readonly create: (principal: PrincipalShape, authorizationId: string) => Promise<Connection>;
    readonly get: (principal: PrincipalShape, id: string) => Promise<Connection>;
    readonly list: (
      principal: PrincipalShape,
      filter?: { readonly provider?: string },
    ) => Promise<ReadonlyArray<Connection>>;
    readonly remove: (principal: PrincipalShape, id: string) => Promise<void>;
  };
  readonly attachments: {
    readonly create: (
      principal: PrincipalShape,
      input: {
        readonly connectionId: string;
        readonly domain: string;
        readonly zone: string;
        readonly target: unknown;
      },
    ) => Promise<Attachment>;
    readonly get: (principal: PrincipalShape, id: string) => Promise<Attachment>;
    readonly byDomain: (principal: PrincipalShape, domain: string) => Promise<Attachment | null>;
    readonly list: (
      principal: PrincipalShape,
      connectionId: string,
    ) => Promise<ReadonlyArray<Attachment>>;
    readonly remove: (principal: PrincipalShape, id: string) => Promise<void>;
  };
  readonly continuations: {
    readonly put: (principal: PrincipalShape, continuation: Continuation) => Promise<void>;
    readonly get: (principal: PrincipalShape, id: string) => Promise<Continuation>;
    readonly consume: (principal: PrincipalShape, id: string) => Promise<Continuation>;
  };
  readonly attempts: {
    readonly create: (principal: PrincipalShape, attempt: Attempt) => Promise<Attempt>;
    readonly get: (principal: PrincipalShape, id: Plan.PlanId) => Promise<Attempt>;
    readonly byApproval: (principal: PrincipalShape, id: Approval.ApprovalId) => Promise<Attempt>;
    readonly byReceipt: (principal: PrincipalShape, id: Receipt.ReceiptId) => Promise<Attempt>;
    readonly latest: (
      principal: PrincipalShape,
      attachmentId: string,
      kind: Plan.Kind,
    ) => Promise<Attempt | null>;
    readonly approve: (
      principal: PrincipalShape,
      id: Plan.PlanId,
      approval: Approval.Approval,
    ) => Promise<Attempt>;
    readonly reject: (
      principal: PrincipalShape,
      id: Plan.PlanId,
      input: {
        readonly digest: Plan.Digest;
        readonly actorId: string;
        readonly reason: string | null;
      },
    ) => Promise<Attempt>;
    readonly claim: (
      principal: PrincipalShape,
      id: Plan.PlanId,
      lease: DateTime.Utc,
    ) => Promise<Attempt>;
    readonly complete: (
      principal: PrincipalShape,
      id: Plan.PlanId,
      receipt: Receipt.Receipt,
    ) => Promise<Attempt>;
    readonly fail: (
      principal: PrincipalShape,
      id: Plan.PlanId,
      message: string,
    ) => Promise<Attempt>;
  };
  readonly readiness: {
    readonly put: (principal: PrincipalShape, readiness: Readiness) => Promise<void>;
    readonly get: (principal: PrincipalShape, domain: string) => Promise<Readiness | null>;
  };
  /** Return `false` when another holder has the key. */
  readonly acquireLock: (principal: PrincipalShape, key: string) => Promise<boolean>;
  readonly releaseLock: (principal: PrincipalShape, key: string) => Promise<void>;
}

const storageFailed = (operation: string) => (cause: unknown) =>
  DomainKitError.isDomainKitError(cause)
    ? cause
    : new DomainKitError.DomainKitError({
        reason: new DomainKitError.StorageFailed({
          operation,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      });

/** Wraps a Promise-shaped implementation. Rejections become `StorageFailed`. */
export const fromAsync = (service: AsyncService): Service => {
  const call = <A>(operation: string, run: (principal: PrincipalShape) => Promise<A>): Fx<A> =>
    Effect.flatMap(Principal, (principal) =>
      Effect.tryPromise({ try: () => run(principal), catch: storageFailed(operation) }),
    );
  const option = <A>(operation: string, run: (principal: PrincipalShape) => Promise<A | null>) =>
    call(operation, run).pipe(Effect.map(Option.fromNullishOr));
  return {
    authorizations: {
      upsert: (input) =>
        call("authorizations.upsert", (p) => service.authorizations.upsert(p, input)),
      get: (id) => call("authorizations.get", (p) => service.authorizations.get(p, id)),
      credential: (id) =>
        call("authorizations.credential", (p) => service.authorizations.credential(p, id)),
      rotate: (id, credential) =>
        call("authorizations.rotate", (p) => service.authorizations.rotate(p, id, credential)),
      promoteCapabilities: (id, capabilities) =>
        call("authorizations.promoteCapabilities", (p) =>
          service.authorizations.promoteCapabilities(p, id, capabilities),
        ),
      revoke: (id, revoke) =>
        call("authorizations.prepareRevocation", (p) =>
          service.authorizations.prepareRevocation(p, id),
        ).pipe(
          Effect.flatMap(() => revoke),
          Effect.flatMap(() =>
            call("authorizations.completeRevocation", (p) =>
              service.authorizations.completeRevocation(p, id),
            ),
          ),
        ),
      recoverRevocations: (revoke) =>
        call("authorizations.pendingRevocations", (p) =>
          service.authorizations.pendingRevocations(p),
        ).pipe(
          Effect.flatMap((pending) =>
            Effect.forEach(pending, (authorization) =>
              revoke(authorization).pipe(
                Effect.flatMap(() =>
                  call("authorizations.completeRevocation", (p) =>
                    service.authorizations.completeRevocation(p, authorization.id),
                  ),
                ),
              ),
            ),
          ),
          Effect.map((completed) => completed.length),
        ),
    },
    connections: {
      create: (authorizationId) =>
        call("connections.create", (p) => service.connections.create(p, authorizationId)),
      get: (id) => call("connections.get", (p) => service.connections.get(p, id)),
      list: (filter) => call("connections.list", (p) => service.connections.list(p, filter)),
      remove: (id) => call("connections.remove", (p) => service.connections.remove(p, id)),
    },
    attachments: {
      create: (input) => call("attachments.create", (p) => service.attachments.create(p, input)),
      get: (id) => call("attachments.get", (p) => service.attachments.get(p, id)),
      byDomain: (domain) =>
        option("attachments.byDomain", (p) => service.attachments.byDomain(p, domain)),
      list: (connectionId) =>
        call("attachments.list", (p) => service.attachments.list(p, connectionId)),
      remove: (id) => call("attachments.remove", (p) => service.attachments.remove(p, id)),
    },
    continuations: {
      put: (continuation) =>
        call("continuations.put", (p) => service.continuations.put(p, continuation)),
      get: (id) => call("continuations.get", (p) => service.continuations.get(p, id)),
      consume: (id) => call("continuations.consume", (p) => service.continuations.consume(p, id)),
    },
    attempts: {
      create: (attempt) => call("attempts.create", (p) => service.attempts.create(p, attempt)),
      get: (id) => call("attempts.get", (p) => service.attempts.get(p, id)),
      byApproval: (id) => call("attempts.byApproval", (p) => service.attempts.byApproval(p, id)),
      byReceipt: (id) => call("attempts.byReceipt", (p) => service.attempts.byReceipt(p, id)),
      latest: (attachmentId, kind) =>
        option("attempts.latest", (p) => service.attempts.latest(p, attachmentId, kind)),
      approve: (id, approval) =>
        call("attempts.approve", (p) => service.attempts.approve(p, id, approval)),
      reject: (id, input) => call("attempts.reject", (p) => service.attempts.reject(p, id, input)),
      claim: (id, lease) => call("attempts.claim", (p) => service.attempts.claim(p, id, lease)),
      complete: (id, receipt) =>
        call("attempts.complete", (p) => service.attempts.complete(p, id, receipt)),
      fail: (id, message) => call("attempts.fail", (p) => service.attempts.fail(p, id, message)),
    },
    readiness: {
      put: (readiness) => call("readiness.put", (p) => service.readiness.put(p, readiness)),
      get: (domain) => option("readiness.get", (p) => service.readiness.get(p, domain)),
    },
    withLock: (key, effect) =>
      Effect.acquireRelease(
        call("acquireLock", (p) => service.acquireLock(p, key)).pipe(
          Effect.flatMap((acquired) =>
            acquired ? Effect.void : DomainKitError.fail(new DomainKitError.Busy({ key })),
          ),
        ),
        () => call("releaseLock", (p) => service.releaseLock(p, key)).pipe(Effect.ignore),
      ).pipe(
        Effect.flatMap(() => effect),
        Effect.scoped,
      ),
  };
};

export const layerFromAsync = (service: AsyncService): Layer.Layer<Storage> =>
  Layer.succeed(Storage)(fromAsync(service));
