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
   * Requirements default to the latest provisioning receipt for the attachment (records it
   * applied or found in place); pass `requirements` to observe an arbitrary set, including for a
   * domain with no attachment. Provider evidence is added when the attachment's session can be
   * built; public DNS is always observed.
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
const requirementKey = (requirements: ReadonlyArray<{ readonly record: DnsRecord.Model }>) =>
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
  }): Fx<Readiness> =>
    Effect.gen(function* () {
      const principal = yield* Principal.Service;
      const policy = yield* Policy;
      const now = yield* DateTime.now;
      const overall = overallOf(input.requirements, input.host);
      const sameRequirements =
        Option.isSome(input.previous) &&
        requirementKey(input.previous.value.requirements) === requirementKey(input.requirements);
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
      return {
        domain: row.domain,
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
                    status: statusAgainst(record, providerSide.value.records),
                    observedAt: now,
                  }),
                ]
              : [];
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
            const status = combine([
              ...providerEvidence.map((evidence) => evidence.status),
              publicStatus,
            ]);
            return {
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
      return yield* store({ domain, attachment, requirements: observed, host, previous });
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
