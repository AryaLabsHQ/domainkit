import { Effect } from "effect";
import { Connect } from "domainkit";

const domain = "app.example.com";

// #region inspect
/** Everything a settings screen needs: the attachment, the connection, and what else is on offer. */
export const state = Effect.map(Connect.inspect(domain), (snapshot) => ({
  attached: snapshot.attachment !== null,
  provider: snapshot.authorization?.provider ?? null,
  revocation: snapshot.authorization?.revocation ?? null,
  lastReceiptId: snapshot.lastReceiptId,
  reusable: snapshot.reusable.map(({ connection, provider }) => ({
    connectionId: connection.id,
    provider,
  })),
  offered: snapshot.providers.map(({ id, methods }) => ({ id, methods: methods.length })),
}));
// #endregion inspect

// #region token
/** A token method connects in one call: `Started.Connected` carries the connection right away. */
export const withToken = Connect.start({
  provider: "cloudflare",
  method: Connect.Method.token({ token: "cf_api_token", accountId: "acct_1" }),
  domain,
});
// #endregion token

// #region interactive
/**
 * OAuth and marketplace installs answer `Redirect`. Send the customer to `authorizationUrl`; the
 * provider drives the browser back to `/callback/:provider`, which calls `Connect.complete`.
 */
export const withOAuth = Effect.map(
  Connect.start({
    provider: "cloudflare",
    method: Connect.Method.oauth({ returnTo: "/settings/domains" }),
    domain,
  }),
  (started) => (started._tag === "Redirect" ? started.authorizationUrl : null),
);

export const finish = (continuationId: string, callbackUrl: string) =>
  Connect.complete({ continuationId, callbackUrl });
// #endregion interactive

// #region discover
/**
 * Before offering the provider list, ask which connection this owner already has for the domain.
 * `Resolved` means the second domain needs no connect step at all.
 */
export const reuseExisting = Effect.gen(function* () {
  const discovery = yield* Connect.discover(domain);
  switch (discovery._tag) {
    case "Resolved":
      return yield* Connect.attach({
        connectionId: discovery.connectionId,
        domain,
        target: discovery.target,
      });
    case "SelectionRequired":
      return discovery.candidates.map(({ connectionId, target }) => ({
        connectionId,
        zone: target.zone,
        label: target.label,
      }));
    case "NotFound":
      return discovery.nameservers;
  }
});
// #endregion discover

// #region attach
/**
 * Attaching binds one domain to one zone. When a credential reaches several matching zones the
 * caller picks, and `attach` is called again with the chosen target.
 */
export const attach = (connectionId: string) =>
  Effect.map(Connect.attach({ connectionId, domain }), (attached) =>
    "_tag" in attached ? { choose: attached.candidates } : { attachmentId: attached.id },
  );
// #endregion attach

// #region release
/** Detach forgets the domain and leaves the records in DNS; plan a cleanup first to remove them. */
export const release = (attachmentId: string) => Connect.detach(attachmentId);

/** Disconnect detaches every domain and revokes the credential where the method supports it. */
export const revoke = (connectionId: string) => Connect.disconnect(connectionId);
// #endregion release
