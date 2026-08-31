import { Clock, Effect, Schema as S } from "effect";

import * as Connection from "../../auth/connect.ts";
import * as ProviderAuthorization from "../../auth/authorization.ts";
import type * as ProviderAuth from "../../auth/manifest.ts";
import * as ProviderContext from "../../auth/provider-context.ts";
import * as Secret from "../../auth/secret.ts";
import * as DnsProvider from "../../provider/provider.ts";
import * as ProviderSession from "../../provider/session.ts";
import * as Client from "./client.ts";
import * as Protocol from "./protocol.ts";

const Context = S.TaggedUnion({
  personal: { installationId: S.NullOr(S.String) },
  team: { installationId: S.NullOr(S.String), teamId: S.String },
});
export type Context = typeof Context.Type;
export const contextCodec = ProviderContext.codec("vercel.v1", Context);

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
  /** Configuration ID returned by Vercel's integration callback, when available. */
  readonly configurationId?: string;
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
      installationId: token.installation_id ?? options.configurationId ?? null,
      userId: token.user_id,
    };
  }),
);

export interface TokenConnectionOptions extends Omit<Client.Options, "token"> {
  readonly token: Secret.Value;
}

/** Creates a provider-independent token connection method backed by Vercel validation. */
export function tokenConnectionMethod(
  options: TokenConnectionOptions,
): Extract<Connection.Method, { readonly _tag: "Token" }> {
  const requiredCapabilities = [...options.capabilities];
  return Connection.Method.Token({
    authenticate: Effect.fn("VercelAuth.authenticateToken")(function* (token) {
      const validated = yield* Client.make({ ...options, token }).validateToken();
      const observedAt = new Date(yield* Clock.currentTimeMillis);
      return {
        capabilityEvidence: validated.capabilities.map((capability) => ({
          capability,
          evidence: ProviderAuthorization.Evidence.Introspected({ observedAt }),
        })),
        credential: {
          accessToken: token,
          expiresAt: validated.expiresAt,
          refreshToken: null,
          tokenType: "bearer",
        },
        providerAccountId: validated.accountId,
        providerContext: yield* contextCodec.encode(
          options.context._tag === "team"
            ? { _tag: "team", installationId: null, teamId: options.context.teamId }
            : { _tag: "personal", installationId: null },
        ),
        scopes: [...validated.scopes],
      } satisfies Connection.Authentication;
    }),
    providerId: "vercel",
    requiredCapabilities,
    token: options.token,
  });
}

/** Converts a completed Vercel Integration exchange into canonical connection authentication. */
export const integrationAuthentication = Effect.fn("VercelAuth.integrationAuthentication")(
  function* (
    options: ExchangeCodeOptions & {
      readonly capabilities: ReadonlyArray<ProviderAuthorization.Capability>;
    },
  ) {
    const exchanged = yield* exchangeCode(options);
    const observedAt = new Date(yield* Clock.currentTimeMillis);
    return {
      capabilityEvidence: options.capabilities.map((capability) => ({
        capability,
        evidence: ProviderAuthorization.Evidence.Introspected({ observedAt }),
      })),
      credential: {
        accessToken: exchanged.accessToken,
        expiresAt: null,
        refreshToken: null,
        tokenType: "bearer",
      },
      providerAccountId:
        exchanged.context._tag === "team" ? exchanged.context.teamId : exchanged.userId,
      providerContext: yield* contextCodec.encode(
        exchanged.context._tag === "team"
          ? {
              _tag: "team",
              installationId: exchanged.installationId,
              teamId: exchanged.context.teamId,
            }
          : { _tag: "personal", installationId: exchanged.installationId },
      ),
      scopes: [],
    } satisfies Connection.Authentication;
  },
);

/** Restore a credential-scoped Vercel session from persisted authorization state. */
export function restore(
  options: ProviderSession.RestoreInput & Pick<Client.Options, "baseUrl" | "fetch">,
): Effect.Effect<Client.Interface, DnsProvider.Error> {
  return Effect.gen(function* () {
    if (options.authorization.providerId !== "vercel") {
      return yield* Effect.fail(
        failure("restore", "Provider authorization belongs to another provider", "authorization"),
      );
    }
    if (options.authorization.revocation._tag !== "Active") {
      return yield* Effect.fail(
        failure("restore", "Vercel authorization is pending revocation", "authorization"),
      );
    }
    const missingCapability = options.authorization.requiredCapabilities.find(
      (capability) =>
        !options.authorization.capabilityEvidence.some((item) => item.capability === capability),
    );
    if (missingCapability !== undefined) {
      return yield* Effect.fail(
        failure(
          "restore",
          `Vercel authorization lacks evidence for ${missingCapability}`,
          "authorization",
        ),
      );
    }
    if (
      options.credential.expiresAt !== null &&
      (Number.isNaN(options.credential.expiresAt.valueOf()) ||
        options.credential.expiresAt <= new Date())
    ) {
      return yield* Effect.fail(
        failure("restore", "Vercel authorization has expired", "authentication"),
      );
    }
    const context = yield* contextCodec
      .decode(options.authorization.providerContext)
      .pipe(Effect.mapError((cause) => failure("restore", cause.message, "response")));
    return Client.make({
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      capabilities: options.authorization.capabilityEvidence.map(({ capability }) => capability),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      context:
        context._tag === "team" ? { _tag: "team", teamId: context.teamId } : { _tag: "personal" },
      token: options.credential.accessToken,
    });
  });
}

export interface IntegrationFlowOptions
  extends Omit<ExchangeCodeOptions, "code">, IntegrationMethodOptions {}

/** Creates Vercel Integration's implementation of the common interactive connection capability. */
export function integrationFlow(options: IntegrationFlowOptions): Connection.InteractiveFlow {
  const method = integrationMethod(options);
  const Payload = S.fromJsonString(S.Struct({ state: S.String }));
  return {
    complete: Effect.fn("VercelAuth.integrationFlow.complete")(function* (payload, callbackUrl) {
      const continuation = yield* S.decodeUnknownEffect(Payload)(payload.expose()).pipe(
        Effect.mapError(
          () =>
            new Connection.Error({
              category: "authorization",
              message: "Vercel Integration continuation payload is invalid",
              operation: "VercelAuth.integrationFlow.complete",
              retry: "after-user-action",
            }),
        ),
      );
      const code = callbackUrl.searchParams.get("code");
      const configurationId = callbackUrl.searchParams.get("configurationId");
      if (
        callbackUrl.searchParams.get("state") !== continuation.state ||
        code === null ||
        configurationId === null
      ) {
        return yield* new Connection.Error({
          category: "authorization",
          message: "Vercel Integration callback does not match its continuation",
          operation: "VercelAuth.integrationFlow.complete",
          retry: "after-user-action",
        });
      }
      const authentication = yield* integrationAuthentication({
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
        capabilities: options.capabilities,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        code: Secret.make(code),
        configurationId,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        redirectUri: options.redirectUri,
      });
      const callbackTeamId = callbackUrl.searchParams.get("teamId");
      if (callbackTeamId !== null) {
        const context = yield* contextCodec.decode(authentication.providerContext).pipe(
          Effect.mapError(
            (cause) =>
              new Connection.Error({
                category: "provider",
                message: cause.message,
                operation: "VercelAuth.integrationFlow.complete",
                retry: "unknown",
              }),
          ),
        );
        if (context._tag !== "team" || context.teamId !== callbackTeamId) {
          return yield* new Connection.Error({
            category: "authorization",
            message: "Vercel Integration callback team does not match the exchanged installation",
            operation: "VercelAuth.integrationFlow.complete",
            retry: "after-user-action",
          });
        }
      }
      return authentication;
    }),
    method: "integration",
    providerId: "vercel",
    requiredCapabilities: [...options.capabilities],
    start: (continuationId) => {
      const authorizationUrl = new URL(method.installUrl);
      authorizationUrl.searchParams.set("source", "external");
      authorizationUrl.searchParams.set("state", continuationId);
      return Effect.succeed({
        authorizationUrl,
        payload: Secret.make(JSON.stringify({ state: continuationId })),
      });
    },
  };
}

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
