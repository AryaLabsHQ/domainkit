import type * as oauth from "oauth4webapi";
import { Effect } from "effect";

import type * as ProviderAuth from "../auth/manifest.ts";
import type * as Secret from "../auth/secret.ts";
import type * as Client from "../providers/cloudflare/client.ts";
import * as EffectAuth from "../providers/cloudflare/auth.ts";
import type * as ProviderSession from "../provider/session.ts";
import * as Connection from "./connection.ts";

export const manifest = EffectAuth.manifest;
export const oauthMethod = EffectAuth.oauthMethod;
export function restore(
  options: ProviderSession.RestoreInput & Pick<Client.Options, "baseUrl" | "fetch">,
): Promise<Client.Interface> {
  return Effect.runPromise(EffectAuth.restore(options));
}
export const tokenMethod = EffectAuth.tokenMethod;
export type {
  CredentialTarget,
  OAuthFlowOptions,
  OAuthMethodOptions,
  SubjectResolverOptions,
  TokenValidatorOptions,
} from "../providers/cloudflare/auth.ts";

export function subjectResolver(
  options: EffectAuth.SubjectResolverOptions,
): ProviderAuth.AsyncOAuthSubjectResolver {
  const resolve = EffectAuth.subjectResolver(options);
  return (tokens: oauth.TokenEndpointResponse, accessToken: Secret.Value) =>
    Effect.runPromise(resolve(tokens, accessToken));
}

/** Creates Cloudflare's OAuth implementation for the Promise connection facade. */
export function oauthFlow(options: EffectAuth.OAuthFlowOptions): Connection.InteractiveFlow {
  return Connection.fromEffectFlow(EffectAuth.oauthFlow(options));
}

/** Creates a Cloudflare token method for the Promise connection facade. */
export function tokenConnectionMethod(
  options: EffectAuth.TokenConnectionOptions,
): Extract<Connection.Method, { readonly _tag: "Token" }> {
  return Connection.fromEffectTokenMethod(EffectAuth.tokenConnectionMethod(options));
}

export function tokenValidator(
  options: EffectAuth.TokenValidatorOptions,
): (token: Secret.Value) => Promise<ProviderAuth.TokenValidation> {
  const validate = EffectAuth.tokenValidator(options);
  return (token) => Effect.runPromise(validate(token));
}
