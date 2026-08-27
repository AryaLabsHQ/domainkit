import { Schema } from "effect";

/** Input failed DomainKit's public schema or normalization rules. */
export class InvalidInputError extends Schema.TaggedError<InvalidInputError>()(
  "InvalidInputError",
  {
    message: Schema.String,
  },
) {}
