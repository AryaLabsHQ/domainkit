import { DomainKit, Reason, Receipt } from "domainkit";
import * as Effect from "effect/Effect";
import { useCallback } from "react";

import { pendingPlan, planOf, State, useAttempt, type Controller } from "./attempt.ts";
import { useDomainKit } from "./domain-kit.tsx";
import { Event } from "./events.ts";

export { pendingPlan, planOf, State };
export type { Controller };

export interface Options {
  readonly domain: string;
  /** Which apply to undo. Without it, the domain's latest provisioning receipt. */
  readonly receiptId?: Receipt.ReceiptId;
  readonly onCleaned?: (receipt: Receipt.Model) => void;
}

/**
 * Cleanup is bound to a receipt: it removes only what an apply proved DomainKit created. When the
 * host does not name one, the controller reads the domain's latest from the snapshot.
 */
export function useController({ domain, onCleaned, receiptId }: Options): Controller {
  const { transport } = useDomainKit();
  const group = transport.cleanup;
  const connection = transport.connection;
  return useAttempt({
    domain,
    key: [domain, receiptId ?? ""].join("|"),
    done: (receipt) => Event.Cleaned({ domain, receipt }),
    group,
    onDone: onCleaned,
    plan: useCallback(() => {
      if (group === undefined) return null;
      if (receiptId !== undefined) return group.plan(receiptId);
      if (connection === undefined) return null;
      return Effect.flatMap(connection.inspect(domain), (snapshot) =>
        snapshot.lastReceiptId === null
          ? Effect.fail(
              new DomainKit.Error({
                reason: new Reason.NotFound({ entity: "receipt", id: snapshot.domain }),
              }),
            )
          : group.plan(Receipt.ReceiptId.make(snapshot.lastReceiptId)),
      );
    }, [connection, domain, group, receiptId]),
  });
}
