import type * as oauth from "oauth4webapi";
import { Effect } from "effect";

import type * as ProviderAuth from "../auth/manifest.ts";
import type * as Secret from "../auth/secret.ts";
import * as EffectAuth from "../providers/cloudflare/auth.ts";

export const manifest = EffectAuth.manifest;
export const oauthMethod = EffectAuth.oauthMethod;
export const tokenMethod = EffectAuth.tokenMethod;
export type {
  CredentialTarget,
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

export function tokenValidator(
  options: EffectAuth.TokenValidatorOptions,
): (token: Secret.Value) => Promise<ProviderAuth.TokenValidation> {
  const validate = EffectAuth.tokenValidator(options);
  return (token) => Effect.runPromise(validate(token));
}
