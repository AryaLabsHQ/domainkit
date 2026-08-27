import { Schema } from "effect";

export class Error extends Schema.TaggedError<Error>()("StorageError", {
  cause: Schema.optionalKey(Schema.Unknown),
  message: Schema.String,
  operation: Schema.String,
}) {}

export function fromCause(operation: string, cause: unknown): Error {
  return cause instanceof Error
    ? cause
    : new Error({
        cause,
        message: cause instanceof globalThis.Error ? cause.message : String(cause),
        operation,
      });
}
