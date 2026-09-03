/**
 * domainkit/server — the whole lifecycle as one HttpApi group the host mounts.
 *
 *   const Api = HttpApi.make("app").add(Server.group)
 *   const ApiLive = HttpApiBuilder.layer(Api).pipe(
 *     Layer.provide([Server.layer(Api), DomainKitLive, IdentityLive]),
 *   )
 *
 * The host provides `Identity` (request -> `Principal.Shape`). Everything else comes from
 * `DomainKit.layer`. Non-HttpApi hosts use `toWebHandler`. The group carries no prefix of its
 * own, so `group.prefix("/internal/dns")` or a host router mount is all a different base path
 * takes; callback URLs follow the mount.
 */
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";

import * as Approval from "./Approval.ts";
import { Cleanup } from "./Cleanup.ts";
import * as ConnectModule from "./Connect.ts";
import { Connect } from "./Connect.ts";
import * as DnsRecord from "./DnsRecord.ts";
import * as DomainKitError from "./DomainKitError.ts";
import * as Plan from "./Plan.ts";
import * as Principal from "./Principal.ts";
import { Providers } from "./Providers.ts";
import { Provision } from "./Provision.ts";
import * as Receipt from "./Receipt.ts";
import * as Storage from "./Storage.ts";
import * as Verify from "./Verify.ts";

/** The only service a host must implement for the server. */
export interface IdentityService {
  readonly principal: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<Principal.Shape, DomainKitError.DomainKitError>;
}

export class Identity extends Context.Service<Identity, IdentityService>()(
  "@domainkit/server/Identity",
) {}

// ---------------------------------------------------------------------------------------------
// Wire schemas (the transport contract `domainkit/client` and `@domainkit/react` consume)
// ---------------------------------------------------------------------------------------------

export const ConnectionStatus = Schema.Literals(["disconnected", "connected", "reconnect"]);
export type ConnectionStatus = typeof ConnectionStatus.Type;

/** Everything the UI needs about a domain, flattened; provider context never crosses the wire. */
export const Snapshot = Schema.Struct({
  domain: Schema.String,
  attachmentId: Schema.NullOr(Schema.String),
  connectionId: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  method: Schema.NullOr(Storage.AuthMethod),
  status: ConnectionStatus,
  lastReceiptId: Schema.NullOr(Schema.String),
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
      methods: Schema.Array(Storage.AuthMethod),
    }),
  ),
});
export type Snapshot = typeof Snapshot.Type;

/** How the client asks to connect. The token is plaintext in transit and never comes back out. */
export class Token extends Schema.TaggedClass<Token>("@domainkit/server/Method/Token")("Token", {
  token: Schema.String,
}) {}
export class OAuth extends Schema.TaggedClass<OAuth>("@domainkit/server/Method/OAuth")("OAuth", {
  returnTo: Schema.optionalKey(Schema.String),
}) {}
export class Integration extends Schema.TaggedClass<Integration>(
  "@domainkit/server/Method/Integration",
)("Integration", { returnTo: Schema.optionalKey(Schema.String) }) {}
export const Method = Schema.Union([Token, OAuth, Integration]);
export type Method = typeof Method.Type;

export const StartPayload = Schema.Struct({
  domain: Schema.String,
  provider: Schema.String,
  method: Method,
});
export type StartPayload = typeof StartPayload.Type;

/** A zone the connection can serve, named for a customer to pick from. */
export class Candidate extends Schema.Class<Candidate>("@domainkit/server/Candidate")({
  zone: Schema.String,
  label: Schema.String,
}) {}

export class Connected extends Schema.TaggedClass<Connected>("@domainkit/server/Started/Connected")(
  "Connected",
  { snapshot: Snapshot },
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

export const AttachPayload = Schema.Struct({
  domain: Schema.String,
  /** Which candidate zone to attach when `SelectionRequired` came back. */
  zone: Schema.optionalKey(Schema.String),
});
export type AttachPayload = typeof AttachPayload.Type;

export const PlanPayload = Schema.Struct({
  requirements: Schema.Array(DnsRecord.DnsRecord),
});
export type PlanPayload = typeof PlanPayload.Type;

export const ApprovePayload = Schema.Struct({
  /** A subset of the plan's writes; omit to approve every write. */
  operationIds: Schema.optionalKey(Schema.Array(Plan.OperationId)),
});
export type ApprovePayload = typeof ApprovePayload.Type;

/** One durable plan -> approval -> receipt lifecycle, as `GET /plans/:planId` returns it. */
export const Attempt = Schema.Struct({
  plan: Plan.Plan,
  approval: Schema.NullOr(Approval.Approval),
  receipt: Schema.NullOr(Receipt.Receipt),
});
export type Attempt = typeof Attempt.Type;

/** `Verify.Readiness` on the wire; timestamps encode as ISO strings. */
export const Readiness = Schema.Struct({
  attachmentId: Schema.String,
  overall: Storage.Overall,
  requirements: Schema.Array(
    Schema.Struct({
      operationId: Schema.NullOr(Plan.OperationId),
      record: DnsRecord.DnsRecord,
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
// Errors: one wire body, the status from `DomainKitError.httpStatus`
// ---------------------------------------------------------------------------------------------

/** `DomainKitError` narrowed to the reasons that answer with `status`. */
const errorAt = (status: number) =>
  DomainKitError.DomainKitError.check(
    Schema.makeFilter((error: DomainKitError.DomainKitError) => error.httpStatus === status),
  ).pipe(HttpApiSchema.status(status));

const errors = [400, 401, 403, 404, 409, 500, 502, 503].map(errorAt);

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
      // may return `error`, `teamId`, or `configurationId` too. These three are declared so the
      // OpenAPI document names what a provider is expected to send back.
      query: {
        state: Schema.String,
        code: Schema.optionalKey(Schema.String),
        returnTo: Schema.optionalKey(Schema.String),
      },
      success: Redirected,
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
      success: Plan.Plan,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("approve", "/plans/:planId/approvals", {
      params: { planId: Plan.PlanId },
      payload: ApprovePayload,
      success: Approval.Approval,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("apply", "/approvals/:approvalId/apply", {
      params: { approvalId: Approval.ApprovalId },
      success: Receipt.Receipt,
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
      success: Receipt.Receipt,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("observe", "/domains/:domain/observations", {
      params: { domain: Schema.String },
      success: Readiness,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("cleanupPlan", "/receipts/:receiptId/cleanup-plans", {
      params: { receiptId: Receipt.ReceiptId },
      success: Plan.Plan,
      error: errors,
    }),
  );
// Cleanup approve and apply reuse `approve` and `apply`: the attempt knows its kind.

export type Group = typeof group;

export interface Options {
  /**
   * Where the callback route is reachable from the provider, without the `/callback/:provider`
   * suffix. Defaults to the incoming request's origin and mount path.
   */
  readonly callbackBaseUrl?: string;
  /** Where interactive flows return when the callback carries no `returnTo`. */
  readonly defaultReturnTo?: string;
}

export type Services = Provision | Cleanup | Connect | Verify.Verify | Providers | Storage.Storage;

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

const START_PATH = "/connections";

const invalid = (message: string, field?: string) =>
  DomainKitError.fail(
    new DomainKitError.InvalidInput({ message, ...(field === undefined ? {} : { field }) }),
  );

/** The request as an absolute URL: the web original when there is one, else scheme plus `Host`. */
const absoluteUrl = (
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<URL, DomainKitError.DomainKitError> =>
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

/** The absolute URL the provider redirects back to, following whatever prefix the group is mounted at. */
const callbackUrlFor = (input: {
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly provider: string;
  readonly options: Options;
}): Effect.Effect<string, DomainKitError.DomainKitError> =>
  Effect.suspend(() => {
    const suffix = `/callback/${encodeURIComponent(input.provider)}`;
    const configured = input.options.callbackBaseUrl;
    if (configured !== undefined) {
      return Effect.succeed(`${configured.replace(/\/+$/, "")}${suffix}`);
    }
    return Effect.flatMap(absoluteUrl(input.request), (url) => {
      const path = url.pathname;
      if (!path.endsWith(START_PATH)) {
        return invalid("The start route is not mounted at /connections", "callbackBaseUrl");
      }
      return Effect.succeed(
        `${url.origin}${path.slice(0, path.length - START_PATH.length)}${suffix}`,
      );
    });
  });

const snapshotOf = (snapshot: ConnectModule.Snapshot): Snapshot => ({
  domain: snapshot.domain,
  attachmentId: snapshot.attachment?.id ?? null,
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
  reusable: snapshot.reusable.map(({ connection, provider, method }) => ({
    connectionId: connection.id,
    provider,
    method,
  })),
  providers: snapshot.providers.map(({ id, name, methods }) => ({ id, name, methods })),
});

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
): Layer.Layer<HttpApiGroup.Service<ApiId, "domainkit">, never, Services | Identity> =>
  // The host's API carries its own groups beside this one; only `"domainkit"` is implemented here,
  // and `HttpApiBuilder.group` needs the group's own endpoint types to check the handlers.
  HttpApiBuilder.group(api as unknown as HttpApi.HttpApi<ApiId, Group>, "domainkit", (handlers) =>
    Effect.gen(function* () {
      const identity = yield* Identity;
      const connect = yield* Connect;
      const provision = yield* Provision;
      const cleanup = yield* Cleanup;
      const verify = yield* Verify.Verify;
      const storage = yield* Storage.Storage;

      /** Run a lifecycle effect as the principal the host derives from this request. */
      const as = <A>(
        request: HttpServerRequest.HttpServerRequest,
        effect: Effect.Effect<A, DomainKitError.DomainKitError, Principal.Principal>,
      ): Effect.Effect<A, DomainKitError.DomainKitError> =>
        Effect.flatMap(identity.principal(request), (principal) =>
          Effect.provideService(effect, Principal.Principal, principal),
        );

      const snapshot = (domain: string) => Effect.map(connect.inspect(domain), snapshotOf);

      const connected = (domain: string) =>
        Effect.map(snapshot(domain), (value) => new Connected({ snapshot: value }));

      const startedOf = (
        started: ConnectModule.Started,
        domain: string,
      ): Effect.Effect<Started, DomainKitError.DomainKitError, Principal.Principal> => {
        switch (started._tag) {
          case "Connected":
            return connected(domain);
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
      }): Effect.Effect<Started, DomainKitError.DomainKitError, Principal.Principal> =>
        Effect.gen(function* () {
          const first = yield* connect.attach({
            connectionId: input.connectionId,
            domain: input.domain,
          });
          if (!("_tag" in first)) return yield* connected(input.domain);
          if (input.zone === undefined) {
            return new SelectionRequired({
              connectionId: input.connectionId,
              candidates: candidatesOf(first.candidates),
            });
          }
          const target = first.candidates.find(({ zone }) => zone === input.zone);
          if (target === undefined) {
            return yield* DomainKitError.fail(
              new DomainKitError.NotFound({ entity: "zone", id: input.zone }),
            );
          }
          yield* connect.attach({
            connectionId: input.connectionId,
            domain: input.domain,
            target,
          });
          return yield* connected(input.domain);
        });

      /** Provisioning and cleanup share the approve and apply routes; the attempt knows its kind. */
      const kindOf = (attempt: Storage.Attempt) =>
        attempt.kind === "cleanup" ? cleanup : provision;

      return handlers
        .handle("inspect", ({ params, request }) => as(request, snapshot(params.domain)))
        .handle("start", ({ payload, request }) =>
          as(
            request,
            Effect.gen(function* () {
              const method = payload.method;
              const started = yield* connect.start({
                provider: payload.provider,
                domain: payload.domain,
                method:
                  method._tag === "Token"
                    ? ConnectModule.Method.token(Redacted.make(method.token))
                    : method._tag === "OAuth"
                      ? ConnectModule.Method.oauth(
                          method.returnTo === undefined ? {} : { returnTo: method.returnTo },
                        )
                      : ConnectModule.Method.integration(
                          method.returnTo === undefined ? {} : { returnTo: method.returnTo },
                        ),
                ...(method._tag === "Token"
                  ? {}
                  : {
                      callbackUrl: yield* callbackUrlFor({
                        request,
                        provider: payload.provider,
                        options,
                      }),
                    }),
              });
              return yield* startedOf(started, payload.domain);
            }),
          ),
        )
        .handle("callback", ({ query, request }) =>
          as(
            request,
            Effect.gen(function* () {
              const url = yield* absoluteUrl(request);
              yield* connect.complete({
                continuationId: query.state,
                callbackUrl: url.toString(),
              });
              const destination = query.returnTo ?? options.defaultReturnTo;
              if (destination === undefined) {
                return yield* invalid(
                  "The callback has no returnTo and the server has no defaultReturnTo",
                  "returnTo",
                );
              }
              return HttpApiSchema.withHeaders({
                body: undefined as void,
                headers: { location: destination },
              });
            }),
          ),
        )
        .handle("attach", ({ params, payload, request }) =>
          as(
            request,
            attachAt({
              connectionId: params.connectionId,
              domain: payload.domain,
              zone: payload.zone,
            }),
          ),
        )
        .handle("detach", ({ params, request }) => as(request, connect.detach(params.attachmentId)))
        .handle("disconnect", ({ params, request }) =>
          as(request, connect.disconnect(params.connectionId)),
        )
        .handle("createPlan", ({ params, payload, request }) =>
          as(
            request,
            provision.plan({ domain: params.domain, requirements: payload.requirements }),
          ),
        )
        .handle("approve", ({ params, payload, request }) =>
          as(
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
        .handle("apply", ({ params, request }) =>
          as(
            request,
            Effect.gen(function* () {
              const attempt = yield* storage.attempts.byApproval(params.approvalId);
              return yield* kindOf(attempt).apply(params.approvalId);
            }),
          ),
        )
        .handle("plan", ({ params, request }) =>
          as(
            request,
            Effect.map(storage.attempts.get(params.planId), (attempt) => ({
              plan: attempt.plan,
              approval: attempt.approval,
              receipt: attempt.receipt,
            })),
          ),
        )
        .handle("receipt", ({ params, request }) =>
          as(
            request,
            Effect.flatMap(storage.attempts.byReceipt(params.receiptId), (attempt) =>
              attempt.receipt === null
                ? DomainKitError.fail(
                    new DomainKitError.NotFound({ entity: "receipt", id: params.receiptId }),
                  )
                : Effect.succeed(attempt.receipt),
            ),
          ),
        )
        .handle("observe", ({ params, request }) =>
          as(request, verify.observe({ domain: params.domain })),
        )
        .handle("cleanupPlan", ({ params, request }) =>
          as(request, cleanup.plan({ receiptId: params.receiptId })),
        );
    }),
  ) as Layer.Layer<HttpApiGroup.Service<ApiId, "domainkit">, never, Services | Identity>;

/** A standalone API for hosts not on HttpApi. Mount at any prefix. */
export const api: HttpApi.HttpApi<"domainkit", Group> = HttpApi.make("domainkit").add(group);

export interface WebHandlerOptions extends Options {
  /** Mount every route under this path, e.g. `/api/domainkit`. */
  readonly prefix?: `/${string}`;
}

/** The Promise edge: a `fetch`-shaped handler over the group for hosts that are not Effect-native. */
export const toWebHandler = (
  services: Layer.Layer<Services | Identity, DomainKitError.DomainKitError>,
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
