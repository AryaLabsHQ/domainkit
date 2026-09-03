// Add custom domains to an Effect app: providers, storage, routes. Nothing else to write.
import { Config, Effect, Layer } from "effect";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";
import { Cloudflare, Custody, DomainKit, DomainKitError, Storage, Vercel } from "domainkit";
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

// Who is calling: your session, your tenant model. Fail closed — a request DomainKit cannot
// attribute must not run under someone else's principal.
const IdentityLive = Layer.succeed(Server.Identity)({
  principal: (request) => {
    const ownerId = request.headers["x-org-id"];
    const actorId = request.headers["x-user-id"];
    return ownerId === undefined || actorId === undefined
      ? DomainKitError.fail(
          new DomainKitError.Unauthenticated({ message: "The request carries no session" }),
        )
      : Effect.succeed({ ownerId, actorId });
  },
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
