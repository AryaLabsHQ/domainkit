import { Effect, Schema as S } from "effect";

import { DomainName, Reason } from "../../src/index.ts";
import * as Errors from "../../src/internal/error.ts";

const NonEmpty = S.String.check(S.isMinLength(1));

/**
 * Live runs write real records under the conformance prefix, so the zone must be allow-listed
 * twice: once as the target and once as the explicit permission.
 */
export const Fields = {
  allowedZone: DomainName.Model,
  token: NonEmpty,
  zone: DomainName.Model,
} as const;

export const decode = <
  Schema extends S.ConstraintDecoder<{ readonly zone: string; readonly allowedZone: string }>,
>(
  schema: Schema,
) =>
  Effect.fn("LiveConfig.decode")((value: unknown) =>
    Errors.decode(schema, value).pipe(
      Effect.flatMap((config) =>
        config.zone === config.allowedZone
          ? Effect.succeed(config)
          : Errors.fail(
              new Reason.InvalidInput({
                message: "DOMAINKIT_LIVE_ALLOW_ZONE must exactly match DOMAINKIT_LIVE_ZONE",
                field: "allowedZone",
              }),
            ),
      ),
    ),
  );

export const input = (environment: NodeJS.ProcessEnv) => ({
  allowedZone: environment.DOMAINKIT_LIVE_ALLOW_ZONE,
  zone: environment.DOMAINKIT_LIVE_ZONE,
});
