/**
 * Observe provider and public DNS for an attachment, persist per-requirement readiness, and say
 * when to look again. The host keeps its own state machine (and any provider-side verification
 * such as SES) and feeds that in as `HostEvidence`.
 */
import { Context, DateTime, Duration, Effect, Layer, Option, Schema } from "effect";

import * as Connect from "./Connect.ts";
import * as DnsRecord from "./DnsRecord.ts";
import * as Errors from "./internal/error.ts";
import * as Reason from "./Reason.ts";
import * as DomainName from "./DomainName.ts";
import type * as Plan from "./Plan.ts";
import * as Principal from "./Principal.ts";
import * as Resolver from "./Resolver.ts";
import * as Storage from "./Storage.ts";

/**
 * Every piece of evidence carries `values`, what the observer returned for the requirement's name
 * and type (empty when nothing was found, the lookup timed out, or the resolver failed), and
 * `detail`, `null` when the requirement is satisfied and otherwise the mismatch summary or the
 * resolver's error text, so a host can render "found X, expected Y".
 */
// Rows written before these fields existed decode with the empty values.
const Values = Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([])));
const Detail = Schema.NullOr(Schema.String).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed(null)),
);

export class ProviderEvidence extends Schema.TaggedClass<ProviderEvidence>(
  "@domainkit/Evidence/Provider",
)("Provider", {
  provider: Schema.String,
  status: Storage.RequirementStatus,
  values: Values,
  detail: Detail,
  observedAt: Schema.DateTimeUtcFromString,
}) {}
export class PublicDnsEvidence extends Schema.TaggedClass<PublicDnsEvidence>(
  "@domainkit/Evidence/PublicDns",
)("PublicDns", {
  resolver: Schema.String,
  status: Storage.RequirementStatus,
  values: Values,
  detail: Detail,
  observedAt: Schema.DateTimeUtcFromString,
}) {}
/** Anything the host knows that DomainKit cannot observe: SES identity status, a CDN cert, ... */
export class HostEvidence extends Schema.TaggedClass<HostEvidence>("@domainkit/Evidence/Host")(
  "Host",
  {
    source: Schema.String,
    status: Schema.Literals(["ok", "pending", "failed"]),
    label: Schema.String,
    detail: Detail,
    observedAt: Schema.DateTimeUtcFromString,
  },
) {}
export const Evidence = Schema.Union([ProviderEvidence, PublicDnsEvidence, HostEvidence]);
export type Evidence = typeof Evidence.Type;

export interface Requirement {
  /** `requirementKey(record)`: what a host pairs its own row against, by content. */
  readonly key: string;
  readonly operationId: Plan.OperationId | null;
  readonly record: DnsRecord.Model;
  readonly status: Storage.RequirementStatus;
  readonly evidence: ReadonlyArray<Evidence>;
}

export interface Readiness {
  readonly domain: string;
  /** `null` for observe-only domains that have no attachment. */
  readonly attachmentId: string | null;
  readonly overall: Storage.Overall;
  readonly requirements: ReadonlyArray<Requirement>;
  readonly host: ReadonlyArray<HostEvidence>;
  readonly checkedAt: DateTime.Utc;
  readonly nextCheckAt: DateTime.Utc | null;
}

type Fx<A> = Effect.Effect<A, Errors.DomainKitError, Principal.Service>;

export interface Interface {
  /**
   * What to observe, in order of precedence: `requirements` when supplied (an attached domain
   * without a provisioning receipt, or a domain with no attachment whose records the customer
   * applies by hand), else the latest provisioning receipt of the domain's attachment (records it
   * applied or found in place). Neither is `InvalidInput`. Provider evidence is added when the
   * attachment's session can be built; public DNS is always observed, and readiness is stored
   * per domain either way.
   */
  readonly observe: (input: {
    readonly domain: string;
    readonly requirements?: ReadonlyArray<DnsRecord.Model>;
  }) => Fx<Readiness>;
  /** Merge host evidence into stored readiness without re-observing DNS. */
  readonly attachEvidence: (input: {
    readonly domain: string;
    readonly evidence: ReadonlyArray<HostEvidence>;
  }) => Fx<Readiness>;
  readonly latest: (domain: string) => Fx<Readiness | null>;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/Verify") {}

/**
 * A requirement's identity: the record's type, name, and data, and nothing else. It is what a host
 * pairs its own rows against readiness by, instead of trusting the order of the array.
 * `@domainkit/react`'s `Records.identity` is this function.
 */
export const requirementKey = (record: DnsRecord.Model): string =>
  [record._tag, record.name, DnsRecord.data(record)].join(":");

/** Counts across a readiness's requirements. `observed` is false when there is no readiness yet. */
export interface Summary {
  readonly observed: boolean;
  readonly total: number;
  readonly satisfied: number;
  readonly missing: number;
  readonly mismatch: number;
  readonly unknown: number;
}

/**
 * How a readiness stands, as counts. Pure and total: a host renders "3 of 4 found" from the stored
 * fact without deciding what an absent readiness means, because `observed` says so. The parameter
 * is the least a value has to carry to be summarised, so core `Readiness` and the wire shape both
 * pass without naming a type between them.
 */
export const summary = (
  readiness: {
    readonly requirements: ReadonlyArray<{ readonly status: Storage.RequirementStatus }>;
  } | null,
): Summary => {
  const statuses = readiness?.requirements.map(({ status }) => status) ?? [];
  const count = (status: Storage.RequirementStatus): number =>
    statuses.filter((candidate) => candidate === status).length;
  return {
    observed: readiness !== null,
    total: statuses.length,
    satisfied: count("satisfied"),
    missing: count("missing"),
    mismatch: count("mismatch"),
    unknown: count("unknown"),
  };
};

export interface PolicyShape {
  /** Delay before the next check, given time since the first pending observation. Default ladder: 15s, 1m, 5m, 30m. */
  readonly backoff: (pendingForMs: number) => number;
  /** Which resolvers must agree for `satisfied`: default `any`. */
  readonly quorum: "any" | "all" | { readonly minimum: number };
}
export const defaults: PolicyShape = {
  backoff: (pendingForMs) =>
    pendingForMs < 60_000
      ? 15_000
      : pendingForMs < 10 * 60_000
        ? 60_000
        : pendingForMs < 60 * 60_000
          ? 5 * 60_000
          : 30 * 60_000,
  quorum: "any",
};
export class Policy extends Context.Reference<PolicyShape>("@domainkit/Verify/Policy", {
  defaultValue: () => defaults,
}) {}

/** Why readiness was written: a DNS observation, or host evidence merged into the stored row. */
export type Cause = "observe" | "evidence";

export interface ReadinessChanged {
  /** The tenant the row was written under, from the `Principal` the write ran as. */
  readonly ownerId: string;
  readonly domain: string;
  readonly readiness: Readiness;
  readonly cause: Cause;
}

export interface ObserverShape {
  /**
   * Called once per stored readiness, after the write. A host that projects readiness onto its own
   * rows, wakes a durable job at `nextCheckAt`, or notifies a customer hangs it here instead of
   * mirroring the fact at every call site.
   *
   * Readiness is stored per owner and domain, and an observer provided over `DomainKit.layer` is
   * scoped to the layer rather than to one request, so a host that serves more than one tenant
   * keys its projection by `ownerId` and `domain`: the same domain name can be attached in two
   * tenants at once.
   *
   * Events for one domain are not ordered against each other: two observations that overlap both
   * store, last write wins in `Storage`, and their callbacks can finish in either order. A
   * projection compares `readiness.checkedAt`, which is the moment the row was written, and keeps
   * the later one; `latest` remains the authority.
   */
  readonly readinessChanged: (event: ReadinessChanged) => Effect.Effect<void, unknown>;
}

/**
 * The host seam for "DomainKit wrote readiness". The default does nothing; provide one with
 * `Effect.provideService(Verify.Observer, ...)` or `Layer.succeed(Verify.Observer, ...)` over
 * `DomainKit.layer`, the same way `Policy` is overridden.
 *
 * It runs after `storage.readiness.put` returns, outside any transaction, because `Storage`
 * exposes none. A failure or defect in the observer is logged and swallowed: the observation is
 * already durable, and losing it because a projection failed would make the stored fact depend on
 * the host's side effects. A host that needs the projection to be reliable enqueues durable work
 * here rather than doing the work inline.
 */
export class Observer extends Context.Reference<ObserverShape>("@domainkit/Verify/Observer", {
  defaultValue: (): ObserverShape => ({ readinessChanged: () => Effect.void }),
}) {}

// ---------------------------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------------------------

const StoredEvidence = Schema.Array(Evidence);

interface ProviderSide {
  readonly provider: string;
  readonly records: ReadonlyArray<DnsRecord.Observed>;
}
const StoredHost = Schema.Array(HostEvidence);

/** A requirement is satisfied by an exact match; an exclusive one is contradicted by any same-set record. */
export const statusAgainst = (
  record: DnsRecord.Model,
  observed: ReadonlyArray<DnsRecord.Observed>,
): Storage.RequirementStatus => {
  if (observed.some((candidate) => DnsRecord.equals(candidate, record))) return "satisfied";
  if (
    record.policy === "exclusive" &&
    observed.some((candidate) => DnsRecord.sameSet(candidate, record))
  ) {
    return "mismatch";
  }
  return "missing";
};

interface Observation {
  readonly status: Storage.RequirementStatus;
  readonly values: ReadonlyArray<string>;
  readonly detail: string | null;
}

const render = (observed: DnsRecord.Observed): string =>
  observed._tag === "Opaque" ? JSON.stringify(observed.raw) : DnsRecord.data(observed);

/** Status plus what the observer holds for the requirement's name and type. */
const observation = (
  record: DnsRecord.Model,
  observed: ReadonlyArray<DnsRecord.Observed>,
): Observation => {
  const status = statusAgainst(record, observed);
  const values = observed.filter((candidate) => DnsRecord.sameSet(candidate, record)).map(render);
  const detail =
    status === "satisfied"
      ? null
      : values.length === 0
        ? `no ${record._tag} record at ${record.name}`
        : `expected ${DnsRecord.data(record)}; found ${values.join(", ")}`;
  return { status, values, detail };
};

const combine = (statuses: ReadonlyArray<Storage.RequirementStatus>): Storage.RequirementStatus => {
  const known = statuses.filter((status) => status !== "unknown");
  if (known.length === 0) return "unknown";
  if (known.includes("mismatch")) return "mismatch";
  return known.every((status) => status === "satisfied") ? "satisfied" : "missing";
};

const quorumStatus = (
  quorum: PolicyShape["quorum"],
  statuses: ReadonlyArray<Storage.RequirementStatus>,
): Storage.RequirementStatus => {
  const known = statuses.filter((status) => status !== "unknown");
  const satisfied = known.filter((status) => status === "satisfied").length;
  const needed =
    quorum === "any" ? 1 : quorum === "all" ? Math.max(1, known.length) : quorum.minimum;
  if (known.includes("mismatch")) return "mismatch";
  if (known.length > 0 && satisfied >= needed) return "satisfied";
  return known.length === 0 ? "unknown" : "missing";
};

const overallOf = (
  requirements: ReadonlyArray<{ readonly status: Storage.RequirementStatus }>,
  host: ReadonlyArray<HostEvidence>,
): Storage.Overall => {
  if (
    requirements.some(({ status }) => status === "mismatch") ||
    host.some(({ status }) => status === "failed")
  ) {
    return "failed";
  }
  const ready =
    requirements.length + host.length > 0 &&
    requirements.every(({ status }) => status === "satisfied") &&
    host.every(({ status }) => status === "ok");
  return ready ? "ready" : "pending";
};

/** The identity of a requirement set: type, name, data, and policy, independent of labels and order. */
const requirementSetKey = (requirements: ReadonlyArray<{ readonly record: DnsRecord.Model }>) =>
  requirements
    .map(({ record }) => `${record._tag} ${record.name} ${DnsRecord.data(record)} ${record.policy}`)
    .sort()
    .join("\n");

export const make: Effect.Effect<
  Interface,
  never,
  Storage.Service | Connect.Service | Resolver.Service
> = Effect.gen(function* () {
  const storage = yield* Storage.Service;
  const connect = yield* Connect.Service;
  const resolver = yield* Resolver.Service;

  const attachmentFor = (
    input: string,
  ): Fx<{
    readonly domain: DomainName.Model;
    readonly attachment: Storage.Attachment | null;
  }> =>
    Effect.gen(function* () {
      const domain = yield* DomainName.decode(input);
      const attachment = yield* storage.attachments.byDomain(domain);
      return { domain, attachment: Option.getOrNull(attachment) };
    });

  const decodeRow = (row: Storage.Readiness): Effect.Effect<Readiness, Errors.DomainKitError> =>
    Effect.gen(function* () {
      const requirements = yield* Effect.forEach(row.requirements, (requirement) =>
        Errors.decode(StoredEvidence, requirement.evidence, "evidence").pipe(
          Effect.map((evidence): Requirement => ({
            key: requirementKey(requirement.record),
            operationId: requirement.operationId,
            record: requirement.record,
            status: requirement.status,
            evidence,
          })),
        ),
      );
      const host = yield* Errors.decode(StoredHost, row.host, "host");
      return {
        domain: row.domain,
        attachmentId: row.attachmentId,
        overall: row.overall,
        requirements,
        host,
        checkedAt: row.checkedAt,
        nextCheckAt: row.nextCheckAt,
      };
    });

  /** Persist readiness, carrying the pending streak forward for the backoff ladder. */
  const store = (input: {
    readonly domain: string;
    readonly attachment: Storage.Attachment | null;
    readonly requirements: ReadonlyArray<Requirement>;
    readonly host: ReadonlyArray<HostEvidence>;
    readonly previous: Option.Option<Storage.Readiness>;
    readonly cause: Cause;
  }): Fx<Readiness> =>
    Effect.gen(function* () {
      const principal = yield* Principal.Service;
      const policy = yield* Policy;
      const observer = yield* Observer;
      const now = yield* DateTime.now;
      const overall = overallOf(input.requirements, input.host);
      const sameRequirements =
        Option.isSome(input.previous) &&
        requirementSetKey(input.previous.value.requirements) ===
          requirementSetKey(input.requirements);
      const pendingSince =
        overall === "ready"
          ? null
          : sameRequirements &&
              Option.isSome(input.previous) &&
              input.previous.value.pendingSince !== null
            ? input.previous.value.pendingSince
            : now;
      const nextCheckAt =
        pendingSince === null
          ? null
          : DateTime.addDuration(
              now,
              Duration.millis(
                policy.backoff(DateTime.toEpochMillis(now) - DateTime.toEpochMillis(pendingSince)),
              ),
            );
      const row = new Storage.Readiness({
        domain: input.domain,
        attachmentId: input.attachment?.id ?? null,
        ownerId: principal.ownerId,
        overall,
        requirements: input.requirements.map((requirement) => ({
          operationId: requirement.operationId,
          record: requirement.record,
          status: requirement.status,
          evidence: Schema.encodeSync(StoredEvidence)(requirement.evidence),
        })),
        host: Schema.encodeSync(StoredHost)(input.host),
        pendingSince,
        checkedAt: now,
        nextCheckAt,
      });
      yield* storage.readiness.put(row);
      const readiness: Readiness = {
        domain: row.domain,
        attachmentId: row.attachmentId,
        overall,
        requirements: input.requirements,
        host: input.host,
        checkedAt: now,
        nextCheckAt,
      };
      yield* observer
        .readinessChanged({
          ownerId: principal.ownerId,
          domain: row.domain,
          readiness,
          cause: input.cause,
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`Verify.Observer failed for ${row.domain}`, cause),
          ),
        );
      return readiness;
    });

  const defaultRequirements = (
    attachment: Storage.Attachment,
  ): Fx<
    ReadonlyArray<{
      readonly operationId: Plan.OperationId | null;
      readonly record: DnsRecord.Model;
    }>
  > =>
    Effect.gen(function* () {
      const latest = yield* storage.attempts.latest(attachment.id, "provisioning");
      if (Option.isNone(latest) || latest.value.receipt === null) {
        return yield* Errors.fail(
          new Reason.InvalidInput({
            message: `${attachment.domain} has no provisioning receipt; pass requirements to observe`,
            field: "requirements",
          }),
        );
      }
      const receipt = latest.value.receipt;
      const inPlace = new Set(
        receipt.outcomes.flatMap((outcome) =>
          outcome._tag === "Applied" || (outcome._tag === "Skipped" && outcome.reason === "noop")
            ? [outcome.operationId]
            : [],
        ),
      );
      return latest.value.plan.operations
        .filter((operation) => inPlace.has(operation.id))
        .map((operation) => ({ operationId: operation.id, record: operation.record }));
    });

  const observe: Interface["observe"] = (input) =>
    Effect.gen(function* () {
      const policy = yield* Policy;
      const { domain, attachment } = yield* attachmentFor(input.domain);
      if (input.requirements === undefined && attachment === null) {
        return yield* Errors.fail(
          new Reason.InvalidInput({
            message: `${domain} is not attached; pass requirements to observe public DNS`,
            field: "requirements",
          }),
        );
      }
      const requirements =
        input.requirements === undefined && attachment !== null
          ? yield* defaultRequirements(attachment)
          : (input.requirements ?? []).map((record) => ({ operationId: null, record }));
      if (requirements.length === 0) {
        return yield* Errors.fail(
          new Reason.InvalidInput({
            message: "Nothing to observe: pass at least one requirement",
            field: "requirements",
          }),
        );
      }
      const now = yield* DateTime.now;
      // Provider readback is evidence when the attachment's session can be built; when it
      // cannot (no attachment, revoked credential, provider outage) public DNS stands alone.
      const providerSide = yield* attachment === null
        ? Effect.succeed(Option.none<ProviderSide>())
        : Effect.gen(function* () {
            const connection = yield* storage.connections.get(attachment.connectionId);
            const authorization = yield* storage.authorizations.get(connection.authorizationId);
            const { session, target } = yield* connect.session(attachment.id);
            const observed = yield* session.dns(target).list(target.zone);
            return Option.some<ProviderSide>({
              provider: authorization.provider,
              records: observed.map(({ record }) => record),
            });
          }).pipe(Effect.catch(() => Effect.succeed(Option.none<ProviderSide>())));
      const observed = yield* Effect.forEach(
        requirements,
        ({ operationId, record }) =>
          Effect.gen(function* () {
            const providerEvidence = Option.isSome(providerSide)
              ? [
                  new ProviderEvidence({
                    provider: providerSide.value.provider,
                    ...observation(record, providerSide.value.records),
                    observedAt: now,
                  }),
                ]
              : [];
            const outcomes = yield* resolver.resolve(record.name, record._tag);
            const publicEvidence = outcomes.map((outcome) =>
              outcome._tag === "Answered"
                ? new PublicDnsEvidence({
                    resolver: outcome.answer.resolver,
                    ...observation(record, outcome.answer.records),
                    observedAt: now,
                  })
                : new PublicDnsEvidence({
                    resolver: outcome.resolver,
                    status: "unknown",
                    values: [],
                    detail:
                      outcome._tag === "TimedOut"
                        ? `${outcome.resolver} timed out`
                        : outcome.message,
                    observedAt: now,
                  }),
            );
            const publicStatus = quorumStatus(
              policy.quorum,
              publicEvidence.map(({ status }) => status),
            );
            const status = combine([
              ...providerEvidence.map((evidence) => evidence.status),
              publicStatus,
            ]);
            return {
              key: requirementKey(record),
              operationId,
              record,
              status,
              evidence: [...providerEvidence, ...publicEvidence],
            } satisfies Requirement;
          }),
        { concurrency: "unbounded" },
      );
      const previous = yield* storage.readiness.get(domain);
      const host = Option.isSome(previous)
        ? yield* Errors.decode(StoredHost, previous.value.host, "host")
        : [];
      return yield* store({
        domain,
        attachment,
        requirements: observed,
        host,
        previous,
        cause: "observe",
      });
    });

  const attachEvidence: Interface["attachEvidence"] = (input) =>
    Effect.gen(function* () {
      const { domain, attachment } = yield* attachmentFor(input.domain);
      const previous = yield* storage.readiness.get(domain);
      const current = Option.isSome(previous)
        ? yield* decodeRow(previous.value)
        : {
            requirements: [] as ReadonlyArray<Requirement>,
            host: [] as ReadonlyArray<HostEvidence>,
          };
      const bySource = new Map(current.host.map((evidence) => [evidence.source, evidence]));
      for (const evidence of input.evidence) bySource.set(evidence.source, evidence);
      return yield* store({
        domain,
        attachment,
        requirements: current.requirements,
        host: [...bySource.values()],
        previous,
        cause: "evidence",
      });
    });

  const latest: Interface["latest"] = (domain) =>
    Effect.gen(function* () {
      const { domain: name } = yield* attachmentFor(domain);
      const stored = yield* storage.readiness.get(name);
      return Option.isSome(stored) ? yield* decodeRow(stored.value) : null;
    });

  return { observe, attachEvidence, latest };
});

export const layer: Layer.Layer<
  Service,
  never,
  Storage.Service | Connect.Service | Resolver.Service
> = Layer.effect(Service)(make);

const accessor =
  <Args extends ReadonlyArray<unknown>, A>(
    pick: (service: Interface) => (...args: Args) => Fx<A>,
  ): ((...args: Args) => Effect.Effect<A, Errors.DomainKitError, Principal.Service | Service>) =>
  (...args) =>
    Effect.flatMap(Service, (service) => pick(service)(...args));

export const observe = accessor((service) => service.observe);
export const attachEvidence = accessor((service) => service.attachEvidence);
export const latest = accessor((service) => service.latest);
