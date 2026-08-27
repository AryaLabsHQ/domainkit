import { Effect, Schema as S } from "effect";

import type * as ProviderAuth from "../../auth/manifest.ts";
import * as Secret from "../../auth/secret.ts";
import * as DnsProvider from "../../provider/provider.ts";
import type * as Client from "./client.ts";
import * as Protocol from "./protocol.ts";

/** Describes Vercel's caller-created personal access-token method. */
export function tokenMethod(
  capabilities: ProviderAuth.TokenValidation["capabilities"],
): Extract<ProviderAuth.Manifest["methods"][number], { readonly _tag: "token" }> {
  return {
    _tag: "token",
    capabilities: [...capabilities],
    instructionsUrl: "https://vercel.com/account/settings/tokens",
  };
}

export interface IntegrationMethodOptions {
  readonly capabilities: ProviderAuth.TokenValidation["capabilities"];
  readonly slug: string;
}

/** Describes Vercel's provider-specific integration installation flow. */
export function integrationMethod(
  options: IntegrationMethodOptions,
): ProviderAuth.IntegrationMethod {
  return {
    _tag: "integration",
    capabilities: [...options.capabilities],
    installUrl: `https://vercel.com/integrations/${encodeURIComponent(options.slug)}/new`,
    tokenEndpoint: "https://api.vercel.com/v2/oauth/access_token",
  };
}

/** Creates the Vercel token and integration authorization manifest. */
export function manifest(options: IntegrationMethodOptions): ProviderAuth.Manifest {
  return {
    methods: [tokenMethod(options.capabilities), integrationMethod(options)],
    providerId: "vercel",
  };
}

export interface ExchangeCodeOptions {
  readonly baseUrl?: string;
  readonly clientId: string;
  readonly clientSecret: Secret.Value;
  readonly code: Secret.Value;
  readonly fetch?: Client.Fetch;
  readonly redirectUri: string;
}

export interface IntegrationCredential {
  readonly accessToken: Secret.Value;
  readonly context: Client.AccountContext;
  readonly installationId: string | null;
  readonly userId: string;
}

/** Exchanges Vercel's one-time integration code and preserves its account context. */
export const exchangeCode = Effect.fn("VercelAuth.exchangeCode")((options: ExchangeCodeOptions) =>
  Effect.gen(function* () {
    const fetch = options.fetch ?? globalThis.fetch;
    const baseUrl = (options.baseUrl ?? "https://api.vercel.com").replace(/\/$/, "");
    const body = new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret.expose(),
      code: options.code.expose(),
      redirect_uri: options.redirectUri,
    });
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${baseUrl}/v2/oauth/access_token`, {
          body,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        }),
      catch: () => failure("exchangeCode", "Vercel token exchange failed", "transport"),
    });
    const input = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: () =>
        failure(
          "exchangeCode",
          response.ok
            ? "Vercel returned a non-JSON token response"
            : `Vercel token exchange failed with HTTP ${response.status}`,
          response.ok ? "response" : response.status === 401 ? "authentication" : "request",
          response.status,
        ),
    });
    if (!response.ok) {
      const detail = S.decodeUnknownOption(Protocol.ErrorEnvelope)(input);
      return yield* Effect.fail(
        failure(
          "exchangeCode",
          detail._tag === "Some"
            ? detail.value.error.message
            : `Vercel token exchange failed with HTTP ${response.status}`,
          response.status === 401 ? "authentication" : "request",
          response.status,
          detail._tag === "Some" ? detail.value.error.code : undefined,
        ),
      );
    }
    const token = yield* S.decodeUnknownEffect(Protocol.IntegrationToken)(input).pipe(
      Effect.mapError((cause) =>
        failure(
          "exchangeCode",
          `Vercel token response did not match its API contract: ${cause.message}`,
          "response",
          response.status,
        ),
      ),
    );
    return {
      accessToken: Secret.make(token.access_token),
      context:
        token.team_id === null
          ? ({ _tag: "personal" } as const)
          : ({ _tag: "team", teamId: token.team_id } as const),
      installationId: token.installation_id ?? null,
      userId: token.user_id,
    };
  }),
);

function failure(
  operation: string,
  message: string,
  reason: DnsProvider.ErrorReason,
  status?: number,
  code?: string,
): DnsProvider.Error {
  return new DnsProvider.Error({
    ...(code === undefined ? {} : { code }),
    message,
    operation,
    providerId: "vercel",
    reason,
    ...(status === undefined ? {} : { status }),
  });
}
