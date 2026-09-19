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
import * as Errors from "./internal/error.ts";
import * as Reason from "./Reason.ts";
import { makeMemory } from "./internal/storage-memory.ts";
import * as Plan from "./Plan.ts";
import * as Principal from "./Principal.ts";
import * as Receipt from "./Receipt.ts";

export type Fx<A> = Effect.Effect<A, Errors.DomainKitError, Principal.Service>;

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
  /**
   * What the provider called the account when the credential was issued, so a UI names the
   * connection without a provider call. `null` when the provider names no single account.
   */
  label: Schema.NullOr(Schema.String),
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
  /** The target's label as the provider gave it at attach time, so a UI names the account without a provider call. */
  label: Schema.String,
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

/**
 * Who a continuation belongs to, without the continuation itself. `payload` has no place here: it
 * carries the PKCE `codeVerifier`, which only the owner-scoped read may reach.
 */
export class ContinuationHeader extends Schema.Class<ContinuationHeader>(
  "@domainkit/Storage/ContinuationHeader",
)({
  ownerId: Schema.String,
  actorId: Schema.String,
  provider: Schema.String,
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
  plan: Plan.Model,
  approval: Schema.NullOr(Approval.Model),
  receipt: Schema.NullOr(Receipt.Model),
  rejection: Schema.NullOr(Rejection),
  /** Cleanup attempts point at the provisioning receipt they undo. */
  sourceReceiptId: Schema.NullOr(Receipt.ReceiptId),
  leaseExpiresAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  /** Why the last apply stopped before any write; cleared on the next claim. */
  failure: Schema.NullOr(Schema.String),
  updatedAt: Schema.DateTimeUtcFromString,
}) {}

export const BatchId = Schema.String.pipe(Schema.brand("@domainkit/BatchId"));
export type BatchId = typeof BatchId.Type;

/**
 * Where a batch stands, recomputed from its items' attempts after every transition.
 *
 * `planning` while any item is still without a plan, `planned` once every item carries one,
 * `approved` once the principal bound the batch digest, then the apply states. `partial` and
 * `failed` are resumable; `complete` and `rejected` are terminal and leave the unfinished index.
 */
export const BatchStatus = Schema.Literals([
  "planning",
  "planned",
  "approved",
  "applying",
  "complete",
  "partial",
  "failed",
  "rejected",
]);
export type BatchStatus = typeof BatchStatus.Type;

/** Who bound the batch to its digest, and when. The digest itself is `Batch.digest`. */
export const BatchApproval = Schema.Struct({
  actorId: Schema.String,
  at: Schema.DateTimeUtcFromString,
});
export type BatchApproval = typeof BatchApproval.Type;

/**
 * Many domains planned together, approved once, and applied with bounded concurrency.
 *
 * The batch owns the aggregate's own state only: its digest, who approved or declined it, and the
 * status recomputed from its items. Every plan, approval, receipt, lease, and failure stays on the
 * attempt an item points at, so nothing is stored twice.
 */
export class Batch extends Schema.Class<Batch>("@domainkit/Storage/Batch")({
  id: BatchId,
  ownerId: Schema.String,
  kind: Plan.Kind,
  status: BatchStatus,
  /** SHA-256 over the items' `attachmentId:planDigest` pairs, bound at approval. */
  digest: Schema.NullOr(Plan.Digest),
  approval: Schema.NullOr(BatchApproval),
  rejection: Schema.NullOr(Rejection),
  /** Unique per owner: a replayed create returns the batch this key already made. */
  idempotencyKey: Schema.String,
  createdBy: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  /** When the batch reached `complete` or `rejected`; null while it still owes a move. */
  completedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
}) {}

/**
 * One domain's place in a batch: a pointer to the attachment and to the attempt carrying its plan.
 *
 * `attemptId` is null until the item is planned, and `planFailure` carries why the last planning
 * pass stopped, cleared the moment a plan lands.
 */
export class BatchItem extends Schema.Class<BatchItem>("@domainkit/Storage/BatchItem")({
  batchId: BatchId,
  attachmentId: Schema.String,
  /** The item's place in the batch, as `create` received it. */
  position: Schema.Number,
  attemptId: Schema.NullOr(Plan.PlanId),
  planFailure: Schema.NullOr(Schema.String),
}) {}

/**
 * The status a batch holds, given whether it was approved or declined and where each item's
 * attempt stands. `null` names an item that has no plan yet.
 *
 * Both `Storage` implementations recompute the stored status through this after every transition,
 * so the owner-scoped unfinished index never disagrees with the attempts it summarizes.
 */
export const batchStatusOf = (input: {
  readonly approved: boolean;
  readonly rejected: boolean;
  readonly items: ReadonlyArray<AttemptStatus | null>;
}): BatchStatus => {
  if (input.rejected) return "rejected";
  const items = input.items;
  if (items.length === 0 || items.some((status) => status === null)) return "planning";
  const statuses = items as ReadonlyArray<AttemptStatus>;
  const every = (status: AttemptStatus) => statuses.every((item) => item === status);
  if (every("planned")) return "planned";
  // An approval the batch never took means an item moved on its own; it is not approvable, and
  // planning is the state a host resumes from.
  if (!input.approved) return "planning";
  if (every("approved")) return "approved";
  const settled = statuses.every(
    (status) => status !== "planned" && status !== "approved" && status !== "applying",
  );
  if (!settled) return "applying";
  if (every("complete")) return "complete";
  return statuses.some((status) => status === "partial") ? "partial" : "failed";
};

/** A batch with its items, in `position` order. Every batch read returns one. */
export interface BatchAggregate {
  readonly batch: Batch;
  readonly items: ReadonlyArray<BatchItem>;
}

/** One item's attempt approval, as `batches.approve` writes it beside the batch's own. */
export interface BatchItemApproval {
  readonly attachmentId: string;
  readonly approval: Approval.Model;
}

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
      record: DnsRecord.Model,
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

export interface Interface {
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
    ) => Effect.Effect<void, Errors.DomainKitError | E, Principal.Service | R>;
    readonly recoverRevocations: <E, R>(
      revoke: (authorization: Authorization) => Effect.Effect<void, E, R>,
    ) => Effect.Effect<number, Errors.DomainKitError | E, Principal.Service | R>;
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
      readonly label: string;
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
    /**
     * The flow's owner, actor, provider, and expiry, without a principal and without spending the
     * row. The one read in this interface that is not tenant-scoped, because `domainkit/server`
     * has to learn whose flow a provider callback finishes before it can resolve the principal to
     * scope by; the callback carries a continuation id and a session cookie and nothing else.
     *
     * A missing row fails `NotFound` and a stale one fails `Expired`, exactly as `get` does, so an
     * expired id never reaches a host. `payload` is out of reach here by construction.
     */
    readonly header: (id: string) => Effect.Effect<ContinuationHeader, Errors.DomainKitError>;
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
    readonly approve: (id: Plan.PlanId, approval: Approval.Model) => Fx<Attempt>;
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
    readonly complete: (id: Plan.PlanId, receipt: Receipt.Model) => Fx<Attempt>;
    readonly fail: (id: Plan.PlanId, message: string) => Fx<Attempt>;
  };
  /**
   * The batch aggregate: many attempts planned together and approved once.
   *
   * Every transition runs in one transaction over the locked batch row and leaves `status`
   * recomputed from the items' attempts, so the owner-scoped unfinished index never disagrees
   * with the attempts it summarizes.
   */
  readonly batches: {
    /**
     * Insert the batch and one item per attachment, or return the batch this owner already
     * created under `idempotencyKey`. A replay ignores `attachmentIds` and returns what is
     * stored, which is what makes a retried create safe.
     */
    readonly create: (input: {
      readonly kind: Plan.Kind;
      readonly idempotencyKey: string;
      /** One item per attachment, in order; empty or duplicated fails `InvalidInput`. */
      readonly attachmentIds: ReadonlyArray<string>;
    }) => Fx<BatchAggregate>;
    readonly get: (id: BatchId) => Fx<BatchAggregate>;
    /** Every batch that has not reached `complete` or `rejected`, most recently touched first. */
    readonly listUnfinished: () => Fx<ReadonlyArray<BatchAggregate>>;
    /**
     * Point an item at the attempt that now carries its plan and clear its plan failure.
     *
     * Fails `Stale` unless the batch is still `planning` or `planned`. That check is the fence a
     * planner still in flight hits when the principal declines the batch underneath it, so plan
     * state never lands on a rejected aggregate.
     */
    readonly recordItemPlan: (
      id: BatchId,
      attachmentId: string,
      attemptId: Plan.PlanId,
    ) => Fx<BatchAggregate>;
    /** Record why an item could not be planned; the batch stays `planning`. Same fence. */
    readonly recordItemPlanFailure: (
      id: BatchId,
      attachmentId: string,
      message: string,
    ) => Fx<BatchAggregate>;
    /**
     * Bind the batch to `digest` and approve every item's attempt in the same transaction, so a
     * batch is never approved without the per-attempt approvals `attempts.apply` needs.
     *
     * Fails `Stale` unless the batch is `planned` and every item still points at the attempt its
     * approval names. Approving an approved batch under the same digest returns it unchanged; a
     * different digest fails `Stale`.
     */
    readonly approve: (
      id: BatchId,
      input: {
        readonly digest: Plan.Digest;
        readonly actorId: string;
        /** One per item, covering every item in the batch. */
        readonly approvals: ReadonlyArray<BatchItemApproval>;
      },
    ) => Fx<BatchAggregate>;
    /**
     * Decline the batch and every planned attempt under it, in one transaction. Terminal.
     *
     * Rejecting again returns the batch unchanged; a batch that reached `approved` or later
     * fails `Stale`.
     */
    readonly reject: (
      id: BatchId,
      input: { readonly actorId: string; readonly reason: string | null },
    ) => Fx<BatchAggregate>;
    /** Recompute the stored status from the items' attempts, after applying moved them. */
    readonly refresh: (id: BatchId) => Fx<BatchAggregate>;
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
  ) => Effect.Effect<A, E | Errors.DomainKitError, R | Principal.Service>;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/Storage") {}

export interface MemoryOptions {
  /** Fault injection: runs before every mutation commits; failing here leaves state untouched. */
  readonly beforeCommit?: (operation: string) => Effect.Effect<void, Errors.DomainKitError>;
}

/** In-memory implementation for tests and local development. Not for production. */
export const layerMemory: Layer.Layer<Service> = Layer.sync(Service)(() => makeMemory());

/** `layerMemory` with fault injection for storage-failure tests. */
export const layerMemoryWith = (options: MemoryOptions): Layer.Layer<Service> =>
  Layer.sync(Service)(() => makeMemory(options));

export { makeMemory };

// ---------------------------------------------------------------------------------------------
// Async adapter
// ---------------------------------------------------------------------------------------------

/**
 * A Promise-shaped implementation for hosts that persist without Effect. Every method takes the
 * principal explicitly. Rejections become `StorageFailed`; reject with a `DomainKit.Error` to keep
 * a typed reason. Two-phase revocation and locking are split into plain steps so no callback has
 * to run an Effect.
 */
export interface AsyncInterface {
  readonly authorizations: {
    readonly upsert: (
      principal: Principal.Interface,
      input: {
        readonly authorization: Authorization;
        readonly credential: Credential;
        readonly expectedId?: string;
      },
    ) => Promise<Authorization>;
    readonly get: (principal: Principal.Interface, id: string) => Promise<Authorization>;
    readonly credential: (principal: Principal.Interface, id: string) => Promise<Credential>;
    readonly rotate: (
      principal: Principal.Interface,
      id: string,
      credential: Credential,
    ) => Promise<void>;
    readonly promoteCapabilities: (
      principal: Principal.Interface,
      id: string,
      capabilities: ReadonlyArray<Capability>,
    ) => Promise<void>;
    /** Mark `pending` durably; must be idempotent. */
    readonly prepareRevocation: (
      principal: Principal.Interface,
      id: string,
    ) => Promise<Authorization>;
    /** Delete the authorization after the provider confirmed revocation. */
    readonly completeRevocation: (principal: Principal.Interface, id: string) => Promise<void>;
    readonly pendingRevocations: (
      principal: Principal.Interface,
    ) => Promise<ReadonlyArray<Authorization>>;
  };
  readonly connections: {
    readonly create: (
      principal: Principal.Interface,
      authorizationId: string,
    ) => Promise<Connection>;
    readonly get: (principal: Principal.Interface, id: string) => Promise<Connection>;
    readonly list: (
      principal: Principal.Interface,
      filter?: { readonly provider?: string },
    ) => Promise<ReadonlyArray<Connection>>;
    readonly remove: (principal: Principal.Interface, id: string) => Promise<void>;
  };
  readonly attachments: {
    readonly create: (
      principal: Principal.Interface,
      input: {
        readonly connectionId: string;
        readonly domain: string;
        readonly zone: string;
        readonly label: string;
        readonly target: unknown;
      },
    ) => Promise<Attachment>;
    readonly get: (principal: Principal.Interface, id: string) => Promise<Attachment>;
    readonly byDomain: (
      principal: Principal.Interface,
      domain: string,
    ) => Promise<Attachment | null>;
    readonly list: (
      principal: Principal.Interface,
      connectionId: string,
    ) => Promise<ReadonlyArray<Attachment>>;
    readonly remove: (principal: Principal.Interface, id: string) => Promise<void>;
  };
  readonly continuations: {
    readonly put: (principal: Principal.Interface, continuation: Continuation) => Promise<void>;
    readonly get: (principal: Principal.Interface, id: string) => Promise<Continuation>;
    /** Takes no principal: see `Interface.continuations.header`. Never returns `payload`. */
    readonly header: (id: string) => Promise<ContinuationHeader>;
    readonly consume: (principal: Principal.Interface, id: string) => Promise<Continuation>;
  };
  readonly attempts: {
    readonly create: (principal: Principal.Interface, attempt: Attempt) => Promise<Attempt>;
    readonly get: (principal: Principal.Interface, id: Plan.PlanId) => Promise<Attempt>;
    readonly byApproval: (
      principal: Principal.Interface,
      id: Approval.ApprovalId,
    ) => Promise<Attempt>;
    readonly byReceipt: (principal: Principal.Interface, id: Receipt.ReceiptId) => Promise<Attempt>;
    readonly latest: (
      principal: Principal.Interface,
      attachmentId: string,
      kind: Plan.Kind,
    ) => Promise<Attempt | null>;
    readonly approve: (
      principal: Principal.Interface,
      id: Plan.PlanId,
      approval: Approval.Model,
    ) => Promise<Attempt>;
    readonly reject: (
      principal: Principal.Interface,
      id: Plan.PlanId,
      input: {
        readonly digest: Plan.Digest;
        readonly actorId: string;
        readonly reason: string | null;
      },
    ) => Promise<Attempt>;
    readonly claim: (
      principal: Principal.Interface,
      id: Plan.PlanId,
      lease: DateTime.Utc,
    ) => Promise<Attempt>;
    readonly complete: (
      principal: Principal.Interface,
      id: Plan.PlanId,
      receipt: Receipt.Model,
    ) => Promise<Attempt>;
    readonly fail: (
      principal: Principal.Interface,
      id: Plan.PlanId,
      message: string,
    ) => Promise<Attempt>;
  };
  readonly batches: {
    readonly create: (
      principal: Principal.Interface,
      input: {
        readonly kind: Plan.Kind;
        readonly idempotencyKey: string;
        readonly attachmentIds: ReadonlyArray<string>;
      },
    ) => Promise<BatchAggregate>;
    readonly get: (principal: Principal.Interface, id: BatchId) => Promise<BatchAggregate>;
    readonly listUnfinished: (
      principal: Principal.Interface,
    ) => Promise<ReadonlyArray<BatchAggregate>>;
    readonly recordItemPlan: (
      principal: Principal.Interface,
      id: BatchId,
      attachmentId: string,
      attemptId: Plan.PlanId,
    ) => Promise<BatchAggregate>;
    readonly recordItemPlanFailure: (
      principal: Principal.Interface,
      id: BatchId,
      attachmentId: string,
      message: string,
    ) => Promise<BatchAggregate>;
    readonly approve: (
      principal: Principal.Interface,
      id: BatchId,
      input: {
        readonly digest: Plan.Digest;
        readonly actorId: string;
        readonly approvals: ReadonlyArray<BatchItemApproval>;
      },
    ) => Promise<BatchAggregate>;
    readonly reject: (
      principal: Principal.Interface,
      id: BatchId,
      input: { readonly actorId: string; readonly reason: string | null },
    ) => Promise<BatchAggregate>;
    readonly refresh: (principal: Principal.Interface, id: BatchId) => Promise<BatchAggregate>;
  };
  readonly readiness: {
    readonly put: (principal: Principal.Interface, readiness: Readiness) => Promise<void>;
    readonly get: (principal: Principal.Interface, domain: string) => Promise<Readiness | null>;
  };
  /** Return `false` when another holder has the key. */
  readonly acquireLock: (principal: Principal.Interface, key: string) => Promise<boolean>;
  readonly releaseLock: (principal: Principal.Interface, key: string) => Promise<void>;
}

const storageFailed = (operation: string) => (cause: unknown) =>
  Errors.isDomainKitError(cause)
    ? cause
    : new Errors.DomainKitError({
        reason: new Reason.StorageFailed({
          operation,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      });

/** Wraps a Promise-shaped implementation. Rejections become `StorageFailed`. */
export const fromAsync = (service: AsyncInterface): Interface => {
  const call = <A>(operation: string, run: (principal: Principal.Interface) => Promise<A>): Fx<A> =>
    Effect.flatMap(Principal.Service, (principal) =>
      Effect.tryPromise({ try: () => run(principal), catch: storageFailed(operation) }),
    );
  const option = <A>(
    operation: string,
    run: (principal: Principal.Interface) => Promise<A | null>,
  ) => call(operation, run).pipe(Effect.map(Option.fromNullishOr));
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
      header: (id) =>
        Effect.tryPromise({
          try: () => service.continuations.header(id),
          catch: storageFailed("continuations.header"),
        }),
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
    batches: {
      create: (input) => call("batches.create", (p) => service.batches.create(p, input)),
      get: (id) => call("batches.get", (p) => service.batches.get(p, id)),
      listUnfinished: () =>
        call("batches.listUnfinished", (p) => service.batches.listUnfinished(p)),
      recordItemPlan: (id, attachmentId, attemptId) =>
        call("batches.recordItemPlan", (p) =>
          service.batches.recordItemPlan(p, id, attachmentId, attemptId),
        ),
      recordItemPlanFailure: (id, attachmentId, message) =>
        call("batches.recordItemPlanFailure", (p) =>
          service.batches.recordItemPlanFailure(p, id, attachmentId, message),
        ),
      approve: (id, input) => call("batches.approve", (p) => service.batches.approve(p, id, input)),
      reject: (id, input) => call("batches.reject", (p) => service.batches.reject(p, id, input)),
      refresh: (id) => call("batches.refresh", (p) => service.batches.refresh(p, id)),
    },
    readiness: {
      put: (readiness) => call("readiness.put", (p) => service.readiness.put(p, readiness)),
      get: (domain) => option("readiness.get", (p) => service.readiness.get(p, domain)),
    },
    withLock: (key, effect) =>
      Effect.acquireRelease(
        call("acquireLock", (p) => service.acquireLock(p, key)).pipe(
          Effect.flatMap((acquired) =>
            acquired ? Effect.void : Errors.fail(new Reason.Busy({ key })),
          ),
        ),
        () => call("releaseLock", (p) => service.releaseLock(p, key)).pipe(Effect.ignore),
      ).pipe(
        Effect.flatMap(() => effect),
        Effect.scoped,
      ),
  };
};

export const layerFromAsync = (service: AsyncInterface): Layer.Layer<Service> =>
  Layer.succeed(Service)(fromAsync(service));
