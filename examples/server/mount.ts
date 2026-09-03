import { Effect, Layer } from "effect";
import { HttpApi, HttpApiBuilder, OpenApi } from "effect/unstable/httpapi";
import { DomainKit, type Principal, Reason, type Storage } from "domainkit";
import { Server } from "domainkit/server";

// The server reads attempts and receipts straight from Storage, so compose it with `provideMerge`
// rather than `provide`; `packages/domainkit/examples/effect/server.ts` builds the whole layer.
declare const DomainKitLive: Layer.Layer<DomainKit.Services | Storage.Service>;
declare const sessions: {
  readonly verify: (token: string) => Effect.Effect<Principal.Interface | null>;
  readonly principal: (token: string) => Effect.Effect<Principal.Interface, Error>;
};

// #region identity
/**
 * The one service you write. Verify a credential you issued and look the tenant up yourself: a
 * request never names its own `ownerId`, and one you cannot attribute fails closed.
 *
 * Read it from a cookie. `/callback/:provider` is a top-level navigation the provider sends the
 * browser on, so only what the browser attaches by itself arrives with it; a header-only scheme
 * fails every interactive connection at the last step.
 */
export const IdentityLive = Layer.succeed(Server.Identity)({
  principal: (request) =>
    Effect.gen(function* () {
      const token = request.cookies.session;
      const session = token === undefined ? null : yield* sessions.verify(token);
      return session === null
        ? yield* Effect.fail(
            new DomainKit.Error({
              reason: new Reason.Unauthenticated({ message: "The request carries no session" }),
            }),
          )
        : session;
    }),
});
// #endregion identity

// #region authorize
/**
 * `authorize` runs after `principal` on every request and decides which routes that principal may
 * reach. Without it every authenticated principal reaches every route, which is right for a host
 * whose own middleware already gates the mount. Fail with `Forbidden` for the 403 a UI expects.
 */
const writeRoutes = new Set<Server.EndpointName>([
  "start",
  "attach",
  "detach",
  "disconnect",
  "approve",
  "reject",
  "apply",
]);

export const AdminWritesIdentity = Layer.succeed(Server.Identity)({
  principal: (request) => Effect.orDie(sessions.principal(request.cookies.session ?? "")),
  authorize: (principal, endpoint) =>
    !writeRoutes.has(endpoint) || principal.actorId.startsWith("admin_")
      ? Effect.void
      : Effect.fail(
          new DomainKit.Error({
            reason: new Reason.Forbidden({ message: `${endpoint} needs an administrator` }),
          }),
        ),
});
// #endregion authorize

// #region mount
export const Api = HttpApi.make("app").add(Server.group);

export const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(Server.layer(Api, { defaultReturnTo: "/settings/domains" })),
  Layer.provide([DomainKitLive, IdentityLive]),
);
// #endregion mount

// #region prefix
/** The group declares no path of its own, so one prefix moves every route and the callback URL. */
export const PrefixedApi = HttpApi.make("app").add(Server.group.prefix("/internal/dns"));
// #endregion prefix

// #region openapi
/** `Server.api` is the same group as a standalone API, so it documents itself. */
export const spec = OpenApi.fromApi(Server.api);
// #endregion openapi

// #region web-handler
/**
 * Not on Effect's HTTP stack? The same group behind one `fetch` handler. Mount it wherever your
 * router puts a catch-all route and call `dispose` when the process shuts down.
 */
export const { handler, dispose } = Server.toWebHandler(
  Layer.mergeAll(DomainKitLive, IdentityLive),
  { prefix: "/api/domainkit", defaultReturnTo: "/settings/domains" },
);
// #endregion web-handler

// #region callback-base-url
/**
 * The callback URL follows the mount and the incoming request's origin. An edge that rewrites
 * `Host` leaves the request pointing at an origin the browser never sees, so name the public one
 * once and it wins everywhere.
 */
export const behindProxy = Server.toWebHandler(Layer.mergeAll(DomainKitLive, IdentityLive), {
  prefix: "/api/domainkit",
  callbackBaseUrl: "https://app.acme.dev/api/domainkit",
});
// #endregion callback-base-url
