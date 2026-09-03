import { DnsRecord, type Receipt } from "domainkit";
import { useCallback, type ReactElement, type ReactNode } from "react";

import { State, useAttempt, type Controller } from "./attempt.ts";
import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import { Event } from "./events.ts";
import * as Records from "./records.tsx";
import * as Review from "./review.tsx";

export { State };
export type { Controller };

export interface Options {
  readonly domain: string;
  readonly requirements: ReadonlyArray<DnsRecord.Model>;
  readonly onApplied?: (receipt: Receipt.Model) => void;
}

/** Plan, approve, apply. `approve` authorizes the digest and applies it in the same action. */
/**
 * Requirements identify themselves by content, so an inline array does not abandon the attempt.
 * Every field counts: a plan turns on `policy`, and `ttl` and `purpose` ride the wire with it.
 */
const keyOf = (domain: string, requirements: ReadonlyArray<DnsRecord.Model>): string =>
  [domain, Records.requirementsKey(requirements)].join("|");

export function useController({ domain, onApplied, requirements }: Options): Controller {
  const { transport } = useDomainKit();
  const group = transport.provisioning;
  return useAttempt({
    domain,
    key: keyOf(domain, requirements),
    done: (receipt) => Event.Applied({ domain, receipt }),
    group,
    onDone: onApplied,
    plan: useCallback(
      () => (group === undefined ? null : group.plan({ domain, requirements })),
      [domain, group, requirements],
    ),
  });
}

export interface RootState extends Record<string, unknown> {
  readonly status: State["_tag"];
}

export interface RootProps extends PartProps<"div", RootState> {
  readonly controller: Controller;
}

export function Root({ controller, ...props }: RootProps): ReactElement {
  return usePart(
    "div",
    props,
    { status: controller.state._tag },
    { "data-domainkit-part": "provisioning-flow", "data-state": controller.state._tag },
  );
}

export interface DialogProps extends Omit<Review.DialogProps, "kind"> {}

export function Dialog(props: DialogProps): ReactElement {
  return <Review.Dialog {...props} kind="provisioning" />;
}

export interface ActionsProps extends Omit<Review.ActionsProps, "kind"> {}

/** Approve and Decline for a plan already under review. */
export function Actions(props: ActionsProps): ReactElement | null {
  return <Review.Actions {...props} kind="provisioning" />;
}

export interface OutcomeProps extends Omit<Review.OutcomeProps, "kind"> {}

export function Outcome(props: OutcomeProps): ReactElement | null {
  return <Review.Outcome {...props} kind="provisioning" />;
}

export interface StatusProps extends Omit<Review.StatusProps, "kind"> {}

export function Status(props: StatusProps): ReactElement {
  return <Review.Status {...props} kind="provisioning" />;
}

export interface FlowProps extends Omit<RootProps, "controller"> {
  readonly domain: string;
  readonly onApplied?: (receipt: Receipt.Model) => void;
  readonly requirements: ReadonlyArray<DnsRecord.Model>;
  readonly trigger?: ReactNode;
}

/** Provisioning on its own: a trigger that plans, then the review dialog. */
export function Flow({ domain, onApplied, requirements, trigger, ...props }: FlowProps) {
  const controller = useController({
    domain,
    requirements,
    ...(onApplied === undefined ? {} : { onApplied }),
  });
  return (
    <Root controller={controller} {...props}>
      <Dialog controller={controller} {...(trigger === undefined ? {} : { trigger })} />
      <Outcome controller={controller} />
    </Root>
  );
}
