import { DnsRecord, type Receipt } from "domainkit";
import { useCallback, useState, type ReactElement, type ReactNode } from "react";

import { State, useAttempt, type Controller } from "./attempt.ts";
import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit, useReadOnly } from "./domain-kit.tsx";
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

export interface ActionProps extends PartProps<"div", RootState> {
  readonly controller: Controller;
}

/**
 * The one action a plan needs: it names what it will add, authorizes the digest, and applies it in
 * the same press. Where a conflict blocks part of a plan it approves the rest by id; where every
 * operation is blocked it says what to fix instead. The outcome sits under it, so an apply that
 * failed is answered where it was started.
 */
export function Action({ controller, ...props }: ActionProps): ReactElement | null {
  const { messages } = useDomainKit();
  const readOnly = useReadOnly();
  const state = controller.state;
  const plan = state._tag === "Planned" ? state.plan : null;
  const running = state._tag === "Approving" || state._tag === "Applying";
  // A conflict is not a write, so it never counts towards what the button says it will add.
  const writes =
    plan === null ? [] : plan.operations.filter((operation) => operation._tag !== "Conflict");
  const blocked = plan !== null && writes.length === 0;
  const element = usePart(
    "div",
    props,
    { status: state._tag },
    {
      children: (
        <>
          {plan === null && !running ? null : (
            <button
              data-domainkit-part="plan-action"
              disabled={running || plan === null || writes.length === 0}
              onClick={() =>
                // Naming the ids is what leaves a conflict out; approving the whole plan would not.
                controller.approve(
                  writes.length === plan?.operations.length
                    ? undefined
                    : writes.map((operation) => operation.id),
                )
              }
              type="button"
            >
              {running ? messages.applying : messages.addRecords(writes.length)}
            </button>
          )}
          {blocked ? (
            <p data-domainkit-part="plan-blocked">{messages.everyRecordConflicts}</p>
          ) : null}
          <Outcome controller={controller} layout="inline" />
        </>
      ),
      "data-domainkit-part": "plan-actions",
    },
  );
  // Every press here starts a write, and a count the flow does not have yet would be a claim it
  // cannot make: nothing renders until there is a plan to act on or an outcome to report.
  if (readOnly) return null;
  const reporting = state._tag === "Applied" || state._tag === "Failure";
  return plan === null && !running && !reporting ? null : element;
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
  // The dialog carries its own outcome, so the one on the page is for after it closes.
  const [open, setOpen] = useState(false);
  return (
    <Root controller={controller} {...props}>
      <Dialog
        controller={controller}
        onOpenChange={setOpen}
        open={open}
        {...(trigger === undefined ? {} : { trigger })}
      />
      {open ? null : <Outcome controller={controller} />}
    </Root>
  );
}
