import { Effect, Schema as S } from "effect";

import { Error as InvalidInputError } from "../invalid-input.ts";

export const Capability = S.Literals(["dns:read", "dns:write"]);
export type Capability = typeof Capability.Type;

/** A provider credential authorization shared by one or more owner connections. */
export const Schema = S.Struct({
  accountId: S.String,
  capabilities: S.Array(Capability),
  createdAt: S.DateFromString,
  expiresAt: S.NullOr(S.DateFromString),
  id: S.String,
  kind: S.Literals(["oauth2", "token"]),
  providerId: S.String,
  scopes: S.Array(S.String),
  subjectId: S.String,
});
export interface ProviderAuthorization extends S.Schema.Type<typeof Schema> {}

export const decode = Effect.fn("ProviderAuthorization.decode")((input: unknown) =>
  S.decodeUnknownEffect(Schema)(input).pipe(
    Effect.mapError((cause) => new InvalidInputError({ message: cause.message })),
  ),
);

export const validate = Effect.fn("ProviderAuthorization.validate")((input: unknown) =>
  S.decodeUnknownEffect(S.toType(Schema))(input).pipe(
    Effect.mapError((cause) => new InvalidInputError({ message: cause.message })),
  ),
);

export const encode = S.encodeSync(Schema);
