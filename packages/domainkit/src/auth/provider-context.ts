import { Effect, Schema } from "effect";

import { Error as InvalidInputError } from "../invalid-input.ts";

/** A provider-owned, versioned, non-secret context value persisted by the host. */
export const Envelope = Schema.Struct({
  value: Schema.Json,
  version: Schema.String,
});
export interface Envelope extends Schema.Schema.Type<typeof Envelope> {}

export interface Codec<A> {
  readonly decode: (envelope: Envelope) => Effect.Effect<A, InvalidInputError>;
  readonly encode: (value: A) => Effect.Effect<Envelope, InvalidInputError>;
  readonly version: string;
}

/** Build an adapter-owned context codec from a schema and stable version identifier. */
export function codec<A, I>(version: string, schema: Schema.Codec<A, I>): Codec<A> {
  return {
    decode: Effect.fn("ProviderContext.decode")((envelope) =>
      envelope.version !== version
        ? Effect.fail(
            new InvalidInputError({
              message: `Unsupported provider context version: ${envelope.version}`,
            }),
          )
        : Schema.decodeUnknownEffect(schema)(envelope.value).pipe(
            Effect.mapError((cause) => new InvalidInputError({ message: cause.message })),
          ),
    ),
    encode: Effect.fn("ProviderContext.encode")((value) =>
      Schema.encodeEffect(schema)(value).pipe(
        Effect.flatMap((encoded) => Schema.decodeUnknownEffect(Schema.Json)(encoded)),
        Effect.map((encoded) => ({ value: encoded, version })),
        Effect.mapError((cause) => new InvalidInputError({ message: cause.message })),
      ),
    ),
    version,
  };
}

export const decode = Effect.fn("ProviderContext.Envelope.decode")((input: unknown) =>
  Schema.decodeUnknownEffect(Envelope)(input).pipe(
    Effect.mapError((cause) => new InvalidInputError({ message: cause.message })),
  ),
);

export const encode = Schema.encodeSync(Envelope);
