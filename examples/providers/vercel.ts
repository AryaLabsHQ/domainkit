import { Config, Effect } from "effect";
import { Connect, Vercel } from "domainkit";

// #region token-only
/** Personal and team access tokens, with no integration to register. */
export const tokensOnly = Vercel.provider();
// #endregion token-only

// #region integration
/**
 * A marketplace install redirects like OAuth but is not OAuth: the flow starts at the integration's
 * install URL and exchanges a one-time code at Vercel's token endpoint.
 */
export const withIntegration = Vercel.provider({
  integration: {
    clientId: Config.string("VERCEL_CLIENT_ID"),
    clientSecret: Config.redacted("VERCEL_CLIENT_SECRET"),
    slug: "acme-domains",
  },
});
// #endregion integration

// #region connect-token
/** `teamId` scopes the connection to one team; leave it out for a personal account. */
export const connectTeamToken = Connect.start({
  provider: "vercel",
  method: Connect.Method.token({ token: "vercel_token", teamId: "team_1" }),
  domain: "app.example.com",
});
// #endregion connect-token

// #region connect-integration
export const install = Effect.map(
  Connect.start({
    provider: "vercel",
    method: Connect.Method.integration({ returnTo: "/settings/domains" }),
    domain: "app.example.com",
  }),
  (started) => (started._tag === "Redirect" ? started.authorizationUrl : null),
);
// #endregion connect-integration
