import { Config, Effect } from "effect";
import { Cloudflare, Connect } from "domainkit";

// #region token-only
/** With no options Cloudflare offers API tokens only, and nothing needs registering. */
export const tokensOnly = Cloudflare.provider();
// #endregion token-only

// #region oauth
/**
 * Adding OAuth adds one method to the same definition. Scope ids come from the OAuth client you
 * registered with Cloudflare; the default set is `zone:read`, `dns_records:edit`, `offline_access`.
 */
export const withOAuth = Cloudflare.provider({
  oauth: {
    clientId: Config.string("CF_CLIENT_ID"),
    clientSecret: Config.redacted("CF_CLIENT_SECRET"),
  },
});
// #endregion oauth

// #region connect-token
/**
 * A user token spans every account it can reach. An account-owned token is pinned, so the customer
 * supplies the account id the token belongs to; the connect form renders both fields from
 * `Cloudflare.TokenFields`.
 */
export const connectAccountToken = Connect.start({
  provider: "cloudflare",
  method: Connect.Method.token({ token: "cf_api_token", accountId: "acct_1" }),
  domain: "app.example.com",
});
// #endregion connect-token

// #region connect-oauth
export const connectOAuth = Effect.map(
  Connect.start({
    provider: "cloudflare",
    method: Connect.Method.oauth({ returnTo: "/settings/domains" }),
    domain: "app.example.com",
  }),
  (started) => (started._tag === "Redirect" ? started.authorizationUrl : null),
);
// #endregion connect-oauth
