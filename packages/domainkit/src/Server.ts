/**
 * domainkit/server — the whole lifecycle as one HttpApi group the host mounts.
 *
 *   const Api = HttpApi.make("app").add(Server.group)
 *   const ApiLive = HttpApiBuilder.layer(Api).pipe(
 *     Layer.provide([Server.layer(Api), DomainKitLive, IdentityLive]),
 *   )
 *
 * The host provides `Identity` (request -> `Principal.Interface`). Everything else comes from
 * `DomainKit.layer`. Non-HttpApi hosts use `toWebHandler`. The group carries no prefix of its
 * own, so `group.prefix("/internal/dns")` or a host router mount is all a different base path
 * takes; callback URLs follow the mount.
 */
import { Context, Effect, Layer, Option, Schema } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";

import * as Approval from "./Approval.ts";
import * as Cleanup from "./Cleanup.ts";
import * as Connect from "./Connect.ts";
import * as DnsRecord from "./DnsRecord.ts";
import * as Errors from "./internal/error.ts";
import * as Plan from "./Plan.ts";
import * as Principal from "./Principal.ts";
import * as Providers from "./Providers.ts";
import * as Provision from "./Provision.ts";
import * as Reason from "./Reason.ts";
import * as Receipt from "./Receipt.ts";
import * as Storage from "./Storage.ts";
import * as Verify from "./Verify.ts";

/**
 * What DomainKit already knows about the request when it asks the host who is making it. Only
 * `/callback/:provider` passes one, because it is the only route that points at a flow DomainKit
 * recorded earlier; every other route calls `principal` with the request alone.
 */
export interface IdentityContext {
  /** The route being served. */
  readonly endpoint: EndpointName;
  /** The flow this callback claims to finish, as DomainKit recorded it when the flow started. */
  readonly continuation: Storage.ContinuationHeader;
}

/** The only service a host must implement for the server. */
export interface IdentityService {
  /**
   * `context` is present only on the callback, where a host that keeps per-request tenancy can use
   * `context.continuation.ownerId` to pick the right tenant out of a session that holds several.
   * Ignoring it is safe everywhere: DomainKit checks the principal against the recorded flow on
   * that route regardless, so a host that answers with the wrong one is refused rather than
   * trusted.
   */
  readonly principal: (
    request: HttpServerRequest.HttpServerRequest,
    context?: IdentityContext,
  ) => Effect.Effect<Principal.Interface, Errors.DomainKitError>;
  /**
   * Which routes this principal may reach, checked after `principal` on every request. Fail with
   * reason `Forbidden` for the 403 a UI expects. Without it every authenticated principal reaches
   * every route, which is the right default for a host whose own middleware already gates the
   * mount.
   */
  readonly authorize?: (
    principal: Principal.Interface,
    endpoint: EndpointName,
  ) => Effect.Effect<void, Errors.DomainKitError>;
}

export class Identity extends Context.Service<Identity, IdentityService>()(
  "@domainkit/server/Identity",
) {}

// ---------------------------------------------------------------------------------------------
// Wire schemas (the transport contract `domainkit/client` and `@domainkit/react` consume)
// ---------------------------------------------------------------------------------------------

export const ConnectionStatus = Schema.Literals(["disconnected", "connected", "reconnect"]);
export type ConnectionStatus = typeof ConnectionStatus.Type;

/** One value a token method needs, so a form renders without knowing the provider. */
export const Field = Schema.Struct({
  name: Schema.String,
  required: Schema.Boolean,
  secret: Schema.Boolean,
});
export type Field = typeof Field.Type;

/** How a provider can be connected; `fields` is `null` for the interactive methods. */
export const MethodDescriptor = Schema.Struct({
  kind: Storage.AuthMethod,
  label: Schema.String,
  docsUrl: Schema.NullOr(Schema.String),
  fields: Schema.NullOr(Schema.Array(Field)),
});
export type MethodDescriptor = typeof MethodDescriptor.Type;

/** Everything the UI needs about a domain, flattened; provider context never crosses the wire. */
/** The attachment a domain holds, with the zone label the provider gave when it was created. */
export const Attachment = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
});
export type Attachment = typeof Attachment.Type;

export const Snapshot = Schema.Struct({
  domain: Schema.String,
  attachment: Schema.NullOr(Attachment),
  connectionId: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  method: Schema.NullOr(Storage.AuthMethod),
  status: ConnectionStatus,
  lastReceiptId: Schema.NullOr(Schema.String),
  /** How many domains the connection serves, including this one; `0` without a connection. */
  connectionDomains: Schema.Number,
  reusable: Schema.Array(
    Schema.Struct({
      connectionId: Schema.String,
      provider: Schema.String,
      method: Storage.AuthMethod,
    }),
  ),
  providers: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      methods: Schema.Array(MethodDescriptor),
    }),
  ),
});
export type Snapshot = typeof Snapshot.Type;

/**
 * How the client asks to connect. `values` is keyed by the provider's declared token fields, as
 * `Snapshot.providers[].methods[].fields` names them. Secrets are plaintext in transit and never
 * come back out.
 */
export class Token extends Schema.TaggedClass<Token>("@domainkit/server/Method/Token")("Token", {
  values: Schema.Record(Schema.String, Schema.String),
}) {}
export class OAuth extends Schema.TaggedClass<OAuth>("@domainkit/server/Method/OAuth")("OAuth", {
  returnTo: Schema.optionalKey(Schema.String),
}) {}
export class Integration extends Schema.TaggedClass<Integration>(
  "@domainkit/server/Method/Integration",
)("Integration", { returnTo: Schema.optionalKey(Schema.String) }) {}
export const Method = Schema.Union([Token, OAuth, Integration]);
export type Method = typeof Method.Type;

/** A start without a domain connects the account alone; the customer picks a zone afterwards. */
export const StartPayload = Schema.Struct({
  domain: Schema.optionalKey(Schema.String),
  provider: Schema.String,
  method: Method,
});
export type StartPayload = typeof StartPayload.Type;

/** How the customer proves the account again. The provider is the connection's own. */
export const ReconnectPayload = Schema.Struct({ method: Method });
export type ReconnectPayload = typeof ReconnectPayload.Type;

/** A zone the connection can serve, named for a customer to pick from. */
export class Candidate extends Schema.Class<Candidate>("@domainkit/server/Candidate")({
  zone: Schema.String,
  label: Schema.String,
}) {}

/**
 * The connection the start produced. `label` names the account the way the customer will read it:
 * the attached zone's label, or the provider's name when the start carried no domain. `snapshot`
 * is the domain's state, and is null for a start that attached none.
 */
export class Connected extends Schema.TaggedClass<Connected>("@domainkit/server/Started/Connected")(
  "Connected",
  {
    connectionId: Schema.String,
    provider: Schema.String,
    label: Schema.String,
    snapshot: Schema.NullOr(Snapshot),
  },
) {}
export class Redirect extends Schema.TaggedClass<Redirect>("@domainkit/server/Started/Redirect")(
  "Redirect",
  { authorizationUrl: Schema.String },
) {}
export class SelectionRequired extends Schema.TaggedClass<SelectionRequired>(
  "@domainkit/server/Started/SelectionRequired",
)("SelectionRequired", { connectionId: Schema.String, candidates: Schema.Array(Candidate) }) {}
export const Started = Schema.Union([Connected, Redirect, SelectionRequired]);
export type Started = typeof Started.Type;

/**
 * Which of the principal's connections already reaches a domain. The class names carry a
 * `Discovery` prefix because `Started` owns the unprefixed `SelectionRequired`; the wire tags are
 * the ones `Connect.Discovery` uses.
 */
export class DiscoveryResolved extends Schema.TaggedClass<DiscoveryResolved>(
  "@domainkit/server/Discovery/Resolved",
)("Resolved", { connectionId: Schema.String, zone: Schema.String, label: Schema.String }) {}
export class DiscoverySelectionRequired extends Schema.TaggedClass<DiscoverySelectionRequired>(
  "@domainkit/server/Discovery/SelectionRequired",
)("SelectionRequired", {
  candidates: Schema.Array(
    Schema.Struct({ connectionId: Schema.String, zone: Schema.String, label: Schema.String }),
  ),
}) {}
/** `host` names the registered provider whose nameservers serve the domain, by definition id. */
export class DiscoveryNotFound extends Schema.TaggedClass<DiscoveryNotFound>(
  "@domainkit/server/Discovery/NotFound",
)("NotFound", {
  nameservers: Schema.Array(Schema.String),
  host: Schema.NullOr(Schema.Struct({ provider: Schema.String })),
}) {}
export const Discovery = Schema.Union([
  DiscoveryResolved,
  DiscoverySelectionRequired,
  DiscoveryNotFound,
]);
export type Discovery = typeof Discovery.Type;

/** One zone a connection reaches, named for a customer to pick from. */
export const Zone = Schema.Struct({
  connectionId: Schema.String,
  provider: Schema.String,
  zone: Schema.String,
  label: Schema.String,
  nameservers: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type Zone = typeof Zone.Type;

/**
 * Every zone the principal's connections reach, and where each connection stands. A connection
 * marked `reconnect` contributes no zones and needs the customer to authorize it again.
 */
export const Zones = Schema.Struct({
  zones: Schema.Array(Zone),
  connections: Schema.Array(
    Schema.Struct({
      connectionId: Schema.String,
      provider: Schema.String,
      /** What the provider called the account at connect time; `null` when it named none. */
      label: Schema.NullOr(Schema.String),
      status: ConnectionStatus,
    }),
  ),
  /** Every provider a customer could connect, so a picker offers one without a second call. */
  providers: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      methods: Schema.Array(MethodDescriptor),
    }),
  ),
});
export type Zones = typeof Zones.Type;

export const AttachPayload = Schema.Struct({
  domain: Schema.String,
  /** Which candidate zone to attach when `SelectionRequired` came back. */
  zone: Schema.optionalKey(Schema.String),
});
export type AttachPayload = typeof AttachPayload.Type;

export const PlanPayload = Schema.Struct({
  requirements: Schema.Array(DnsRecord.Model),
});
export type PlanPayload = typeof PlanPayload.Type;

export const ObservePayload = Schema.Struct({
  /** Records to observe instead of the attachment's receipt; required for an unattached domain. */
  requirements: Schema.optionalKey(Schema.Array(DnsRecord.Model)),
});
export type ObservePayload = typeof ObservePayload.Type;

export const ApprovePayload = Schema.Struct({
  /** A subset of the plan's writes; omit to approve every write. */
  operationIds: Schema.optionalKey(Schema.Array(Plan.OperationId)),
});
export type ApprovePayload = typeof ApprovePayload.Type;

export const RejectPayload = Schema.Struct({
  /** Why the customer declined, for the audit trail. */
  reason: Schema.optionalKey(Schema.String),
});
export type RejectPayload = typeof RejectPayload.Type;

/** One durable plan -> approval -> receipt lifecycle, as `GET /plans/:planId` returns it. */
export const Attempt = Schema.Struct({
  plan: Plan.Model,
  status: Storage.AttemptStatus,
  approval: Schema.NullOr(Approval.Model),
  receipt: Schema.NullOr(Receipt.Model),
  rejection: Schema.NullOr(Storage.Rejection),
});
export type Attempt = typeof Attempt.Type;

/** What a batch's create and resume routes take: one domain and its requirements per item. */
export const BatchPayload = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({ domain: Schema.String, requirements: Schema.Array(DnsRecord.Model) }),
  ),
});
export type BatchPayload = typeof BatchPayload.Type;

/** The digest the principal read, which the batch's current plans must still produce. */
export const BatchApprovePayload = Schema.Struct({ digest: Plan.Digest });
export type BatchApprovePayload = typeof BatchApprovePayload.Type;

/** One domain's place in a batch, with whatever its attempt holds. */
export const BatchItem = Schema.Struct({
  attachmentId: Schema.String,
  position: Schema.Number,
  /** Null while the item has no plan; `planFailure` then says why. */
  plan: Schema.NullOr(Plan.Model),
  status: Schema.NullOr(Storage.AttemptStatus),
  approval: Schema.NullOr(Approval.Model),
  receipt: Schema.NullOr(Receipt.Model),
  rejection: Schema.NullOr(Storage.Rejection),
  failure: Schema.NullOr(Schema.String),
  planFailure: Schema.NullOr(Schema.String),
});
export type BatchItem = typeof BatchItem.Type;

/** Many domains planned together, as every batch route returns them. */
export const Batch = Schema.Struct({
  id: Storage.BatchId,
  status: Storage.BatchStatus,
  /** What `POST /batches/:batchId/approvals` takes; null while any item is unplanned. */
  digest: Schema.NullOr(Plan.Digest),
  approval: Schema.NullOr(Storage.BatchApproval),
  rejection: Schema.NullOr(Storage.Rejection),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  completedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  items: Schema.Array(BatchItem),
});
export type Batch = typeof Batch.Type;

/** A batch without its plans, as the unfinished index returns them. */
export const BatchSummary = Schema.Struct({
  id: Storage.BatchId,
  status: Storage.BatchStatus,
  itemCount: Schema.Number,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  completedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type BatchSummary = typeof BatchSummary.Type;

/** `Verify.Readiness` on the wire; timestamps encode as ISO strings. */
export const Readiness = Schema.Struct({
  domain: Schema.String,
  attachmentId: Schema.NullOr(Schema.String),
  overall: Storage.Overall,
  requirements: Schema.Array(
    Schema.Struct({
      /** `Verify.requirementKey(record)`, so a client pairs rows by content, not by position. */
      key: Schema.String,
      operationId: Schema.NullOr(Plan.OperationId),
      record: DnsRecord.Model,
      status: Storage.RequirementStatus,
      evidence: Schema.Array(Verify.Evidence),
    }),
  ),
  host: Schema.Array(Verify.HostEvidence),
  checkedAt: Schema.DateTimeUtcFromString,
  nextCheckAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type Readiness = typeof Readiness.Type;

const Redirected = HttpApiSchema.WithHeaders(HttpApiSchema.Empty(302), {
  location: Schema.String,
});

// ---------------------------------------------------------------------------------------------
// Errors: one wire body, the status from `DomainKit.Error.httpStatus`
// ---------------------------------------------------------------------------------------------

/** `DomainKit.Error` narrowed to the reasons that answer with `status`. */
const errorAt = (status: number) =>
  Errors.DomainKitError.check(
    Schema.makeFilter((error: Errors.DomainKitError) => error.httpStatus === status),
  ).pipe(HttpApiSchema.status(status));

const errors = [400, 401, 403, 404, 409, 500, 501, 502, 503].map(errorAt);

// ---------------------------------------------------------------------------------------------
// The group
// ---------------------------------------------------------------------------------------------

export const group = HttpApiGroup.make("domainkit")
  .add(
    HttpApiEndpoint.get("inspect", "/domains/:domain", {
      params: { domain: Schema.String },
      success: Snapshot,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("discover", "/domains/:domain/discovery", {
      params: { domain: Schema.String },
      success: Discovery,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("zones", "/zones", {
      query: { provider: Schema.optionalKey(Schema.String) },
      success: Zones,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("start", "/connections", {
      payload: StartPayload,
      success: Started,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("callback", "/callback/:provider", {
      params: { provider: Schema.String },
      // `Connect.complete` reads every callback parameter off the request URL, because a provider
      // may return `error`, `teamId`, or `configurationId` too. These two are declared so the
      // OpenAPI document names what a provider is expected to send back.
      query: { state: Schema.String, code: Schema.optionalKey(Schema.String) },
      success: Redirected,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("reconnect", "/connections/:connectionId/reconnections", {
      params: { connectionId: Schema.String },
      payload: ReconnectPayload,
      success: Started,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("attach", "/connections/:connectionId/attachments", {
      params: { connectionId: Schema.String },
      payload: AttachPayload,
      success: Started,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("detach", "/attachments/:attachmentId", {
      params: { attachmentId: Schema.String },
      success: Schema.Void,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("disconnect", "/connections/:connectionId", {
      params: { connectionId: Schema.String },
      success: Schema.Void,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("createPlan", "/domains/:domain/plans", {
      params: { domain: Schema.String },
      payload: PlanPayload,
      success: Plan.Model,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("approve", "/plans/:planId/approvals", {
      params: { planId: Plan.PlanId },
      payload: ApprovePayload,
      success: Approval.Model,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("reject", "/plans/:planId/rejections", {
      params: { planId: Plan.PlanId },
      payload: RejectPayload,
      success: Attempt,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("apply", "/approvals/:approvalId/apply", {
      params: { approvalId: Approval.ApprovalId },
      success: Receipt.Model,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("plan", "/plans/:planId", {
      params: { planId: Plan.PlanId },
      success: Attempt,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("receipt", "/receipts/:receiptId", {
      params: { receiptId: Receipt.ReceiptId },
      success: Receipt.Model,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("observe", "/domains/:domain/observations", {
      params: { domain: Schema.String },
      payload: ObservePayload,
      success: Readiness,
      error: errors,
    }),
  )
  .add(
    // The stored observation, or `null` when nothing has been observed for the domain yet. A
    // domain with no readiness is not a missing route, so it answers 200 with a null body and
    // leaves 404 to name a domain this owner cannot reach.
    HttpApiEndpoint.get("readiness", "/domains/:domain/readiness", {
      params: { domain: Schema.String },
      success: Schema.NullOr(Readiness),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("cleanupPlan", "/receipts/:receiptId/cleanup-plans", {
      params: { receiptId: Receipt.ReceiptId },
      success: Plan.Model,
      error: errors,
    }),
  )
  .add(
    // `Idempotency-Key` is the batch's identity for this owner: a retried create answers with the
    // batch the first call made rather than planning the same domains twice.
    HttpApiEndpoint.post("createBatch", "/batches", {
      headers: { "idempotency-key": Schema.String },
      payload: BatchPayload,
      success: Batch,
      error: errors,
    }),
  )
  .add(
    // The one listing there is: what this owner still owes a move on. A finished batch is read by
    // its own id.
    HttpApiEndpoint.get("batches", "/batches", {
      query: { unfinished: Schema.Literal("true") },
      success: Schema.Array(BatchSummary),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("batch", "/batches/:batchId", {
      params: { batchId: Storage.BatchId },
      success: Batch,
      error: errors,
    }),
  )
  .add(
    // Plan the items that still have none. The batch stores pointers, not requirements, so the
    // host supplies them again.
    HttpApiEndpoint.post("planBatch", "/batches/:batchId/plans", {
      params: { batchId: Storage.BatchId },
      payload: BatchPayload,
      success: Batch,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("approveBatch", "/batches/:batchId/approvals", {
      params: { batchId: Storage.BatchId },
      payload: BatchApprovePayload,
      success: Batch,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("rejectBatch", "/batches/:batchId/rejections", {
      params: { batchId: Storage.BatchId },
      payload: RejectPayload,
      success: Batch,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("applyBatch", "/batches/:batchId/apply", {
      params: { batchId: Storage.BatchId },
      success: Batch,
      error: errors,
    }),
  );
// Cleanup approve, reject, and apply reuse those routes: the attempt knows its kind.

export type Group = typeof group;

/** Every route in the group, by name; what `Identity.authorize` is asked about. */
export type EndpointName = HttpApiGroup.Endpoints<Group>["identifier"];

export interface Options {
  /**
   * Where the callback route is reachable from the provider, without the `/callback/:provider`
   * suffix. Defaults to the incoming request's origin and mount path.
   */
  readonly callbackBaseUrl?: string;
  /** Where interactive flows return when the callback carries no `returnTo`. */
  readonly defaultReturnTo?: string;
}

/** Everything the handlers need: the lifecycle services, Storage, and the host's `Identity`. */
export type Services =
  | Provision.Service
  | Cleanup.Service
  | Connect.Service
  | Verify.Service
  | Providers.Service
  | Storage.Service
  | Identity;

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

const START_ROUTE = "/connections";
const reconnectRoute = (connectionId: string) =>
  `/connections/${encodeURIComponent(connectionId)}/reconnections`;
const callbackRoute = (provider: string) => `/callback/${encodeURIComponent(provider)}`;

const invalid = (message: string, field?: string) =>
  Errors.fail(new Reason.InvalidInput({ message, ...(field === undefined ? {} : { field }) }));

/** The request as an absolute URL: the web original when there is one, else scheme plus `Host`. */
const absoluteUrl = (
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<URL, Errors.DomainKitError> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(new URL(request.originalUrl));
    } catch {
      const url = HttpServerRequest.toURL(request);
      return Option.isNone(url)
        ? invalid("The request has no usable origin; set callbackBaseUrl", "callbackBaseUrl")
        : Effect.succeed(url.value);
    }
  });

/**
 * The absolute URL the provider redirects back to. `callbackBaseUrl` wins when the host set it,
 * because a proxy that rewrites `Host` leaves the request pointing at an origin the browser never
 * sees; otherwise it follows the prefix the group is mounted at, derived by stripping the handling
 * route's own path off the request.
 */
const callbackUrlFor = (input: {
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly provider: string;
  readonly options: Options;
  /** The path of the route serving this request, stripped to find the mount. */
  readonly route: string;
}): Effect.Effect<URL, Errors.DomainKitError> =>
  Effect.suspend(() => {
    const suffix = `/callback/${encodeURIComponent(input.provider)}`;
    const configured = input.options.callbackBaseUrl;
    if (configured !== undefined) {
      return Effect.try({
        try: () => new URL(`${configured.replace(/\/+$/, "")}${suffix}`),
        catch: () => callbackConfigurationError(`${configured} is not a URL`),
      });
    }
    return Effect.flatMap(absoluteUrl(input.request), (url) => {
      const path = url.pathname;
      if (!path.endsWith(input.route)) {
        return invalid(
          `The ${input.route} route is not mounted where it says; set callbackBaseUrl`,
          "callbackBaseUrl",
        );
      }
      return Effect.succeed(
        new URL(`${url.origin}${path.slice(0, path.length - input.route.length)}${suffix}`),
      );
    });
  });

/**
 * One refusal for every way a callback can fail to match a flow: no such `state`, one that has
 * expired, one presented at another provider's route, and one presented by a session that did not
 * start it. The text is constant on purpose — a caller holding a leaked `state` must not be able
 * to tell "no such flow" from "not your flow".
 */
const noSuchFlow = Errors.fail(
  new Reason.InvalidInput({
    message: "This callback does not match a connection you started",
    field: "state",
  }),
);

const callbackConfigurationError = (message: string) =>
  new Errors.DomainKitError({
    reason: new Reason.InvalidInput({ message, field: "callbackBaseUrl" }),
  });

/**
 * Where the callback may send the customer: a path under the callback's own base, or an absolute
 * URL on its origin. A destination that leaves the application is an open redirect, whoever
 * supplied it.
 */
const sameOrigin = (destination: string, callback: URL): string | null => {
  try {
    // Resolving against the callback is what makes this safe: the URL parser normalizes the forms
    // a browser would follow off-origin (`//host`, `/\host`, `\/host`, encoded hosts) into a real
    // origin, so comparing origins catches every one of them.
    const url = new URL(destination, callback);
    return url.origin === callback.origin ? url.toString() : null;
  } catch {
    return null;
  }
};

const snapshotOf = (snapshot: Connect.Snapshot): Snapshot => ({
  domain: snapshot.domain,
  attachment:
    snapshot.attachment === null
      ? null
      : { id: snapshot.attachment.id, label: snapshot.attachment.label },
  connectionId: snapshot.connection?.id ?? null,
  provider: snapshot.authorization?.provider ?? null,
  method: snapshot.authorization?.method ?? null,
  status:
    snapshot.connection === null
      ? "disconnected"
      : snapshot.authorization?.revocation === "active"
        ? "connected"
        : "reconnect",
  lastReceiptId: snapshot.lastReceiptId,
  connectionDomains: snapshot.connectionDomains,
  reusable: snapshot.reusable.map(({ connection, provider, method }) => ({
    connectionId: connection.id,
    provider,
    method,
  })),
  providers: snapshot.providers.map(({ id, name, methods }) => ({ id, name, methods })),
});

/** The wire method as `Connect` takes it; interactive cases carry the caller's return destination. */
const methodOf = (method: Method): Connect.Method => {
  switch (method._tag) {
    case "Token":
      return Connect.Method.token(method.values);
    case "OAuth":
      return Connect.Method.oauth(
        method.returnTo === undefined ? {} : { returnTo: method.returnTo },
      );
    case "Integration":
      return Connect.Method.integration(
        method.returnTo === undefined ? {} : { returnTo: method.returnTo },
      );
  }
};

const candidatesOf = (
  candidates: ReadonlyArray<{ readonly zone: string; readonly label: string }>,
): ReadonlyArray<Candidate> => candidates.map(({ zone, label }) => new Candidate({ zone, label }));

/**
 * Handlers for `group` inside the host's API. Every handler derives `Principal` from `Identity`
 * for the request it is serving and provides it to the lifecycle services.
 */
export const layer = <ApiId extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<ApiId, Groups>,
  options: Options = {},
): Layer.Layer<HttpApiGroup.Service<ApiId, "domainkit">, never, Services> =>
  // The host's API carries its own groups beside this one; only `"domainkit"` is implemented here,
  // and `HttpApiBuilder.group` needs the group's own endpoint types to check the handlers.
  HttpApiBuilder.group(api as unknown as HttpApi.HttpApi<ApiId, Group>, "domainkit", (handlers) =>
    Effect.gen(function* () {
      const identity = yield* Identity;
      const connect = yield* Connect.Service;
      const provision = yield* Provision.Service;
      const cleanup = yield* Cleanup.Service;
      const verify = yield* Verify.Service;
      const storage = yield* Storage.Service;
      const providers = yield* Providers.Service;

      /**
       * Run a lifecycle effect as the principal the host derives from this request, once the host
       * has allowed that principal onto this route.
       */
      const as = <A>(
        endpoint: EndpointName,
        request: HttpServerRequest.HttpServerRequest,
        effect: Effect.Effect<A, Errors.DomainKitError, Principal.Service>,
        context?: IdentityContext,
      ): Effect.Effect<A, Errors.DomainKitError> =>
        Effect.flatMap(identity.principal(request, context), (principal) =>
          Effect.flatMap(identity.authorize?.(principal, endpoint) ?? Effect.void, () =>
            Effect.provideService(effect, Principal.Service, principal),
          ),
        );

      const snapshot = (domain: string) => Effect.map(connect.inspect(domain), snapshotOf);

      const discovered = (discovery: Connect.Discovery): Discovery => {
        switch (discovery._tag) {
          case "Resolved":
            return new DiscoveryResolved({
              connectionId: discovery.connectionId,
              zone: discovery.target.zone,
              label: discovery.target.label,
            });
          case "SelectionRequired":
            return new DiscoverySelectionRequired({
              candidates: discovery.candidates.map(({ connectionId, target }) => ({
                connectionId,
                zone: target.zone,
                label: target.label,
              })),
            });
          case "NotFound":
            return new DiscoveryNotFound({
              nameservers: discovery.nameservers,
              host: discovery.host,
            });
        }
      };

      /**
       * The connection a start or an attach produced. `label` is the zone the attachment named,
       * or the provider itself where the connection carries no domain yet.
       */
      const connected = (input: {
        readonly connection: Storage.Connection;
        readonly attachment: Storage.Attachment | null;
        readonly domain: string | undefined;
      }): Effect.Effect<Connected, Errors.DomainKitError, Principal.Service> =>
        Effect.gen(function* () {
          const authorization = yield* storage.authorizations.get(input.connection.authorizationId);
          const definition = yield* providers.get(authorization.provider);
          return new Connected({
            connectionId: input.connection.id,
            provider: authorization.provider,
            label: input.attachment?.label ?? authorization.label ?? definition.name,
            snapshot: input.domain === undefined ? null : yield* snapshot(input.domain),
          });
        });

      const startedOf = (
        started: Connect.Started,
        domain: string | undefined,
      ): Effect.Effect<Started, Errors.DomainKitError, Principal.Service> => {
        switch (started._tag) {
          case "Connected":
            return connected({
              attachment: started.attachment,
              connection: started.connection,
              domain,
            });
          case "Redirect":
            return Effect.succeed(new Redirect({ authorizationUrl: started.authorizationUrl }));
          case "SelectionRequired":
            return Effect.succeed(
              new SelectionRequired({
                connectionId: started.connection.id,
                candidates: candidatesOf(started.candidates),
              }),
            );
        }
      };

      /**
       * Attach with a zone the client picked out of a `SelectionRequired`. The provider target
       * behind a zone never crosses the wire, so resolve the candidates again and match by zone.
       */
      const attachAt = (input: {
        readonly connectionId: string;
        readonly domain: string;
        readonly zone: string | undefined;
      }): Effect.Effect<Started, Errors.DomainKitError, Principal.Service> =>
        Effect.gen(function* () {
          const connection = yield* storage.connections.get(input.connectionId);
          const attached = (attachment: Storage.Attachment) =>
            connected({ attachment, connection, domain: input.domain });
          const first = yield* connect.attach({
            connectionId: input.connectionId,
            domain: input.domain,
          });
          if (!("_tag" in first)) return yield* attached(first);
          if (input.zone === undefined) {
            return new SelectionRequired({
              connectionId: input.connectionId,
              candidates: candidatesOf(first.candidates),
            });
          }
          const target = first.candidates.find(({ zone }) => zone === input.zone);
          if (target === undefined) {
            return yield* Errors.fail(new Reason.NotFound({ entity: "zone", id: input.zone }));
          }
          const second = yield* connect.attach({
            connectionId: input.connectionId,
            domain: input.domain,
            target,
          });
          return "_tag" in second
            ? yield* Errors.fail(new Reason.NotFound({ entity: "zone", id: input.zone }))
            : yield* attached(second);
        });

      /** Provisioning and cleanup share the approve and apply routes; the attempt knows its kind. */
      const kindOf = (attempt: Storage.Attempt) =>
        attempt.kind === "cleanup" ? cleanup : provision;

      return handlers
        .handle("inspect", ({ params, request }) => as("inspect", request, snapshot(params.domain)))
        .handle("discover", ({ params, request }) =>
          as("discover", request, Effect.map(connect.discover(params.domain), discovered)),
        )
        .handle("zones", ({ query, request }) =>
          as(
            "zones",
            request,
            Effect.map(
              connect.zones(query.provider === undefined ? {} : { provider: query.provider }),
              (listing): Zones => ({
                zones: listing.zones.map(({ connectionId, provider, target }) => ({
                  connectionId,
                  provider,
                  zone: target.zone,
                  label: target.label,
                  ...(target.nameservers === undefined ? {} : { nameservers: target.nameservers }),
                })),
                connections: listing.connections,
                providers: listing.providers,
              }),
            ),
          ),
        )
        .handle("start", ({ payload, request }) =>
          as(
            "start",
            request,
            Effect.gen(function* () {
              // Token methods connect in one call; the interactive ones need somewhere to land.
              const callbackUrl =
                payload.method._tag === "Token"
                  ? undefined
                  : (yield* callbackUrlFor({
                      request,
                      provider: payload.provider,
                      options,
                      route: START_ROUTE,
                    })).toString();
              const started = yield* connect.start({
                provider: payload.provider,
                ...(payload.domain === undefined ? {} : { domain: payload.domain }),
                method: methodOf(payload.method),
                ...(callbackUrl === undefined ? {} : { callbackUrl }),
              });
              return yield* startedOf(started, payload.domain);
            }),
          ),
        )
        .handle("reconnect", ({ params, payload, request }) =>
          as(
            "reconnect",
            request,
            Effect.gen(function* () {
              const connection = yield* storage.connections.get(params.connectionId);
              const authorization = yield* storage.authorizations.get(connection.authorizationId);
              const callbackUrl =
                payload.method._tag === "Token"
                  ? undefined
                  : (yield* callbackUrlFor({
                      request,
                      provider: authorization.provider,
                      options,
                      route: reconnectRoute(params.connectionId),
                    })).toString();
              const started = yield* connect.reconnect({
                connectionId: params.connectionId,
                method: methodOf(payload.method),
                ...(callbackUrl === undefined ? {} : { callbackUrl }),
              });
              return yield* startedOf(started, undefined);
            }),
          ),
        )
        .handle("callback", ({ params, query, request }) =>
          Effect.gen(function* () {
            // The one route that establishes its identity from something other than the request.
            // A provider callback is a top-level navigation carrying a `state` the provider echoed
            // back and whatever credential the browser attaches by itself, so the flow DomainKit
            // recorded is the only authority on whose it is. Read its header first — a read, never
            // a spend, so a leaked `state` cannot burn the flow it names — tell the host which
            // flow is being finished, and then hold the host's answer against the record.
            const header = yield* storage.continuations
              .header(query.state)
              .pipe(
                Effect.catch((error) =>
                  error.reason._tag === "NotFound" || error.reason._tag === "Expired"
                    ? Effect.succeed(null)
                    : Effect.fail(error),
                ),
              );
            const continuation =
              header !== null && header.provider === params.provider ? header : null;
            // The host authenticates even when there is nothing to finish, so the status cannot
            // tell a caller whether the `state` it holds names a flow at all.
            return yield* as(
              "callback",
              request,
              Effect.gen(function* () {
                // The owner comes from the record and the actor from the host's own session;
                // nothing in the query string contributes either. The scoped `get` below keeps
                // its owner filter, so a host that answers with the wrong principal still fails
                // closed even if this check were ever removed.
                const principal = yield* Principal.Service;
                if (
                  continuation === null ||
                  principal.ownerId !== continuation.ownerId ||
                  principal.actorId !== continuation.actorId
                ) {
                  return yield* noSuchFlow;
                }
                const url = yield* absoluteUrl(request);
                // Resolve the destination against the callback's public base, not the request: a
                // proxy that rewrites `Host` leaves the request on an origin the browser never
                // sees.
                const base = yield* callbackUrlFor({
                  request,
                  provider: params.provider,
                  options,
                  route: callbackRoute(params.provider),
                });
                // Where the customer lands comes from the continuation this owner started, never
                // from the provider's query string, and it is resolved before the callback is
                // spent: a server with nowhere to send them must not connect the provider and
                // then fail.
                // The host's authentication sits between the header read and this one, so the
                // flow can expire or be spent in that window. It refuses the same way it would
                // have a moment earlier, rather than changing shape because of when it happened.
                // This is also where the owner filter fails closed when a host resolves the wrong
                // principal, and that refusal must look like every other one.
                const flow = yield* storage.continuations
                  .get(query.state)
                  .pipe(
                    Effect.catch((error) =>
                      error.reason._tag === "NotFound" || error.reason._tag === "Expired"
                        ? noSuchFlow
                        : Effect.fail(error),
                    ),
                  );
                const requested = flow.returnTo ?? options.defaultReturnTo;
                if (requested === undefined) {
                  return yield* invalid(
                    "The flow carried no returnTo and the server has no defaultReturnTo",
                    "returnTo",
                  );
                }
                const destination = sameOrigin(requested, base);
                if (destination === null) {
                  return yield* invalid(`${requested} leaves this application`, "returnTo");
                }
                yield* connect.complete({
                  continuationId: query.state,
                  callbackUrl: url.toString(),
                });
                return HttpApiSchema.withHeaders({
                  body: undefined as void,
                  headers: { location: destination },
                });
              }),
              continuation === null ? undefined : { endpoint: "callback", continuation },
            );
          }),
        )
        .handle("attach", ({ params, payload, request }) =>
          as(
            "attach",
            request,
            attachAt({
              connectionId: params.connectionId,
              domain: payload.domain,
              zone: payload.zone,
            }),
          ),
        )
        .handle("detach", ({ params, request }) =>
          as("detach", request, connect.detach(params.attachmentId)),
        )
        .handle("disconnect", ({ params, request }) =>
          as("disconnect", request, connect.disconnect(params.connectionId)),
        )
        .handle("createPlan", ({ params, payload, request }) =>
          as(
            "createPlan",
            request,
            provision.plan({ domain: params.domain, requirements: payload.requirements }),
          ),
        )
        .handle("approve", ({ params, payload, request }) =>
          as(
            "approve",
            request,
            Effect.gen(function* () {
              const attempt = yield* storage.attempts.get(params.planId);
              return yield* kindOf(attempt).approve(params.planId, {
                ...(payload.operationIds === undefined
                  ? {}
                  : { operationIds: payload.operationIds, allowPartial: true }),
              });
            }),
          ),
        )
        .handle("reject", ({ params, payload, request }) =>
          as(
            "reject",
            request,
            Effect.gen(function* () {
              const attempt = yield* storage.attempts.get(params.planId);
              return yield* kindOf(attempt).reject(params.planId, {
                ...(payload.reason === undefined ? {} : { reason: payload.reason }),
              });
            }),
          ),
        )
        .handle("apply", ({ params, request }) =>
          as(
            "apply",
            request,
            Effect.gen(function* () {
              const attempt = yield* storage.attempts.byApproval(params.approvalId);
              return yield* kindOf(attempt).apply(params.approvalId);
            }),
          ),
        )
        .handle("plan", ({ params, request }) =>
          as(
            "plan",
            request,
            Effect.map(storage.attempts.get(params.planId), (attempt) => ({
              plan: attempt.plan,
              status: attempt.status,
              approval: attempt.approval,
              receipt: attempt.receipt,
              rejection: attempt.rejection,
            })),
          ),
        )
        .handle("receipt", ({ params, request }) =>
          as(
            "receipt",
            request,
            Effect.flatMap(storage.attempts.byReceipt(params.receiptId), (attempt) =>
              attempt.receipt === null
                ? Errors.fail(new Reason.NotFound({ entity: "receipt", id: params.receiptId }))
                : Effect.succeed(attempt.receipt),
            ),
          ),
        )
        .handle("observe", ({ params, payload, request }) =>
          as(
            "observe",
            request,
            verify.observe({
              domain: params.domain,
              ...(payload.requirements === undefined ? {} : { requirements: payload.requirements }),
            }),
          ),
        )
        .handle("readiness", ({ params, request }) =>
          as("readiness", request, verify.latest(params.domain)),
        )
        .handle("cleanupPlan", ({ params, request }) =>
          as("cleanupPlan", request, cleanup.plan({ receiptId: params.receiptId })),
        )
        .handle("createBatch", ({ headers, payload, request }) =>
          as(
            "createBatch",
            request,
            provision.batch.create({
              items: payload.items,
              idempotencyKey: headers["idempotency-key"],
            }),
          ),
        )
        .handle("batches", ({ request }) =>
          as("batches", request, provision.batch.list({ unfinished: true })),
        )
        .handle("batch", ({ params, request }) =>
          as("batch", request, provision.batch.get(params.batchId)),
        )
        .handle("planBatch", ({ params, payload, request }) =>
          as(
            "planBatch",
            request,
            provision.batch.resumePlanning(params.batchId, { items: payload.items }),
          ),
        )
        .handle("approveBatch", ({ params, payload, request }) =>
          as(
            "approveBatch",
            request,
            provision.batch.approve(params.batchId, { digest: payload.digest }),
          ),
        )
        .handle("rejectBatch", ({ params, payload, request }) =>
          as(
            "rejectBatch",
            request,
            provision.batch.reject(params.batchId, {
              ...(payload.reason === undefined ? {} : { reason: payload.reason }),
            }),
          ),
        )
        .handle("applyBatch", ({ params, request }) =>
          as("applyBatch", request, provision.batch.apply(params.batchId)),
        );
    }),
  ) as Layer.Layer<HttpApiGroup.Service<ApiId, "domainkit">, never, Services>;

/** A standalone API for hosts not on HttpApi. Mount at any prefix. */
export const api: HttpApi.HttpApi<"domainkit", Group> = HttpApi.make("domainkit").add(group);

export interface WebHandlerOptions extends Options {
  /** Mount every route under this path, e.g. `/api/domainkit`. */
  readonly prefix?: `/${string}`;
}

/** The Promise edge: a `fetch`-shaped handler over the group for hosts that are not Effect-native. */
export const toWebHandler = (
  services: Layer.Layer<Services, Errors.DomainKitError>,
  options: WebHandlerOptions = {},
): {
  readonly handler: (request: Request) => Promise<Response>;
  readonly dispose: () => Promise<void>;
} => {
  // `group.prefix` widens the endpoint paths in the type, which `Group` states unprefixed; the
  // handlers are keyed by endpoint identifier, so the routes still line up.
  const prefixed =
    options.prefix === undefined
      ? api
      : (HttpApi.make("domainkit").add(group.prefix(options.prefix)) as unknown as HttpApi.HttpApi<
          "domainkit",
          Group
        >);
  const app = HttpApiBuilder.layer(prefixed).pipe(
    Layer.provide(layer(prefixed, options)),
    Layer.provide(services),
    Layer.provide(HttpServer.layerServices),
  );
  return HttpRouter.toWebHandler(app, { disableLogger: true });
};
