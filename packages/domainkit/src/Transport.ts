/**
 * domainkit/client — the browser-side transport `@domainkit/react` consumes. Capability groups are
 * optional: a host that only exposes connection routes declares just `connection`, and the parts
 * of the UI that plan or clean up do not render.
 *
 *   const transport = Transport.fromFetch("/api/domainkit")
 *
 * Every method decodes the same wire schemas `domainkit/server` encodes, so a failure arrives as
 * the `DomainKitError` the lifecycle raised, reason intact.
 */
import { Effect, Schema } from "effect";

import * as Approval from "./Approval.ts";
import type * as DnsRecord from "./DnsRecord.ts";
import * as DomainKitError from "./DomainKitError.ts";
import * as Http from "./internal/http.ts";
import * as Plan from "./Plan.ts";
import * as Receipt from "./Receipt.ts";
import * as Server from "./Server.ts";

type Fx<A> = Effect.Effect<A, DomainKitError.DomainKitError>;

export type Snapshot = Server.Snapshot;
export type Started = Server.Started;
export type Readiness = Server.Readiness;
export type Attempt = Server.Attempt;
export type Candidate = Server.Candidate;
export type Method = Server.Method;

/** How a client asks to connect. Mirrors `Connect.Method`, over the wire. */
export const Method = {
  token: (token: string): Method => new Server.Token({ token }),
  oauth: (options: { readonly returnTo?: string } = {}): Method => new Server.OAuth(options),
  integration: (options: { readonly returnTo?: string } = {}): Method =>
    new Server.Integration(options),
} as const;

export interface ConnectionGroup {
  readonly inspect: (domain: string) => Fx<Snapshot>;
  readonly start: (input: {
    readonly domain: string;
    readonly provider: string;
    readonly method: Method;
  }) => Fx<Started>;
  readonly attach: (input: {
    readonly connectionId: string;
    readonly domain: string;
    readonly zone?: string;
  }) => Fx<Started>;
  readonly detach: (attachmentId: string) => Fx<void>;
  readonly disconnect: (connectionId: string) => Fx<void>;
}

export interface ProvisioningGroup {
  readonly plan: (input: {
    readonly domain: string;
    readonly requirements: ReadonlyArray<DnsRecord.DnsRecord>;
  }) => Fx<Plan.Plan>;
  readonly approve: (input: {
    readonly planId: Plan.PlanId;
    readonly operationIds?: ReadonlyArray<Plan.OperationId>;
  }) => Fx<Approval.Approval>;
  readonly apply: (approvalId: Approval.ApprovalId) => Fx<Receipt.Receipt>;
  /** The stored plan, its approval, and its receipt, for rendering a flow the customer left. */
  readonly attempt: (planId: Plan.PlanId) => Fx<Attempt>;
}

export interface VerificationGroup {
  readonly observe: (domain: string) => Fx<Readiness>;
}

export interface CleanupGroup {
  readonly plan: (receiptId: Receipt.ReceiptId) => Fx<Plan.Plan>;
  readonly approve: (input: {
    readonly planId: Plan.PlanId;
    readonly operationIds?: ReadonlyArray<Plan.OperationId>;
  }) => Fx<Approval.Approval>;
  readonly apply: (approvalId: Approval.ApprovalId) => Fx<Receipt.Receipt>;
}

export interface Transport {
  readonly connection?: ConnectionGroup;
  readonly provisioning?: ProvisioningGroup;
  readonly verification?: VerificationGroup;
  readonly cleanup?: CleanupGroup;
}

export type Capability = keyof Transport;

export const allCapabilities: ReadonlyArray<Capability> = [
  "connection",
  "provisioning",
  "verification",
  "cleanup",
];

/** Which groups this transport actually carries, in declaration order. */
export const capabilities = (transport: Transport): ReadonlyArray<Capability> =>
  allCapabilities.filter((capability) => transport[capability] !== undefined);

export interface FetchOptions {
  readonly fetch?: Http.Fetch;
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  /** Which groups the server exposes. Default: all. */
  readonly capabilities?: ReadonlyArray<Capability>;
}

// ---------------------------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------------------------

/** A transport over `domainkit/server` routes mounted at `baseUrl`. */
export const fromFetch = (baseUrl: string, options: FetchOptions = {}): Transport => {
  const base = baseUrl.replace(/\/+$/, "");
  const source = safeOrigin(base);
  const call = options.fetch ?? globalThis.fetch;
  const declared = options.capabilities ?? allCapabilities;

  const request = <A>(input: {
    readonly method: "GET" | "POST" | "DELETE";
    readonly path: string;
    readonly body?: unknown;
    readonly success: Schema.Codec<A, unknown> | null;
  }): Fx<A> =>
    Effect.gen(function* () {
      const headers = yield* Http.headersFrom(options.headers);
      if (input.body !== undefined) headers.set("content-type", "application/json");
      const reply = yield* Http.requestJson({
        fetch: call,
        provider: source,
        url: `${base}${input.path}`,
        init: {
          method: input.method,
          headers,
          ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        },
      });
      if (!reply.ok) {
        // The server answers failures with the `DomainKitError` value itself. Anything else came
        // from in front of it: a proxy, a login page, a maintenance window.
        const decoded = yield* Effect.result(
          DomainKitError.decode(DomainKitError.DomainKitError, reply.body, "response"),
        );
        return yield* decoded._tag === "Success"
          ? Effect.fail(decoded.success)
          : Effect.fail(
              new DomainKitError.DomainKitError({
                reason: Http.classify(
                  source,
                  reply.status,
                  reply.headers,
                  `${input.method} ${input.path} answered ${reply.status}`,
                ),
              }),
            );
      }
      if (input.success === null) return undefined as A;
      return yield* DomainKitError.decode(input.success, reply.body, "response");
    });

  /** Provisioning and cleanup approve and apply through the same routes; the attempt knows its kind. */
  const approve = (input: {
    readonly planId: Plan.PlanId;
    readonly operationIds?: ReadonlyArray<Plan.OperationId>;
  }) =>
    request({
      method: "POST",
      path: `/plans/${encodeURIComponent(input.planId)}/approvals`,
      body: Schema.encodeSync(Server.ApprovePayload)(
        input.operationIds === undefined ? {} : { operationIds: input.operationIds },
      ),
      success: Approval.Approval,
    });

  const apply = (approvalId: Approval.ApprovalId) =>
    request({
      method: "POST",
      path: `/approvals/${encodeURIComponent(approvalId)}/apply`,
      success: Receipt.Receipt,
    });

  const connection: ConnectionGroup = {
    inspect: (domain) =>
      request({
        method: "GET",
        path: `/domains/${encodeURIComponent(domain)}`,
        success: Server.Snapshot,
      }),
    start: (input) =>
      request({
        method: "POST",
        path: "/connections",
        body: Schema.encodeSync(Server.StartPayload)(input),
        success: Server.Started,
      }),
    attach: (input) =>
      request({
        method: "POST",
        path: `/connections/${encodeURIComponent(input.connectionId)}/attachments`,
        body: Schema.encodeSync(Server.AttachPayload)(
          input.zone === undefined
            ? { domain: input.domain }
            : { domain: input.domain, zone: input.zone },
        ),
        success: Server.Started,
      }),
    detach: (attachmentId) =>
      request({
        method: "DELETE",
        path: `/attachments/${encodeURIComponent(attachmentId)}`,
        success: null,
      }),
    disconnect: (connectionId) =>
      request({
        method: "DELETE",
        path: `/connections/${encodeURIComponent(connectionId)}`,
        success: null,
      }),
  };

  const provisioning: ProvisioningGroup = {
    plan: (input) =>
      request({
        method: "POST",
        path: `/domains/${encodeURIComponent(input.domain)}/plans`,
        body: Schema.encodeSync(Server.PlanPayload)({ requirements: input.requirements }),
        success: Plan.Plan,
      }),
    approve,
    apply,
    attempt: (planId) =>
      request({
        method: "GET",
        path: `/plans/${encodeURIComponent(planId)}`,
        success: Server.Attempt,
      }),
  };

  const verification: VerificationGroup = {
    observe: (domain) =>
      request({
        method: "POST",
        path: `/domains/${encodeURIComponent(domain)}/observations`,
        success: Server.Readiness,
      }),
  };

  const cleanup: CleanupGroup = {
    plan: (receiptId) =>
      request({
        method: "POST",
        path: `/receipts/${encodeURIComponent(receiptId)}/cleanup-plans`,
        success: Plan.Plan,
      }),
    approve,
    apply,
  };

  const groups = { connection, provisioning, verification, cleanup };
  return Object.fromEntries(
    allCapabilities
      .filter((capability) => declared.includes(capability))
      .map((capability) => [capability, groups[capability]]),
  );
};

// ---------------------------------------------------------------------------------------------
// Promise adapters
// ---------------------------------------------------------------------------------------------

/** The same transport in Promises, for hosts and tests that do not run Effect. */
export type AsyncTransport = {
  readonly [K in keyof Transport]?: {
    readonly [M in keyof NonNullable<Transport[K]>]: NonNullable<Transport[K]>[M] extends (
      ...args: infer A
    ) => Effect.Effect<infer R, DomainKitError.DomainKitError>
      ? (...args: A) => Promise<R>
      : never;
  };
};

/** Adapt a Promise-shaped transport; a rejection that is not a `DomainKitError` becomes one. */
export const fromAsync = (transport: AsyncTransport): Transport =>
  mapGroups(
    transport,
    (method) =>
      (...args: ReadonlyArray<never>) =>
        Effect.tryPromise({
          try: () => method(...args) as Promise<unknown>,
          catch: (cause) =>
            DomainKitError.isDomainKitError(cause)
              ? cause
              : new DomainKitError.DomainKitError({
                  reason: new DomainKitError.ProviderUnavailable({
                    provider: "domainkit",
                    message: `The transport rejected: ${String(cause)}`,
                  }),
                }),
        }),
  ) as Transport;

/** Adapt to Promises; every rejection is the `DomainKitError` the lifecycle raised. */
export const toAsync = (transport: Transport): AsyncTransport =>
  mapGroups(
    transport,
    (method) =>
      (...args: ReadonlyArray<never>) =>
        Effect.runPromise(method(...args) as Effect.Effect<unknown, DomainKitError.DomainKitError>),
  ) as AsyncTransport;

type AnyMethod = (...args: ReadonlyArray<never>) => unknown;
type AnyGroups = { readonly [key: string]: Record<string, AnyMethod> | undefined };

/** Rebuild every declared group with each method wrapped; the two adapters differ only in `wrap`. */
const mapGroups = (source: object, wrap: (method: AnyMethod) => AnyMethod): unknown =>
  Object.fromEntries(
    allCapabilities.flatMap((capability) => {
      const group = (source as AnyGroups)[capability];
      if (group === undefined) return [];
      return [
        [
          capability,
          Object.fromEntries(Object.entries(group).map(([name, method]) => [name, wrap(method)])),
        ],
      ];
    }),
  );

// ---------------------------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------------------------

const safeOrigin = (base: string): string => {
  try {
    return new URL(base).origin;
  } catch {
    return base === "" ? "domainkit" : base;
  }
};
