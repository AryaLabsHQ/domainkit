/**
 * What a flow says when a step ends badly: a heading the customer reads first, then what to do
 * about it. Both come from the catalog, chosen by the error's reason, so nothing renders a tag,
 * a status literal, or a reason name.
 *
 *   const describe = Outcome.useDescribe();
 *   const words = describe(error, { provider: "Cloudflare" });
 */
import type { DomainKit } from "domainkit";

import { useMessages } from "./domain-kit.tsx";
import type { Catalog, Outcome, OutcomeContext } from "./messages.ts";
import { outcome } from "./messages.ts";

export type { Outcome, OutcomeContext };

/** The catalog's title and description for one failure. */
export const describe = (
  error: DomainKit.Error,
  catalog: Catalog,
  context: OutcomeContext = {},
): Outcome => outcome(error, catalog, context);

/**
 * `describe` bound to the catalog `DomainKit.Root` holds. The reason alone cannot name the
 * provider a customer typed a token for, so the surface supplies it in the context.
 */
export function useDescribe(): (error: DomainKit.Error, context?: OutcomeContext) => Outcome {
  const messages = useMessages();
  return (error, context = {}) => outcome(error, messages, context);
}
