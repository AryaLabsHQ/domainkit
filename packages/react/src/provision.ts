import { DnsRecord, type Receipt } from "domainkit";
import { useCallback } from "react";

import { pendingPlan, planOf, State, useAttempt, type Controller } from "./attempt.ts";
import { useDomainKit } from "./domain-kit.tsx";
import { Event } from "./events.ts";
import { requirementsKey } from "./records.ts";

export { pendingPlan, planOf, State };
export type { Controller };

export interface Options {
  readonly domain: string;
  readonly requirements: ReadonlyArray<DnsRecord.Model>;
  readonly onApplied?: (receipt: Receipt.Model) => void;
  /** Refuse every step. Defaults to the surrounding `readOnly`. */
  readonly readOnly?: boolean;
}

/**
 * Plan, approve, apply; `approve` authorizes the digest and applies it in the same action.
 * Requirements identify themselves by content, so an inline array does not abandon the attempt.
 * Every field counts: a plan turns on `policy`, and `ttl` and `purpose` ride the wire with it.
 */
const keyOf = (domain: string, requirements: ReadonlyArray<DnsRecord.Model>): string =>
  [domain, requirementsKey(requirements)].join("|");

export function useController({ domain, onApplied, readOnly, requirements }: Options): Controller {
  const { transport } = useDomainKit();
  const group = transport.provisioning;
  return useAttempt({
    domain,
    key: keyOf(domain, requirements),
    done: (receipt) => Event.Applied({ domain, receipt }),
    group,
    onDone: onApplied,
    readOnly,
    plan: useCallback(
      () => (group === undefined ? null : group.plan({ domain, requirements })),
      [domain, group, requirements],
    ),
  });
}
