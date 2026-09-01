import { Data, Effect, Schema as S } from "effect";

import { Error as InvalidInputError } from "../invalid-input.ts";
import * as ProviderContext from "./provider-context.ts";

export const Capability = S.Literals(["dns:read", "dns:write"]);
export type Capability = typeof Capability.Type;

export type Evidence = Data.TaggedEnum<{
  Declared: {};
  Exercised: { readonly observedAt: Date };
  Introspected: { readonly observedAt: Date };
}>;
export const Evidence = Data.taggedEnum<Evidence>();

export const EvidenceSchema = S.TaggedUnion({
  Declared: {},
  Exercised: { observedAt: S.DateFromString },
  Introspected: { observedAt: S.DateFromString },
});

export const CapabilityEvidence = S.Struct({
  capability: Capability,
  evidence: EvidenceSchema,
});
export interface CapabilityEvidence extends S.Schema.Type<typeof CapabilityEvidence> {}

const RevocationSchema = S.TaggedUnion({
  Active: {},
  Pending: { requestedAt: S.DateFromString },
});
/** Revocation state schema and callable constructors for trusted lifecycle values. */
export const Revocation = {
  Schema: RevocationSchema,
  Active: () => RevocationSchema.cases.Active.make({}),
  Pending: (input: Parameters<typeof RevocationSchema.cases.Pending.make>[0]) =>
    RevocationSchema.cases.Pending.make(input),
};
export type Revocation = typeof RevocationSchema.Type;

/** A provider credential authorization shared by one or more organization connections. */
export const Schema = S.Struct({
  authorizedById: S.String,
  capabilityEvidence: S.Array(CapabilityEvidence),
  createdAt: S.DateFromString,
  id: S.String,
  method: S.Literals(["integration", "oauth2", "token"]),
  providerContext: ProviderContext.Envelope,
  providerId: S.String,
  requiredCapabilities: S.Array(Capability),
  revocation: Revocation.Schema,
  scopes: S.Array(S.String),
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

export function evidenceFor(
  authorization: ProviderAuthorization,
  capability: Capability,
): Evidence | undefined {
  return authorization.capabilityEvidence.find((item) => item.capability === capability)?.evidence;
}
