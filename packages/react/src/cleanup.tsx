import { DomainKit, Reason, Receipt } from "domainkit";
import * as Effect from "effect/Effect";
import { useCallback, useState, type ReactElement, type ReactNode } from "react";

import { State, useAttempt, type Controller } from "./attempt.ts";
import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import { Event } from "./events.ts";
import * as Review from "./review.tsx";

export { State };
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
    { "data-domainkit-part": "cleanup-flow", "data-state": controller.state._tag },
  );
}

export interface DialogProps extends Omit<Review.DialogProps, "kind"> {}

export function Dialog(props: DialogProps): ReactElement {
  return <Review.Dialog {...props} kind="cleanup" />;
}

export interface ActionsProps extends Omit<Review.ActionsProps, "kind"> {}

export function Actions(props: ActionsProps): ReactElement | null {
  return <Review.Actions {...props} kind="cleanup" />;
}

export interface OutcomeProps extends Omit<Review.OutcomeProps, "kind"> {}

export function Outcome(props: OutcomeProps): ReactElement | null {
  return <Review.Outcome {...props} kind="cleanup" />;
}

export interface StatusProps extends Omit<Review.StatusProps, "kind"> {}

export function Status(props: StatusProps): ReactElement {
  return <Review.Status {...props} kind="cleanup" />;
}

export interface FlowProps extends Omit<RootProps, "controller"> {
  readonly domain: string;
  readonly onCleaned?: (receipt: Receipt.Model) => void;
  readonly receiptId?: Receipt.ReceiptId;
  readonly trigger?: ReactNode;
}

/** Cleanup on its own: a trigger that plans the removal, then the same review dialog. */
export function Flow({ domain, onCleaned, receiptId, trigger, ...props }: FlowProps) {
  const controller = useController({
    domain,
    ...(onCleaned === undefined ? {} : { onCleaned }),
    ...(receiptId === undefined ? {} : { receiptId }),
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
