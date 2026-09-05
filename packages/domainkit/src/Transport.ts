/**
 * domainkit/client — the browser-side transport `@domainkit/react` consumes. Capability groups are
 * optional: a host that only exposes connection routes declares just `connection`, and the parts
 * of the UI that plan or clean up do not render.
 *
 *   const transport = Transport.fromFetch("/api/domainkit")
 *
 * Every method decodes the same wire schemas `domainkit/server` encodes, so a failure arrives as
 * the `DomainKit.Error` the lifecycle raised, reason intact.
 */
import { Effect, Schema } from "effect";

import * as Approval from "./Approval.ts";
import type * as DnsRecord from "./DnsRecord.ts";
import * as Errors from "./internal/error.ts";
import * as Http from "./internal/http.ts";
import * as Plan from "./Plan.ts";
import * as Reason from "./Reason.ts";
import * as Receipt from "./Receipt.ts";
import * as Server from "./Server.ts";

type Fx<A> = Effect.Effect<A, Errors.DomainKitError>;

export type Snapshot = Server.Snapshot;
export type Started = Server.Started;
export type Readiness = Server.Readiness;
export type Attempt = Server.Attempt;
export type Candidate = Server.Candidate;
export type Discovery = Server.Discovery;
export type Zone = Server.Zone;
export type Zones = Server.Zones;
export type Attachment = Server.Attachment;
export type Field = Server.Field;
export type MethodDescriptor = Server.MethodDescriptor;
export type Method = Server.Method;

/** How a client asks to connect. Mirrors `Connect.Method`, over the wire. */
export const Method = {
  /** A lone string for the common one-field provider, or the values its descriptor names. */
  token: (values: string | Readonly<Record<string, string>>): Method =>
    new Server.Token({ values: typeof values === "string" ? { token: values } : values }),
  oauth: (options: { readonly returnTo?: string } = {}): Method => new Server.OAuth(options),
  integration: (options: { readonly returnTo?: string } = {}): Method =>
    new Server.Integration(options),
} as const;

export interface ConnectionGroup {
  readonly inspect: (domain: string) => Fx<Snapshot>;
  /** Which of this owner's existing connections already reaches the domain. */
  readonly discover: (domain: string) => Fx<Discovery>;
  /** Every zone this owner's connections reach, and where each connection stands. */
  readonly zones: (options?: { readonly provider?: string }) => Fx<Zones>;
  /** Connect a provider. Without a domain the account connects alone and attaches nothing. */
  readonly start: (input: {
    readonly domain?: string;
    readonly provider: string;
    readonly method: Method;
  }) => Fx<Started>;
  /** Prove an account again for a connection this owner holds, keeping its domains. */
  readonly reconnect: (input: {
    readonly connectionId: string;
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
    readonly requirements: ReadonlyArray<DnsRecord.Model>;
  }) => Fx<Plan.Model>;
  readonly approve: (input: {
    readonly planId: Plan.PlanId;
    readonly operationIds?: ReadonlyArray<Plan.OperationId>;
  }) => Fx<Approval.Model>;
  /** Decline the plan; terminal, and approving it afterwards fails `Stale`. */
  readonly reject: (input: {
    readonly planId: Plan.PlanId;
    readonly reason?: string;
  }) => Fx<Attempt>;
  readonly apply: (approvalId: Approval.ApprovalId) => Fx<Receipt.Model>;
  /** The stored plan with its status, approval, receipt, and rejection. */
  readonly attempt: (planId: Plan.PlanId) => Fx<Attempt>;
  /** What one apply landed, by receipt id, for a surface that holds the id and not the attempt. */
  readonly receipt: (receiptId: Receipt.ReceiptId) => Fx<Receipt.Model>;
}

export interface VerificationGroup {
  /**
   * Observe the domain's provisioning receipt, or `options.requirements` when supplied (required
   * for a domain with no attachment).
   */
  readonly observe: (
    domain: string,
    options?: { readonly requirements?: ReadonlyArray<DnsRecord.Model> },
  ) => Fx<Readiness>;
}

export interface CleanupGroup {
  readonly plan: (receiptId: Receipt.ReceiptId) => Fx<Plan.Model>;
  readonly approve: (input: {
    readonly planId: Plan.PlanId;
    readonly operationIds?: ReadonlyArray<Plan.OperationId>;
  }) => Fx<Approval.Model>;
  readonly reject: (input: {
    readonly planId: Plan.PlanId;
    readonly reason?: string;
  }) => Fx<Attempt>;
  readonly apply: (approvalId: Approval.ApprovalId) => Fx<Receipt.Model>;
}

export interface Interface {
  readonly connection?: ConnectionGroup;
  readonly provisioning?: ProvisioningGroup;
  readonly verification?: VerificationGroup;
  readonly cleanup?: CleanupGroup;
}

export type Capability = keyof Interface;

export const allCapabilities: ReadonlyArray<Capability> = [
  "connection",
  "provisioning",
  "verification",
  "cleanup",
];

/** Which groups this transport actually carries, in declaration order. */
export const capabilities = (transport: Interface): ReadonlyArray<Capability> =>
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
export const fromFetch = (baseUrl: string, options: FetchOptions = {}): Interface => {
  const base = baseUrl.replace(/\/+$/, "");
  const source = safeOrigin(base);
  // Resolved at call time and invoked as a free function: a browser `fetch` throws "Illegal
  // invocation" when called as a method of anything but `window`, and a host may polyfill later.
  const call: Http.Fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
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
        // The server answers failures with the `DomainKit.Error` value itself. Anything else came
        // from in front of it: a proxy, a login page, a maintenance window.
        const decoded = yield* Effect.result(
          Errors.decode(Errors.DomainKitError, reply.body, "response"),
        );
        return yield* decoded._tag === "Success"
          ? Effect.fail(decoded.success)
          : Effect.fail(
              new Errors.DomainKitError({
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
      return yield* Errors.decode(input.success, reply.body, "response");
    });

  /** Provisioning and cleanup share these routes; the attempt knows its kind. */
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
      success: Approval.Model,
    });

  const reject = (input: { readonly planId: Plan.PlanId; readonly reason?: string }) =>
    request({
      method: "POST",
      path: `/plans/${encodeURIComponent(input.planId)}/rejections`,
      body: Schema.encodeSync(Server.RejectPayload)(
        input.reason === undefined ? {} : { reason: input.reason },
      ),
      success: Server.Attempt,
    });

  const apply = (approvalId: Approval.ApprovalId) =>
    request({
      method: "POST",
      path: `/approvals/${encodeURIComponent(approvalId)}/apply`,
      success: Receipt.Model,
    });

  const connection: ConnectionGroup = {
    inspect: (domain) =>
      request({
        method: "GET",
        path: `/domains/${encodeURIComponent(domain)}`,
        success: Server.Snapshot,
      }),
    discover: (domain) =>
      request({
        method: "GET",
        path: `/domains/${encodeURIComponent(domain)}/discovery`,
        success: Server.Discovery,
      }),
    zones: (filter) =>
      request({
        method: "GET",
        path:
          filter?.provider === undefined
            ? "/zones"
            : `/zones?provider=${encodeURIComponent(filter.provider)}`,
        success: Server.Zones,
      }),
    start: (input) =>
      request({
        method: "POST",
        path: "/connections",
        body: Schema.encodeSync(Server.StartPayload)(
          input.domain === undefined
            ? { provider: input.provider, method: input.method }
            : { domain: input.domain, provider: input.provider, method: input.method },
        ),
        success: Server.Started,
      }),
    reconnect: (input) =>
      request({
        method: "POST",
        path: `/connections/${encodeURIComponent(input.connectionId)}/reconnections`,
        body: Schema.encodeSync(Server.ReconnectPayload)({ method: input.method }),
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
        success: Plan.Model,
      }),
    approve,
    reject,
    apply,
    attempt: (planId) =>
      request({
        method: "GET",
        path: `/plans/${encodeURIComponent(planId)}`,
        success: Server.Attempt,
      }),
    receipt: (receiptId) =>
      request({
        method: "GET",
        path: `/receipts/${encodeURIComponent(receiptId)}`,
        success: Receipt.Model,
      }),
  };

  const verification: VerificationGroup = {
    observe: (domain, input) =>
      request({
        method: "POST",
        path: `/domains/${encodeURIComponent(domain)}/observations`,
        body: Schema.encodeSync(Server.ObservePayload)(
          input?.requirements === undefined ? {} : { requirements: input.requirements },
        ),
        success: Server.Readiness,
      }),
  };

  const cleanup: CleanupGroup = {
    plan: (receiptId) =>
      request({
        method: "POST",
        path: `/receipts/${encodeURIComponent(receiptId)}/cleanup-plans`,
        success: Plan.Model,
      }),
    approve,
    reject,
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
  readonly [K in keyof Interface]?: {
    readonly [M in keyof NonNullable<Interface[K]>]: NonNullable<Interface[K]>[M] extends (
      ...args: infer A
    ) => Effect.Effect<infer R, Errors.DomainKitError>
      ? (...args: A) => Promise<R>
      : never;
  };
};

/** Adapt a Promise-shaped transport; a rejection that is not a `DomainKit.Error` becomes one. */
export const fromAsync = (transport: AsyncTransport): Interface =>
  mapGroups(
    transport,
    (method) =>
      (...args: ReadonlyArray<never>) =>
        Effect.tryPromise({
          try: () => method(...args) as Promise<unknown>,
          catch: (cause) =>
            Errors.isDomainKitError(cause)
              ? cause
              : new Errors.DomainKitError({
                  reason: new Reason.ProviderUnavailable({
                    provider: "domainkit",
                    message: `The transport rejected: ${String(cause)}`,
                  }),
                }),
        }),
  ) as Interface;

/** Adapt to Promises; every rejection is the `DomainKit.Error` the lifecycle raised. */
export const toAsync = (transport: Interface): AsyncTransport =>
  mapGroups(
    transport,
    (method) =>
      (...args: ReadonlyArray<never>) =>
        Effect.runPromise(method(...args) as Effect.Effect<unknown, Errors.DomainKitError>),
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
