import { Context, Data, Effect, Layer, Schema } from "effect";

import type * as DomainDnsRecord from "./domain/dns-record.ts";

/** A user-presentable failure at the application transport boundary. */
export class Failure extends Schema.TaggedError<Failure>()("Failure", {
  message: Schema.String,
  operation: Schema.String,
  retry: Schema.Literals(["never", "after-user-action", "safe", "unknown"]),
}) {}

export const AuthenticationParameter = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  key: Schema.String,
  label: Schema.String,
  placeholder: Schema.optionalKey(Schema.String),
  required: Schema.optionalKey(Schema.Boolean),
});
export type AuthenticationParameter = typeof AuthenticationParameter.Type;

export const AuthenticationMethod = Schema.TaggedUnion({
  OAuth: { label: Schema.String },
  Token: {
    label: Schema.String,
    parameters: Schema.optionalKey(Schema.Array(AuthenticationParameter)),
    placeholder: Schema.optionalKey(Schema.String),
  },
});
export type AuthenticationMethod = typeof AuthenticationMethod.Type;

/** The authentication choice supplied to a connection request. */
export type Method = Data.TaggedEnum<{
  OAuth: {};
  Token: {
    readonly parameters?: Readonly<Record<string, string>>;
    readonly token: string;
  };
}>;
export const Method = Data.taggedEnum<Method>();

export const Provider = Schema.Struct({
  authentication: Schema.Array(AuthenticationMethod),
  id: Schema.String,
  name: Schema.String,
});
export type Provider = typeof Provider.Type;

export const Connected = Schema.TaggedStruct("Connected", {
  connectionId: Schema.String,
  domain: Schema.String,
  provider: Provider,
});
export type Connected = typeof Connected.Type;

export const ReusableConnection = Schema.Struct({
  connectionId: Schema.String,
  label: Schema.String,
});
export type ReusableConnection = typeof ReusableConnection.Type;

export const Disconnected = Schema.TaggedStruct("Disconnected", {
  domain: Schema.String,
  provider: Provider,
  reusableConnection: Schema.optionalKey(ReusableConnection),
});
export type Disconnected = typeof Disconnected.Type;

export const Unsupported = Schema.TaggedStruct("Unsupported", { domain: Schema.String });
export type Unsupported = typeof Unsupported.Type;

export const ConnectionSnapshot = Schema.Union([Connected, Disconnected, Unsupported]).pipe(
  Schema.toTaggedUnion("_tag"),
);
export type ConnectionSnapshot = typeof ConnectionSnapshot.Type;

export const Redirect = Schema.TaggedStruct("Redirect", { authorizationUrl: Schema.String });
export type Redirect = typeof Redirect.Type;

export const ConnectionResult = Schema.Union([Connected, Redirect]).pipe(
  Schema.toTaggedUnion("_tag"),
);
export type ConnectionResult = typeof ConnectionResult.Type;

export const RemoveDomainResult = Schema.TaggedStruct("Removed", {
  connectionId: Schema.String,
  domain: Schema.String,
  remainingDomainCount: Schema.Int,
});
export type RemoveDomainResult = typeof RemoveDomainResult.Type;

/** A presentation projection of a DNS requirement. */
export const DnsRecord = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  priority: Schema.optionalKey(Schema.Int),
  type: Schema.String,
  value: Schema.String,
});
export type DnsRecord = typeof DnsRecord.Type;

/** Projects DomainKit's operational record into its application transport representation. */
export const fromDnsRecord = (id: string, record: DomainDnsRecord.DnsRecord): DnsRecord => {
  switch (record._tag) {
    case "A":
    case "AAAA":
      return { id, name: record.name, type: record._tag, value: record.address };
    case "CNAME":
    case "NS":
      return { id, name: record.name, type: record._tag, value: record.target };
    case "TXT":
      return { id, name: record.name, type: record._tag, value: record.value };
    case "MX":
      return {
        id,
        name: record.name,
        priority: record.priority,
        type: record._tag,
        value: record.exchange,
      };
    case "CAA":
      return {
        id,
        name: record.name,
        type: record._tag,
        value: `${record.flags} ${record.tag} ${record.value}`,
      };
    case "SRV":
      return {
        id,
        name: record.name,
        priority: record.priority,
        type: record._tag,
        value: `${record.weight} ${record.port} ${record.target}`,
      };
  }
};

export const PlanOperation = Schema.TaggedUnion({
  Conflict: { id: Schema.String, reason: Schema.String, record: DnsRecord },
  Create: { id: Schema.String, record: DnsRecord },
  Noop: { id: Schema.String, record: DnsRecord },
});
export type PlanOperation = typeof PlanOperation.Type;

export const ProvisioningPlan = Schema.TaggedStruct("Plan", {
  digest: Schema.String,
  expiresAt: Schema.String,
  operations: Schema.Array(PlanOperation),
});
export type ProvisioningPlan = typeof ProvisioningPlan.Type;

export const OperationResult = Schema.TaggedUnion({
  Applied: { operationId: Schema.String },
  Failed: { message: Schema.String, operationId: Schema.String },
  Unchanged: { operationId: Schema.String },
});
export type OperationResult = typeof OperationResult.Type;

const ApplyOutcomeFields = {
  operationId: Schema.String,
  receiptId: Schema.String,
  results: Schema.Array(OperationResult),
};
export const ApplyResult = Schema.TaggedUnion({
  Applied: ApplyOutcomeFields,
  Partial: ApplyOutcomeFields,
  Stale: { message: Schema.String },
});
export type ApplyResult = typeof ApplyResult.Type;

export const ObservationEvidence = Schema.TaggedUnion({
  Found: { recordId: Schema.String },
  Mismatch: { message: Schema.String, recordId: Schema.String },
  Missing: { recordId: Schema.String },
  Unavailable: { message: Schema.String, recordId: Schema.String },
});
export type ObservationEvidence = typeof ObservationEvidence.Type;

export const Observation = Schema.TaggedStruct("Observation", {
  provider: Schema.Array(ObservationEvidence),
  publicDns: Schema.Array(ObservationEvidence),
});
export type Observation = typeof Observation.Type;

export const CleanupOperation = Schema.TaggedUnion({
  AlreadyAbsent: { id: Schema.String, record: DnsRecord },
  Blocked: { id: Schema.String, reason: Schema.String, record: DnsRecord },
  Delete: { id: Schema.String, record: DnsRecord },
});
export type CleanupOperation = typeof CleanupOperation.Type;

export const CleanupPlan = Schema.TaggedStruct("CleanupPlan", {
  digest: Schema.String,
  expiresAt: Schema.String,
  operations: Schema.Array(CleanupOperation),
});
export type CleanupPlan = typeof CleanupPlan.Type;

const CleanupOutcomeFields = {
  operationId: Schema.String,
  results: Schema.Array(OperationResult),
};
export const CleanupResult = Schema.TaggedUnion({
  Cleaned: CleanupOutcomeFields,
  Partial: CleanupOutcomeFields,
  Stale: { message: Schema.String },
});
export type CleanupResult = typeof CleanupResult.Type;

export interface ConnectInput {
  readonly domain: string;
  readonly method: Method;
  readonly providerId: string;
}

export interface InspectInput {
  readonly domain: string;
}

export interface ReuseInput {
  readonly connectionId: string;
  readonly domain: string;
}

export interface RemoveDomainInput extends ReuseInput {
  readonly preserveDns: true;
}

export interface ProvisioningPlanInput extends ReuseInput {
  readonly records: ReadonlyArray<DnsRecord>;
}

export interface ProvisioningApplyInput extends ReuseInput {
  readonly planDigest: string;
}

export interface ObserveInput {
  readonly connectionId?: string;
  readonly domain: string;
  readonly records: ReadonlyArray<DnsRecord>;
  readonly sources: {
    readonly provider: boolean;
    readonly publicDns: boolean;
  };
}

export interface CleanupPlanInput extends ReuseInput {
  readonly receiptId: string;
}

export interface CleanupApplyInput extends CleanupPlanInput {
  readonly planDigest: string;
}

/** Application-facing DNS connection and provisioning capability. */
export interface Interface {
  readonly cleanup: {
    readonly apply: (input: CleanupApplyInput) => Effect.Effect<CleanupResult, Failure>;
    readonly plan: (input: CleanupPlanInput) => Effect.Effect<CleanupPlan, Failure>;
  };
  readonly connection: {
    readonly connect: (input: ConnectInput) => Effect.Effect<ConnectionResult, Failure>;
    readonly inspect: (input: InspectInput) => Effect.Effect<ConnectionSnapshot, Failure>;
    readonly removeDomain: (input: RemoveDomainInput) => Effect.Effect<RemoveDomainResult, Failure>;
    readonly reuse: (input: ReuseInput) => Effect.Effect<Connected, Failure>;
  };
  readonly provisioning: {
    readonly apply: (input: ProvisioningApplyInput) => Effect.Effect<ApplyResult, Failure>;
    readonly plan: (input: ProvisioningPlanInput) => Effect.Effect<ProvisioningPlan, Failure>;
  };
  readonly verification: {
    readonly observe: (input: ObserveInput) => Effect.Effect<Observation, Failure>;
  };
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/Transport") {}

/** Promise-shaped host seam for foreign runtimes and framework actions. */
export interface AsyncInterface {
  readonly cleanup: {
    readonly apply: (input: CleanupApplyInput) => Promise<CleanupResult>;
    readonly plan: (input: CleanupPlanInput) => Promise<CleanupPlan>;
  };
  readonly connection: {
    readonly connect: (input: ConnectInput) => Promise<ConnectionResult>;
    readonly inspect: (input: InspectInput) => Promise<ConnectionSnapshot>;
    readonly removeDomain: (input: RemoveDomainInput) => Promise<RemoveDomainResult>;
    readonly reuse: (input: ReuseInput) => Promise<Connected>;
  };
  readonly provisioning: {
    readonly apply: (input: ProvisioningApplyInput) => Promise<ApplyResult>;
    readonly plan: (input: ProvisioningPlanInput) => Promise<ProvisioningPlan>;
  };
  readonly verification: {
    readonly observe: (input: ObserveInput) => Promise<Observation>;
  };
}

export interface AsyncOptions {
  readonly onError?: (operation: string, cause: unknown) => Failure;
}

/** Converts a Promise-shaped host implementation into the canonical Effect service. */
export const fromAsync = (transport: AsyncInterface, options: AsyncOptions = {}): Interface => {
  const attempt = <A>(operation: string, evaluate: () => Promise<A>) =>
    Effect.tryPromise({
      try: evaluate,
      catch: (cause) =>
        options.onError?.(operation, cause) ??
        (cause instanceof Failure
          ? cause
          : new Failure({
              message: cause instanceof globalThis.Error ? cause.message : String(cause),
              operation,
              retry: "unknown",
            })),
    });
  return Service.of({
    cleanup: {
      apply: (input) => attempt("cleanup.apply", () => transport.cleanup.apply(input)),
      plan: (input) => attempt("cleanup.plan", () => transport.cleanup.plan(input)),
    },
    connection: {
      connect: (input) => attempt("connection.connect", () => transport.connection.connect(input)),
      inspect: (input) => attempt("connection.inspect", () => transport.connection.inspect(input)),
      removeDomain: (input) =>
        attempt("connection.removeDomain", () => transport.connection.removeDomain(input)),
      reuse: (input) => attempt("connection.reuse", () => transport.connection.reuse(input)),
    },
    provisioning: {
      apply: (input) => attempt("provisioning.apply", () => transport.provisioning.apply(input)),
      plan: (input) => attempt("provisioning.plan", () => transport.provisioning.plan(input)),
    },
    verification: {
      observe: (input) =>
        attempt("verification.observe", () => transport.verification.observe(input)),
    },
  });
};

export const layerFromAsync = (
  transport: AsyncInterface,
  options?: AsyncOptions,
): Layer.Layer<Service> => Layer.succeed(Service, fromAsync(transport, options));

/** Converts an environment-free Effect service into its Promise-shaped host seam. */
export const toAsync = (transport: Interface): AsyncInterface => ({
  cleanup: {
    apply: (input) => Effect.runPromise(transport.cleanup.apply(input)),
    plan: (input) => Effect.runPromise(transport.cleanup.plan(input)),
  },
  connection: {
    connect: (input) => Effect.runPromise(transport.connection.connect(input)),
    inspect: (input) => Effect.runPromise(transport.connection.inspect(input)),
    removeDomain: (input) => Effect.runPromise(transport.connection.removeDomain(input)),
    reuse: (input) => Effect.runPromise(transport.connection.reuse(input)),
  },
  provisioning: {
    apply: (input) => Effect.runPromise(transport.provisioning.apply(input)),
    plan: (input) => Effect.runPromise(transport.provisioning.plan(input)),
  },
  verification: {
    observe: (input) => Effect.runPromise(transport.verification.observe(input)),
  },
});
