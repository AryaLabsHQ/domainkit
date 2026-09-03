/**
 * Observe provider and public DNS for an attachment, persist per-requirement readiness, and say
 * when to look again. The host keeps its own state machine (and any provider-side verification
 * such as SES) and feeds that in as `HostEvidence`.
 */
import { Context, DateTime, Duration, Effect, Layer, Option, Schema } from "effect";

import { Connect } from "./Connect.ts";
import * as DnsRecord from "./DnsRecord.ts";
import * as DomainKitError from "./DomainKitError.ts";
import * as DomainName from "./DomainName.ts";
import type * as Plan from "./Plan.ts";
import { Principal } from "./Principal.ts";
import { Resolver } from "./Resolver.ts";
import * as Storage from "./Storage.ts";

export class ProviderEvidence extends Schema.TaggedClass<ProviderEvidence>(
  "@domainkit/Evidence/Provider",
)("Provider", {
  provider: Schema.String,
  status: Storage.RequirementStatus,
  observedAt: Schema.DateTimeUtcFromString,
}) {}
export class PublicDnsEvidence extends Schema.TaggedClass<PublicDnsEvidence>(
  "@domainkit/Evidence/PublicDns",
)("PublicDns", {
  resolver: Schema.String,
  status: Storage.RequirementStatus,
  observedAt: Schema.DateTimeUtcFromString,
}) {}
/** Anything the host knows that DomainKit cannot observe: SES identity status, a CDN cert, ... */
export class HostEvidence extends Schema.TaggedClass<HostEvidence>("@domainkit/Evidence/Host")(
  "Host",
  {
    source: Schema.String,
    status: Schema.Literals(["ok", "pending", "failed"]),
    label: Schema.String,
    detail: Schema.optionalKey(Schema.String),
    observedAt: Schema.DateTimeUtcFromString,
  },
) {}
export const Evidence = Schema.Union([ProviderEvidence, PublicDnsEvidence, HostEvidence]);
export type Evidence = typeof Evidence.Type;

export interface Requirement {
  readonly operationId: Plan.OperationId | null;
  readonly record: DnsRecord.DnsRecord;
  readonly status: Storage.RequirementStatus;
  readonly evidence: ReadonlyArray<Evidence>;
}

export interface Readiness {
  readonly attachmentId: string;
  readonly overall: Storage.Overall;
  readonly requirements: ReadonlyArray<Requirement>;
  readonly host: ReadonlyArray<HostEvidence>;
  readonly checkedAt: DateTime.Utc;
  readonly nextCheckAt: DateTime.Utc | null;
}

type Fx<A> = Effect.Effect<A, DomainKitError.DomainKitError, Principal>;

export interface Service {
  /**
   * Requirements default to the latest provisioning receipt for the attachment (records it
   * applied or found in place); pass `requirements` to observe an arbitrary set.
   */
  readonly observe: (input: {
    readonly domain: string;
    readonly requirements?: ReadonlyArray<DnsRecord.DnsRecord>;
  }) => Fx<Readiness>;
  /** Merge host evidence into stored readiness without re-observing DNS. */
  readonly attachEvidence: (input: {
    readonly domain: string;
    readonly evidence: ReadonlyArray<HostEvidence>;
  }) => Fx<Readiness>;
  readonly latest: (domain: string) => Fx<Readiness | null>;
}

export class Verify extends Context.Service<Verify, Service>()("@domainkit/Verify") {}

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

// ---------------------------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------------------------

const StoredEvidence = Schema.Array(Evidence);
const StoredHost = Schema.Array(HostEvidence);

/** A requirement is satisfied by an exact match; an exclusive one is contradicted by any same-set record. */
export const statusAgainst = (
  record: DnsRecord.DnsRecord,
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
  if (known.length > 0 && satisfied >= needed) return "satisfied";
  if (known.includes("mismatch")) return "mismatch";
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
    requirements.every(({ status }) => status === "satisfied") &&
    host.every(({ status }) => status === "ok");
  return ready ? "ready" : "pending";
};

export const make: Effect.Effect<Service, never, Storage.Storage | Connect | Resolver> = Effect.gen(
  function* () {
    const storage = yield* Storage.Storage;
    const connect = yield* Connect;
    const resolver = yield* Resolver;

    const attachmentFor = (input: string): Fx<Storage.Attachment> =>
      Effect.gen(function* () {
        const domain = yield* DomainName.decode(input);
        const attachment = yield* storage.attachments.byDomain(domain);
        if (Option.isNone(attachment)) {
          return yield* DomainKitError.fail(
            new DomainKitError.NotFound({ entity: "attachment", id: domain }),
          );
        }
        return attachment.value;
      });

    const decodeRow = (
      row: Storage.Readiness,
    ): Effect.Effect<Readiness, DomainKitError.DomainKitError> =>
      Effect.gen(function* () {
        const requirements = yield* Effect.forEach(row.requirements, (requirement) =>
          DomainKitError.decode(StoredEvidence, requirement.evidence, "evidence").pipe(
            Effect.map((evidence): Requirement => ({
              operationId: requirement.operationId,
              record: requirement.record,
              status: requirement.status,
              evidence,
            })),
          ),
        );
        const host = yield* DomainKitError.decode(StoredHost, row.host, "host");
        return {
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
      readonly attachment: Storage.Attachment;
      readonly requirements: ReadonlyArray<Requirement>;
      readonly host: ReadonlyArray<HostEvidence>;
      readonly previous: Option.Option<Storage.Readiness>;
    }): Fx<Readiness> =>
      Effect.gen(function* () {
        const principal = yield* Principal;
        const policy = yield* Policy;
        const now = yield* DateTime.now;
        const overall = overallOf(input.requirements, input.host);
        const pendingSince =
          overall === "ready"
            ? null
            : Option.isSome(input.previous) && input.previous.value.pendingSince !== null
              ? input.previous.value.pendingSince
              : now;
        const nextCheckAt =
          pendingSince === null
            ? null
            : DateTime.addDuration(
                now,
                Duration.millis(
                  policy.backoff(
                    DateTime.toEpochMillis(now) - DateTime.toEpochMillis(pendingSince),
                  ),
                ),
              );
        const row = new Storage.Readiness({
          attachmentId: input.attachment.id,
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
        return {
          attachmentId: row.attachmentId,
          overall,
          requirements: input.requirements,
          host: input.host,
          checkedAt: now,
          nextCheckAt,
        };
      });

    const defaultRequirements = (
      attachment: Storage.Attachment,
    ): Fx<
      ReadonlyArray<{
        readonly operationId: Plan.OperationId | null;
        readonly record: DnsRecord.DnsRecord;
      }>
    > =>
      Effect.gen(function* () {
        const latest = yield* storage.attempts.latest(attachment.id, "provisioning");
        if (Option.isNone(latest) || latest.value.receipt === null) {
          return yield* DomainKitError.fail(
            new DomainKitError.InvalidInput({
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

    const observe: Service["observe"] = (input) =>
      Effect.gen(function* () {
        const policy = yield* Policy;
        const attachment = yield* attachmentFor(input.domain);
        const requirements =
          input.requirements === undefined
            ? yield* defaultRequirements(attachment)
            : input.requirements.map((record) => ({ operationId: null, record }));
        const now = yield* DateTime.now;
        const { session, target } = yield* connect.session(attachment.id);
        const providerRecords = yield* session
          .dns(target)
          .list(target.zone)
          .pipe(
            Effect.map((observed) => Option.some(observed.map(({ record }) => record))),
            Effect.catchIf(
              (error) => error.reason._tag !== "Reconnect",
              () => Effect.succeed(Option.none<ReadonlyArray<DnsRecord.Observed>>()),
            ),
          );
        const provider = yield* Effect.gen(function* () {
          const connection = yield* storage.connections.get(attachment.connectionId);
          const authorization = yield* storage.authorizations.get(connection.authorizationId);
          return authorization.provider;
        });
        const observed = yield* Effect.forEach(
          requirements,
          ({ operationId, record }) =>
            Effect.gen(function* () {
              const providerEvidence = new ProviderEvidence({
                provider,
                status: Option.isSome(providerRecords)
                  ? statusAgainst(record, providerRecords.value)
                  : "unknown",
                observedAt: now,
              });
              const outcomes = yield* resolver.resolve(record.name, record._tag);
              const publicEvidence = outcomes.map(
                (outcome) =>
                  new PublicDnsEvidence({
                    resolver:
                      outcome._tag === "Answered" ? outcome.answer.resolver : outcome.resolver,
                    status:
                      outcome._tag === "Answered"
                        ? statusAgainst(record, outcome.answer.records)
                        : "unknown",
                    observedAt: now,
                  }),
              );
              const publicStatus = quorumStatus(
                policy.quorum,
                publicEvidence.map(({ status }) => status),
              );
              const status = combine([providerEvidence.status, publicStatus]);
              return {
                operationId,
                record,
                status,
                evidence: [providerEvidence, ...publicEvidence],
              } satisfies Requirement;
            }),
          { concurrency: "unbounded" },
        );
        const previous = yield* storage.readiness.get(attachment.id);
        const host = Option.isSome(previous)
          ? yield* DomainKitError.decode(StoredHost, previous.value.host, "host")
          : [];
        return yield* store({ attachment, requirements: observed, host, previous });
      });

    const attachEvidence: Service["attachEvidence"] = (input) =>
      Effect.gen(function* () {
        const attachment = yield* attachmentFor(input.domain);
        const previous = yield* storage.readiness.get(attachment.id);
        const current = Option.isSome(previous)
          ? yield* decodeRow(previous.value)
          : {
              requirements: [] as ReadonlyArray<Requirement>,
              host: [] as ReadonlyArray<HostEvidence>,
            };
        const bySource = new Map(current.host.map((evidence) => [evidence.source, evidence]));
        for (const evidence of input.evidence) bySource.set(evidence.source, evidence);
        return yield* store({
          attachment,
          requirements: current.requirements,
          host: [...bySource.values()],
          previous,
        });
      });

    const latest: Service["latest"] = (domain) =>
      Effect.gen(function* () {
        const attachment = yield* attachmentFor(domain);
        const stored = yield* storage.readiness.get(attachment.id);
        return Option.isSome(stored) ? yield* decodeRow(stored.value) : null;
      });

    return { observe, attachEvidence, latest };
  },
);

export const layer: Layer.Layer<Verify, never, Storage.Storage | Connect | Resolver> =
  Layer.effect(Verify)(make);

const accessor =
  <Args extends ReadonlyArray<unknown>, A>(
    pick: (service: Service) => (...args: Args) => Fx<A>,
  ): ((...args: Args) => Effect.Effect<A, DomainKitError.DomainKitError, Principal | Verify>) =>
  (...args) =>
    Effect.flatMap(Verify, (service) => pick(service)(...args));

export const observe = accessor((service) => service.observe);
export const attachEvidence = accessor((service) => service.attachEvidence);
export const latest = accessor((service) => service.latest);
