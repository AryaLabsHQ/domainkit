import { Config, Effect } from "effect";

import * as DomainKitError from "../DomainKitError.ts";

/** Accept a literal or a `Config`; config failures surface as `InvalidInput` on `field`. */
export const resolve = <A>(
  value: A | Config.Config<A>,
  field: string,
): Effect.Effect<A, DomainKitError.DomainKitError> =>
  Config.isConfig(value)
    ? value.pipe(
        Effect.mapError(
          (cause) =>
            new DomainKitError.DomainKitError({
              reason: new DomainKitError.InvalidInput({ message: cause.message, field }),
            }),
        ),
      )
    : Effect.succeed(value);
