import { Context, Data, Effect, Layer, Schema as S } from "effect";

import * as Connection from "./auth/connection.ts";
import type * as DomainDnsRecord from "./domain/dns-record.ts";

export {
  DomainAttachment,
  ProviderConnection,
  ProviderTarget,
  ProviderTargetEvidence,
} from "./auth/connection.ts";

/** A user-presentable failure at the application transport boundary. */
export class Failure extends S.TaggedError<Failure>()("Failure", {
  message: S.String,
  operation: S.String,
  retry: S.Literals(["never", "after-user-action", "safe", "unknown"]),
}) {}

export const AuthenticationParameter = S.Struct({
  description: S.optionalKey(S.String),
  key: S.String,
  label: S.String,
  placeholder: S.optionalKey(S.String),
  required: S.optionalKey(S.Boolean),
});
export type AuthenticationParameter = typeof AuthenticationParameter.Type;

const AuthenticationMethodSchema = S.TaggedUnion({
  Integration: { label: S.String },
  OAuth: { label: S.String },
  Token: {
    label: S.String,
    parameters: S.optionalKey(S.Array(AuthenticationParameter)),
    placeholder: S.optionalKey(S.String),
  },
});

/** Authentication method schema and constructors for trusted host transport responses. */
export const AuthenticationMethod = {
  Schema: AuthenticationMethodSchema,
  Integration: (input: Parameters<typeof AuthenticationMethodSchema.cases.Integration.make>[0]) =>
    AuthenticationMethodSchema.cases.Integration.make(input),
  OAuth: (input: Parameters<typeof AuthenticationMethodSchema.cases.OAuth.make>[0]) =>
    AuthenticationMethodSchema.cases.OAuth.make(input),
  Token: (input: Parameters<typeof AuthenticationMethodSchema.cases.Token.make>[0]) =>
    AuthenticationMethodSchema.cases.Token.make(input),
};
export type AuthenticationMethod = typeof AuthenticationMethodSchema.Type;

/** The authentication choice supplied to a connection request. */
export type Method = Data.TaggedEnum<{
  Integration: {};
  OAuth: {};
  Token: {
    readonly parameters?: Readonly<Record<string, string>>;
    readonly token: string;
  };
}>;
export const Method = Data.taggedEnum<Method>();

export const Provider = S.Struct({
  authentication: S.Array(AuthenticationMethod.Schema),
  id: S.String,
  name: S.String,
});
export type Provider = typeof Provider.Type;

const ConnectedSchema = S.TaggedStruct("Connected", {
  attachment: Connection.DomainAttachment,
  connection: Connection.ProviderConnection,
  provider: Provider,
});
/** Constructs a connected transport snapshot from trusted host data. */
export function Connected(input: Parameters<typeof ConnectedSchema.make>[0]): Connected {
  return ConnectedSchema.make(input);
}
export namespace Connected {
  export const Schema = ConnectedSchema;
}
export type Connected = typeof ConnectedSchema.Type;

export const ReusableConnection = S.Struct({
  connection: Connection.ProviderConnection,
  targets: S.Array(Connection.ProviderTarget),
});
export type ReusableConnection = typeof ReusableConnection.Type;

const DisconnectedSchema = S.TaggedStruct("Disconnected", {
  domain: S.String,
  provider: Provider,
  reusableConnections: S.Array(ReusableConnection),
});
/** Constructs a disconnected transport snapshot from trusted host data. */
export function Disconnected(input: Parameters<typeof DisconnectedSchema.make>[0]): Disconnected {
  return DisconnectedSchema.make(input);
}
export namespace Disconnected {
  export const Schema = DisconnectedSchema;
}
export type Disconnected = typeof DisconnectedSchema.Type;

const UnsupportedSchema = S.TaggedStruct("Unsupported", { domain: S.String });
/** Constructs an unsupported transport snapshot from trusted host data. */
export function Unsupported(input: Parameters<typeof UnsupportedSchema.make>[0]): Unsupported {
  return UnsupportedSchema.make(input);
}
export namespace Unsupported {
  export const Schema = UnsupportedSchema;
}
export type Unsupported = typeof UnsupportedSchema.Type;

export const ConnectionSnapshot = S.Union([
  ConnectedSchema,
  DisconnectedSchema,
  UnsupportedSchema,
]).pipe(S.toTaggedUnion("_tag"));
export type ConnectionSnapshot = typeof ConnectionSnapshot.Type;

const RedirectSchema = S.TaggedStruct("Redirect", { authorizationUrl: S.String });
/** Constructs an OAuth redirect response from trusted host data. */
export function Redirect(input: Parameters<typeof RedirectSchema.make>[0]): Redirect {
  return RedirectSchema.make(input);
}
export namespace Redirect {
  export const Schema = RedirectSchema;
}
export type Redirect = typeof RedirectSchema.Type;

export const ConnectionResult = S.Union([ConnectedSchema, RedirectSchema]).pipe(
  S.toTaggedUnion("_tag"),
);
export type ConnectionResult = typeof ConnectionResult.Type;

const DetachResultSchema = S.TaggedStruct("Detached", {
  attachment: Connection.DomainAttachment,
  connection: Connection.ProviderConnection,
  remainingAttachments: S.Int,
});
/** Constructs a detach response from trusted host data. */
export function DetachResult(input: Parameters<typeof DetachResultSchema.make>[0]): DetachResult {
  return DetachResultSchema.make(input);
}
export namespace DetachResult {
  export const Schema = DetachResultSchema;
}
export type DetachResult = typeof DetachResultSchema.Type;

/** A presentation projection of a DNS requirement. */
export const DnsRecord = S.Struct({
  id: S.String,
  name: S.String,
  priority: S.optionalKey(S.Int),
  type: S.String,
  value: S.String,
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

const PlanOperationSchema = S.TaggedUnion({
  Conflict: { id: S.String, reason: S.String, record: DnsRecord },
  Create: { id: S.String, record: DnsRecord },
  Noop: { id: S.String, record: DnsRecord },
});
/** Provisioning operation schema and constructors for trusted host responses. */
export const PlanOperation = {
  Schema: PlanOperationSchema,
  Conflict: (input: Parameters<typeof PlanOperationSchema.cases.Conflict.make>[0]) =>
    PlanOperationSchema.cases.Conflict.make(input),
  Create: (input: Parameters<typeof PlanOperationSchema.cases.Create.make>[0]) =>
    PlanOperationSchema.cases.Create.make(input),
  Noop: (input: Parameters<typeof PlanOperationSchema.cases.Noop.make>[0]) =>
    PlanOperationSchema.cases.Noop.make(input),
};
export type PlanOperation = typeof PlanOperationSchema.Type;

const ProvisioningPlanSchema = S.TaggedStruct("Plan", {
  digest: S.String,
  expiresAt: S.String,
  operations: S.Array(PlanOperation.Schema),
});
/** Constructs a provisioning plan response from trusted host data. */
export function ProvisioningPlan(
  input: Parameters<typeof ProvisioningPlanSchema.make>[0],
): ProvisioningPlan {
  return ProvisioningPlanSchema.make(input);
}
export namespace ProvisioningPlan {
  export const Schema = ProvisioningPlanSchema;
}
export type ProvisioningPlan = typeof ProvisioningPlanSchema.Type;

const OperationResultSchema = S.TaggedUnion({
  Applied: { operationId: S.String },
  Failed: { message: S.String, operationId: S.String },
  Unchanged: { operationId: S.String },
});
/** Per-operation result schema and constructors for trusted host responses. */
export const OperationResult = {
  Schema: OperationResultSchema,
  Applied: (input: Parameters<typeof OperationResultSchema.cases.Applied.make>[0]) =>
    OperationResultSchema.cases.Applied.make(input),
  Failed: (input: Parameters<typeof OperationResultSchema.cases.Failed.make>[0]) =>
    OperationResultSchema.cases.Failed.make(input),
  Unchanged: (input: Parameters<typeof OperationResultSchema.cases.Unchanged.make>[0]) =>
    OperationResultSchema.cases.Unchanged.make(input),
};
export type OperationResult = typeof OperationResultSchema.Type;

const ApplyOutcomeFields = {
  operationId: S.String,
  receiptId: S.String,
  results: S.Array(OperationResult.Schema),
};
const ApplyResultSchema = S.TaggedUnion({
  Applied: ApplyOutcomeFields,
  Partial: ApplyOutcomeFields,
  Stale: { message: S.String },
});
/** Apply result schema and constructors for trusted host responses. */
export const ApplyResult = {
  Schema: ApplyResultSchema,
  Applied: (input: Parameters<typeof ApplyResultSchema.cases.Applied.make>[0]) =>
    ApplyResultSchema.cases.Applied.make(input),
  Partial: (input: Parameters<typeof ApplyResultSchema.cases.Partial.make>[0]) =>
    ApplyResultSchema.cases.Partial.make(input),
  Stale: (input: Parameters<typeof ApplyResultSchema.cases.Stale.make>[0]) =>
    ApplyResultSchema.cases.Stale.make(input),
};
export type ApplyResult = typeof ApplyResultSchema.Type;

const ObservationEvidenceSchema = S.TaggedUnion({
  Found: { recordId: S.String },
  Mismatch: { message: S.String, recordId: S.String },
  Missing: { recordId: S.String },
  Unavailable: { message: S.String, recordId: S.String },
});
/** DNS observation evidence schema and constructors for trusted host responses. */
export const ObservationEvidence = {
  Schema: ObservationEvidenceSchema,
  Found: (input: Parameters<typeof ObservationEvidenceSchema.cases.Found.make>[0]) =>
    ObservationEvidenceSchema.cases.Found.make(input),
  Mismatch: (input: Parameters<typeof ObservationEvidenceSchema.cases.Mismatch.make>[0]) =>
    ObservationEvidenceSchema.cases.Mismatch.make(input),
  Missing: (input: Parameters<typeof ObservationEvidenceSchema.cases.Missing.make>[0]) =>
    ObservationEvidenceSchema.cases.Missing.make(input),
  Unavailable: (input: Parameters<typeof ObservationEvidenceSchema.cases.Unavailable.make>[0]) =>
    ObservationEvidenceSchema.cases.Unavailable.make(input),
};
export type ObservationEvidence = typeof ObservationEvidenceSchema.Type;

const ObservationSchema = S.TaggedStruct("Observation", {
  provider: S.Array(ObservationEvidence.Schema),
  publicDns: S.Array(ObservationEvidence.Schema),
});
/** Constructs a DNS observation response from trusted host data. */
export function Observation(input: Parameters<typeof ObservationSchema.make>[0]): Observation {
  return ObservationSchema.make(input);
}
export namespace Observation {
  export const Schema = ObservationSchema;
}
export type Observation = typeof ObservationSchema.Type;

const CleanupOperationSchema = S.TaggedUnion({
  AlreadyAbsent: { id: S.String, record: DnsRecord },
  Blocked: { id: S.String, reason: S.String, record: DnsRecord },
  Delete: { id: S.String, record: DnsRecord },
});
/** Cleanup operation schema and constructors for trusted host responses. */
export const CleanupOperation = {
  Schema: CleanupOperationSchema,
  AlreadyAbsent: (input: Parameters<typeof CleanupOperationSchema.cases.AlreadyAbsent.make>[0]) =>
    CleanupOperationSchema.cases.AlreadyAbsent.make(input),
  Blocked: (input: Parameters<typeof CleanupOperationSchema.cases.Blocked.make>[0]) =>
    CleanupOperationSchema.cases.Blocked.make(input),
  Delete: (input: Parameters<typeof CleanupOperationSchema.cases.Delete.make>[0]) =>
    CleanupOperationSchema.cases.Delete.make(input),
};
export type CleanupOperation = typeof CleanupOperationSchema.Type;

const CleanupPlanSchema = S.TaggedStruct("CleanupPlan", {
  digest: S.String,
  expiresAt: S.String,
  operations: S.Array(CleanupOperation.Schema),
});
/** Constructs a cleanup plan response from trusted host data. */
export function CleanupPlan(input: Parameters<typeof CleanupPlanSchema.make>[0]): CleanupPlan {
  return CleanupPlanSchema.make(input);
}
export namespace CleanupPlan {
  export const Schema = CleanupPlanSchema;
}
export type CleanupPlan = typeof CleanupPlanSchema.Type;

const CleanupOutcomeFields = {
  operationId: S.String,
  results: S.Array(OperationResult.Schema),
};
const CleanupResultSchema = S.TaggedUnion({
  Cleaned: CleanupOutcomeFields,
  Partial: CleanupOutcomeFields,
  Stale: { message: S.String },
});
/** Cleanup result schema and constructors for trusted host responses. */
export const CleanupResult = {
  Schema: CleanupResultSchema,
  Cleaned: (input: Parameters<typeof CleanupResultSchema.cases.Cleaned.make>[0]) =>
    CleanupResultSchema.cases.Cleaned.make(input),
  Partial: (input: Parameters<typeof CleanupResultSchema.cases.Partial.make>[0]) =>
    CleanupResultSchema.cases.Partial.make(input),
  Stale: (input: Parameters<typeof CleanupResultSchema.cases.Stale.make>[0]) =>
    CleanupResultSchema.cases.Stale.make(input),
};
export type CleanupResult = typeof CleanupResultSchema.Type;

export interface ConnectInput {
  readonly domain: string;
  readonly method: Method;
  readonly providerId: string;
}

export interface InspectInput {
  readonly domain: string;
}

export interface AttachInput {
  readonly connectionId: string;
  readonly domain: string;
  readonly target: Connection.ProviderTarget;
}

export interface DetachInput {
  readonly attachmentId: string;
  readonly preserveDns: true;
}

export interface ProvisioningPlanInput {
  readonly attachmentId: string;
  readonly domain: string;
  readonly records: ReadonlyArray<DnsRecord>;
}

export interface ProvisioningApplyInput {
  readonly attachmentId: string;
  readonly domain: string;
  readonly planDigest: string;
}

export interface ObserveInput {
  readonly attachmentId?: string;
  readonly domain: string;
  readonly records: ReadonlyArray<DnsRecord>;
  readonly sources: {
    readonly provider: boolean;
    readonly publicDns: boolean;
  };
}

export interface CleanupPlanInput {
  readonly attachmentId: string;
  readonly domain: string;
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
    readonly attach: (input: AttachInput) => Effect.Effect<Connected, Failure>;
    readonly connect: (input: ConnectInput) => Effect.Effect<ConnectionResult, Failure>;
    readonly inspect: (input: InspectInput) => Effect.Effect<ConnectionSnapshot, Failure>;
    readonly detach: (input: DetachInput) => Effect.Effect<DetachResult, Failure>;
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
    readonly attach: (input: AttachInput) => Promise<Connected>;
    readonly connect: (input: ConnectInput) => Promise<ConnectionResult>;
    readonly inspect: (input: InspectInput) => Promise<ConnectionSnapshot>;
    readonly detach: (input: DetachInput) => Promise<DetachResult>;
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
      attach: (input) => attempt("connection.attach", () => transport.connection.attach(input)),
      connect: (input) => attempt("connection.connect", () => transport.connection.connect(input)),
      inspect: (input) => attempt("connection.inspect", () => transport.connection.inspect(input)),
      detach: (input) => attempt("connection.detach", () => transport.connection.detach(input)),
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
    attach: (input) => Effect.runPromise(transport.connection.attach(input)),
    connect: (input) => Effect.runPromise(transport.connection.connect(input)),
    inspect: (input) => Effect.runPromise(transport.connection.inspect(input)),
    detach: (input) => Effect.runPromise(transport.connection.detach(input)),
  },
  provisioning: {
    apply: (input) => Effect.runPromise(transport.provisioning.apply(input)),
    plan: (input) => Effect.runPromise(transport.provisioning.plan(input)),
  },
  verification: {
    observe: (input) => Effect.runPromise(transport.verification.observe(input)),
  },
});
