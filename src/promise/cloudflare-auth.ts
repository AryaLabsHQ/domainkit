import type * as oauth from "oauth4webapi";
import { Effect } from "effect";

import type * as ProviderAuth from "../auth/manifest.ts";
import type * as Secret from "../auth/secret.ts";
import * as EffectAuth from "../providers/cloudflare/auth.ts";
import * as EffectClient from "../providers/cloudflare/client.ts";

export const manifest = EffectAuth.manifest;
export const oauthMethod = EffectAuth.oauthMethod;
export const tokenMethod = EffectAuth.tokenMethod;
export type { OAuthMethodOptions, SubjectResolverOptions } from "../providers/cloudflare/auth.ts";

export function subjectResolver(
  options: EffectAuth.SubjectResolverOptions,
): ProviderAuth.AsyncOAuthSubjectResolver {
  const resolve = EffectAuth.subjectResolver(options);
  return (tokens: oauth.TokenEndpointResponse, accessToken: Secret.Value) =>
    Effect.runPromise(resolve(tokens, accessToken));
}

export function tokenValidator(
  options: Omit<EffectClient.Options, "token">,
): (token: Secret.Value) => Promise<ProviderAuth.TokenValidation> {
  return (token) => Effect.runPromise(EffectClient.make({ ...options, token }).validateToken());
}
