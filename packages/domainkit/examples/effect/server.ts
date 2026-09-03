// Add custom domains to an Effect app: providers, storage, routes. Nothing else to write.
import { Config, Effect, Layer } from "effect";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";
import {
  Cloudflare,
  Custody,
  DomainKit,
  DomainKitError,
  type Principal,
  Storage,
  Vercel,
} from "domainkit";
import { Server } from "domainkit/server";

const DomainKitLive = DomainKit.layer({
  providers: [
    Cloudflare.provider({
      oauth: {
        clientId: Config.string("CF_CLIENT_ID"),
        clientSecret: Config.redacted("CF_CLIENT_SECRET"),
      },
    }),
    Vercel.provider(), // tokens only
  ],
}).pipe(
  // `provideMerge`, not `provide`: the server reads attempts and receipts straight from Storage.
  Layer.provideMerge(Layer.mergeAll(Storage.layerMemory, Custody.layerConfig())),
);

// Who is calling: your session, your tenant model. Verify a credential you issued and look the
// tenant up yourself — a request never names its own `ownerId` — and fail closed when it does not
// check out. Every Storage read and write is scoped by whatever this returns.
declare const sessions: {
  readonly verify: (token: string) => Effect.Effect<Principal.Shape | null>;
};

// Read the credential from a cookie, not an `Authorization` header: `/callback/:provider` is a
// top-level navigation the provider sends the browser on, so only what the browser attaches by
// itself arrives with it. A header-only scheme fails every interactive connection at completion.
const IdentityLive = Layer.succeed(Server.Identity)({
  principal: (request) =>
    Effect.gen(function* () {
      const token = request.cookies.session;
      const session = token === undefined ? null : yield* sessions.verify(token);
      return session === null
        ? yield* DomainKitError.fail(
            new DomainKitError.Unauthenticated({ message: "The request carries no session" }),
          )
        : session;
    }),
});

// Mount the group in your API. Every route, typed, with OpenAPI for free.
export const Api = HttpApi.make("app").add(Server.group);

export const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(Server.layer(Api, { defaultReturnTo: "/settings/domains" })),
  Layer.provide([DomainKitLive, IdentityLive]),
);

// Not on HttpApi? The same group behind one `fetch` handler, mounted where you like.
export const { handler, dispose } = Server.toWebHandler(
  Layer.mergeAll(DomainKitLive, IdentityLive),
  { prefix: "/api/domainkit", defaultReturnTo: "/settings/domains" },
);
