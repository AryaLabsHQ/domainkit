import { Schema } from "effect";

export class Error extends Schema.TaggedError<Error>()("InvalidInputError", {
  message: Schema.String,
}) {}
