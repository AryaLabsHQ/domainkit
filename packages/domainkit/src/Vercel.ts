/** Vercel: personal tokens and marketplace integrations. */
import { type Config, Effect, Redacted, Schema } from "effect";

import * as DomainKitError from "./DomainKitError.ts";
import * as DomainName from "./DomainName.ts";
import { resolve } from "./internal/config.ts";
import type { Fetch } from "./internal/http.ts";
import * as Client from "./internal/vercel/client.ts";
import type * as Protocol from "./internal/vercel/protocol.ts";
import * as Provider from "./Provider.ts";

/** `teamId` is `null` for a personal account; targets carry the team that owns the zone. */
export const TeamContext = Schema.Struct({ teamId: Schema.NullOr(Schema.String) });
export type TeamContext = typeof TeamContext.Type;

/** Token-method input: the access token, and a team id to scope the connection to one team. */
export const TokenFields = Schema.Struct({
  token: Schema.RedactedFromValue(Schema.String),
  teamId: Schema.optionalKey(Schema.String),
});

export interface Options {
  /** Omit to offer tokens only. */
  readonly integration?: {
    readonly clientId: string | Config.Config<string>;
    readonly clientSecret: Redacted.Redacted<string> | Config.Config<Redacted.Redacted<string>>;
    readonly slug: string;
  };
  readonly fetch?: Fetch;
  readonly baseUrl?: string;
}

const capabilities = ["dns:read", "dns:write"] as const;

export const provider = (options: Options = {}): Provider.Definition<TeamContext> => {
  const fetch = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://api.vercel.com").replace(/\/$/, "");
  const client = (token: string): Client.Options => ({ token, fetch, baseUrl });

  const targetOf = (domain: Protocol.Domain, label: string): Provider.Target => ({
    zone: domain.name,
    context: { teamId: domain.teamId } satisfies TeamContext,
    label: `${domain.name} (${label})`,
  });

  const integration =
    options.integration === undefined ? undefined : integrationAuth(options.integration);

  function integrationAuth(
    settings: NonNullable<Options["integration"]>,
  ): Provider.IntegrationAuth {
    return {
      label: "Install the Vercel integration",
      start: (input) => {
        const authorizationUrl = new URL(
          `https://vercel.com/integrations/${encodeURIComponent(settings.slug)}/new`,
        );
        authorizationUrl.searchParams.set("source", "external");
        authorizationUrl.searchParams.set("state", input.state);
        return Effect.succeed({ authorizationUrl: authorizationUrl.toString() });
      },
      complete: (input) =>
        Effect.gen(function* () {
          const clientId = yield* resolve(settings.clientId, "integration.clientId");
          const clientSecret = yield* resolve(settings.clientSecret, "integration.clientSecret");
          const token = yield* Client.exchangeCode({
            options: client(""),
            clientId,
            clientSecret: Redacted.value(clientSecret),
            code: input.code,
            callbackUrl: input.callbackUrl,
          });
          const callbackTeam = input.params.teamId;
          if (callbackTeam !== undefined && callbackTeam !== token.team_id) {
            return yield* DomainKitError.fail(
              new DomainKitError.Unauthenticated({
                message: "Vercel integration callback team does not match the installed team",
              }),
            );
          }
          return {
            secret: Redacted.make(token.access_token),
            context: { teamId: token.team_id } satisfies TeamContext,
            expiresAt: null,
          };
        }),
    };
  }

  return Provider.make<TeamContext>({
    id: "vercel",
    name: "Vercel",
    context: TeamContext,
    auth: {
      token: Provider.tokenAuth({
        label: "Access token",
        docsUrl: "https://vercel.com/account/settings/tokens",
        requiredCapabilities: capabilities,
        fields: TokenFields,
        authenticate: ({ token, teamId }) =>
          Client.user(client(Redacted.value(token))).pipe(
            Effect.map(() => ({
              secret: token,
              context: { teamId: teamId ?? null } satisfies TeamContext,
              expiresAt: null,
            })),
          ),
      }),
      ...(integration === undefined ? {} : { integration }),
    },
    session: (credential) => {
      const clientOptions = client(Redacted.value(credential.secret));
      const context = Schema.decodeUnknownOption(TeamContext)(credential.context);
      const teamId = context._tag === "Some" ? context.value.teamId : null;
      const listTargets = (): Effect.Effect<
        ReadonlyArray<Provider.Target>,
        DomainKitError.DomainKitError
      > =>
        teamId !== null
          ? Client.zones(clientOptions, teamId).pipe(
              Effect.map((domains) => domains.map((domain) => targetOf(domain, teamId))),
            )
          : Effect.gen(function* () {
              const personal = yield* Client.zones(clientOptions, null);
              const teams = yield* Client.teams(clientOptions).pipe(
                Effect.catchIf(
                  (error) => error.reason._tag !== "ProviderUnavailable",
                  () => Effect.succeed([]),
                ),
              );
              const perTeam = yield* Effect.forEach(teams, (team) =>
                Client.zones(clientOptions, team.id).pipe(
                  Effect.map((domains) =>
                    domains.map((domain) => targetOf(domain, team.name ?? team.slug)),
                  ),
                ),
              );
              return [...personal.map((domain) => targetOf(domain, "personal")), ...perTeam.flat()];
            });
      return {
        capabilities: () => Effect.succeed(capabilities),
        listTargets,
        resolveTarget: (domain) =>
          Effect.gen(function* () {
            const name = yield* DomainName.decode(domain);
            const targets = yield* listTargets();
            return Provider.resolveAmong(name, targets);
          }),
        dns: (target) => {
          const scope = Schema.decodeUnknownOption(TeamContext)(target.context);
          return Client.dns(clientOptions, scope._tag === "Some" ? scope.value.teamId : teamId);
        },
      };
    },
  });
};
