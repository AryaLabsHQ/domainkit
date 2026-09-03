import { Config, Effect } from "effect";

import * as Errors from "./error.ts";
import * as Reason from "../Reason.ts";

/** Accept a literal or a `Config`; config failures surface as `InvalidInput` on `field`. */
export const resolve = <A>(
  value: A | Config.Config<A>,
  field: string,
): Effect.Effect<A, Errors.DomainKitError> =>
  Config.isConfig(value)
    ? value.pipe(
        Effect.mapError(
          (cause) =>
            new Errors.DomainKitError({
              reason: new Reason.InvalidInput({ message: cause.message, field }),
            }),
        ),
      )
    : Effect.succeed(value);
