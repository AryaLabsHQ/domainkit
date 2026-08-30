import { Effect, Schema as S } from "effect";

import * as DomainName from "../../src/domain/domain-name.ts";

const NonEmptyString = S.String.check(S.isMinLength(1));

export const Command = S.Literals(["preview", "apply"]);
export type Command = typeof Command.Type;

export const Fields = {
  allowedRecordName: DomainName.Schema,
  allowedZone: DomainName.Schema,
  approvedDigest: S.NullOr(NonEmptyString),
  command: Command,
  recordName: DomainName.Schema,
  recordValue: NonEmptyString,
  zone: DomainName.Schema,
} as const;

export class Error extends S.TaggedError<Error>()("LiveConfigError", {
  message: S.String,
}) {}

export interface Common {
  readonly allowedRecordName: DomainName.DomainName;
  readonly allowedZone: DomainName.DomainName;
  readonly approvedDigest: string | null;
  readonly command: Command;
  readonly recordName: DomainName.DomainName;
  readonly recordValue: string;
  readonly zone: DomainName.DomainName;
}

export const validate = Effect.fn("LiveConfig.validate")((config: Common) =>
  Effect.gen(function* () {
    if (config.zone !== config.allowedZone) {
      return yield* new Error({ message: "DOMAINKIT_LIVE_ALLOW_ZONE must exactly match the zone" });
    }
    if (config.recordName !== config.allowedRecordName) {
      return yield* new Error({
        message: "DOMAINKIT_LIVE_ALLOW_RECORD_NAME must exactly match the record name",
      });
    }
    if (config.recordName !== config.zone && !config.recordName.endsWith(`.${config.zone}`)) {
      return yield* new Error({ message: "The live record must belong to the configured zone" });
    }
    if (config.command === "apply" && config.approvedDigest === null) {
      return yield* new Error({
        message: "DOMAINKIT_LIVE_APPROVED_DIGEST is required for apply",
      });
    }
    return config;
  }),
);

export const input = (command: string | undefined, environment: NodeJS.ProcessEnv) => ({
  allowedRecordName: environment.DOMAINKIT_LIVE_ALLOW_RECORD_NAME,
  allowedZone: environment.DOMAINKIT_LIVE_ALLOW_ZONE,
  approvedDigest: environment.DOMAINKIT_LIVE_APPROVED_DIGEST ?? null,
  command,
  recordName: environment.DOMAINKIT_LIVE_RECORD_NAME,
  recordValue: environment.DOMAINKIT_LIVE_RECORD_VALUE,
  zone: environment.DOMAINKIT_LIVE_ZONE,
});

export const decode = <Schema extends S.Constraint & S.Schema<Common>>(schema: Schema) =>
  Effect.fn("LiveConfig.decode")((value: unknown) =>
    S.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError((cause) => new Error({ message: cause.message })),
      Effect.flatMap((config) => validate(config).pipe(Effect.as(config))),
    ),
  );
