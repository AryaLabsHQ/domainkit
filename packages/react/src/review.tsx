/**
 * The review surface both `Provision` and `Cleanup` render: what the plan will do, the Approve
 * and Decline actions D35 defines, and the outcome. `kind` picks the wording; nothing else about
 * the two flows differs on screen.
 */
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { Plan } from "domainkit";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

import type { Controller } from "./attempt.ts";
import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit, useReadOnly } from "./domain-kit.tsx";
import { outcome as describeOutcome } from "./messages.ts";
import * as OutcomeUi from "./outcome.tsx";
import * as Operations from "./operations.tsx";

export interface ReviewState extends Record<string, unknown> {
  readonly status: Controller["state"]["_tag"];
}

export interface KindProps {
  readonly controller: Controller;
  readonly kind: Plan.Kind;
}

const busy = (status: Controller["state"]["_tag"]): boolean =>
  status === "Planning" ||
  status === "Approving" ||
  status === "Applying" ||
  status === "Rejecting";

export interface StatusProps extends PartProps<"p", ReviewState>, KindProps {}

/** What the flow is doing right now, or what it finished doing. */
export function Status({ controller, kind, ...props }: StatusProps): ReactElement {
  const { messages } = useDomainKit();
  const state = controller.state;
  const text = (): string => {
    switch (state._tag) {
      case "Idle":
        return "";
      case "Planning":
        return kind === "provisioning" ? messages.planning : messages.planningCleanup;
      // What a plan is for is the dialog's own description; the status line is for progress, and
      // saying it twice under it is how the review read before the operations moved in.
      case "Planned":
        return "";
      case "Approving":
        return messages.approving;
      case "Applying":
        return kind === "provisioning" ? messages.applying : messages.cleaning;
      case "Rejecting":
        return messages.rejecting;
      case "Rejected":
        return messages.declinedBy(state.attempt.rejection?.actorId ?? "");
      // What an apply landed is an outcome, not a progress line: `Outcome` says it.
      case "Applied":
        return "";
      case "Failure":
        return "";
    }
  };
  return usePart(
    "p",
    props,
    { status: state._tag },
    {
      children: text(),
      "data-domainkit-part": kind === "provisioning" ? "provisioning-status" : "cleanup-status",
      "data-state": state._tag,
      role: busy(state._tag) ? "status" : undefined,
    },
  );
}

export interface OutcomeProps extends OutcomeUi.RootProps, KindProps {}

/**
 * How the attempt ended: a failure, a receipt that only partly landed, or one that landed whole.
 * Media, title, description, and the retry the flow allows. Children replace the composition and
 * keep the binding.
 */
export function Outcome({
  children,
  controller,
  kind,
  ...props
}: OutcomeProps): ReactElement | null {
  const { messages } = useDomainKit();
  const readOnly = useReadOnly();
  const state = controller.state;
  const retryPart = kind === "provisioning" ? "provisioning-retry" : "cleanup-retry";
  if (state._tag !== "Failure" && state._tag !== "Applied") return null;
  const partial = state._tag === "Applied" && state.receipt.status === "partial";
  const words =
    state._tag === "Failure"
      ? describeOutcome(state.error, messages)
      : partial
        ? {
            description:
              kind === "provisioning" ? messages.partiallyApplied : messages.partiallyCleaned,
            title:
              kind === "provisioning"
                ? messages.partiallyAppliedTitle
                : messages.partiallyCleanedTitle,
          }
        : {
            description: "",
            title:
              kind === "provisioning"
                ? messages.applied(state.receipt)
                : messages.cleaned(state.receipt),
          };
  return (
    <OutcomeUi.Provider
      value={{
        description: words.description,
        layout: props.layout ?? "card",
        retry: readOnly || state._tag !== "Failure" ? null : controller.retry,
        retryPart,
        title: words.title,
        tone: state._tag === "Failure" ? "danger" : partial ? "warning" : "success",
      }}
    >
      <OutcomeUi.Root {...props}>{children ?? <OutcomeUi.Composition />}</OutcomeUi.Root>
    </OutcomeUi.Provider>
  );
}

export interface ActionsProps extends PartProps<"div", ReviewState>, KindProps {}

/** What a plan would actually write: an operation blocked by a conflict is not one of them. */
const addable = (plan: Plan.Model | null): ReadonlyArray<Plan.Operation> =>
  plan === null ? [] : plan.operations.filter((operation) => operation._tag !== "Conflict");

/**
 * The primary action, and Decline. The primary authorizes the digest and applies it in one step,
 * so it says what it will do; where a conflict blocks part of a plan it approves the rest by id,
 * and where every operation is blocked it says what to fix instead. Neither renders until there is
 * a plan to act on.
 */
export function Actions({ controller, kind, ...props }: ActionsProps): ReactElement | null {
  const { messages } = useDomainKit();
  const readOnly = useReadOnly();
  const state = controller.state;
  const plan = state._tag === "Planned" ? state.plan : null;
  const running = busy(state._tag);
  const writes = addable(plan);
  const blocked = plan !== null && writes.length === 0;
  const element = usePart(
    "div",
    props,
    { status: state._tag },
    {
      children: (
        <>
          <button
            data-domainkit-part={kind === "provisioning" ? "plan-apply" : "cleanup-apply"}
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
            {kind === "provisioning" ? messages.addRecords(writes.length) : messages.approve}
          </button>
          {blocked ? (
            <p data-domainkit-part="plan-blocked">{messages.everyRecordConflicts}</p>
          ) : null}
          <button
            data-domainkit-part="plan-decline"
            disabled={running || plan === null}
            onClick={() => controller.reject()}
            type="button"
          >
            {messages.decline}
          </button>
        </>
      ),
      "data-domainkit-part": "review-actions",
    },
  );
  if (readOnly) return null;
  // Nothing to act on yet, or nothing left to act on: while a command runs the body carries the
  // progress, and an action that names a count it does not have yet would be lying about it.
  return plan === null ? null : element;
}

export interface BodyProps extends KindProps {}

/** The operations under review, or the reason there is nothing to review. */
export function Body({ controller, kind }: BodyProps): ReactElement {
  const { messages } = useDomainKit();
  const state = controller.state;
  const plan =
    state._tag === "Planned" ||
    state._tag === "Approving" ||
    state._tag === "Applying" ||
    state._tag === "Rejecting" ||
    state._tag === "Rejected"
      ? state.plan
      : state._tag === "Applied"
        ? state.plan
        : null;
  return (
    <div data-domainkit-part="dialog-body">
      <Status controller={controller} kind={kind} />
      {plan === null ? null : plan.operations.length === 0 ? (
        <p data-domainkit-part="plan-empty">{messages.noChanges}</p>
      ) : (
        <Operations.List plan={plan} />
      )}
      {state._tag === "Rejected" && state.attempt.rejection?.reason != null ? (
        <p data-domainkit-part="plan-decline-reason">
          {messages.declineReason(state.attempt.rejection.reason)}
        </p>
      ) : null}
      <Outcome controller={controller} kind={kind} />
    </div>
  );
}

export interface DialogProps extends KindProps {
  readonly children?: ReactNode;
  readonly onOpenChange?: (open: boolean) => void;
  readonly open?: boolean;
  /** Replace the dialog surface entirely: a drawer, an inline panel, a host modal. */
  readonly render?: (props: { readonly open: boolean; readonly children: ReactNode }) => ReactNode;
  readonly trigger?: ReactNode;
}

/** The review dialog. `render` swaps the surface; the contents stay the flow's. */
export function Dialog({
  children,
  controller,
  kind,
  onOpenChange,
  open,
  render,
  trigger,
}: DialogProps): ReactElement {
  const { colorScheme, messages, portalContainer, themeStyle } = useDomainKit();
  const readOnly = useReadOnly();
  const [uncontrolled, setUncontrolled] = useState(false);
  const isOpen = open ?? uncontrolled;
  const close = useRef<(next: boolean) => void>(() => {});
  close.current = (next: boolean) => {
    if (open === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };
  const setOpen = (next: boolean) => close.current(next);
  const state = controller.state;
  // An apply that landed whole is done being reviewed: the receipt reads on the page. A partial
  // one and a failure keep the surface, because there is still something to answer there.
  const landed = state._tag === "Applied" && state.receipt.status === "complete";
  useEffect(() => {
    if (landed) close.current(false);
  }, [landed]);
  const running = busy(controller.state._tag);
  const body = children ?? <Body controller={controller} kind={kind} />;
  const title = kind === "provisioning" ? messages.planTitle : messages.cleanupTitle;
  const label = trigger ?? (kind === "provisioning" ? messages.reviewChanges : messages.cleanUp);
  // Reviewing exists to authorize a write, so the whole surface goes rather than a dead trigger.
  if (readOnly) return <></>;
  if (render !== undefined) {
    return (
      <>
        <button
          data-domainkit-part={kind === "provisioning" ? "plan-trigger" : "cleanup-trigger"}
          onClick={() => {
            setOpen(true);
            controller.plan();
          }}
          type="button"
        >
          {label}
        </button>
        {render({ children: body, open: isOpen })}
      </>
    );
  }
  return (
    <BaseDialog.Root
      onOpenChange={(next, details) => {
        if (!next && running) {
          details.cancel();
          return;
        }
        setOpen(next);
      }}
      open={isOpen}
    >
      <BaseDialog.Trigger
        data-domainkit-part={kind === "provisioning" ? "plan-trigger" : "cleanup-trigger"}
        onClick={controller.plan}
      >
        {label}
      </BaseDialog.Trigger>
      <BaseDialog.Portal container={portalContainer}>
        <BaseDialog.Backdrop
          data-color-scheme={colorScheme}
          data-domainkit-part="dialog-backdrop"
          data-domainkit-root=""
          style={themeStyle}
        />
        <BaseDialog.Popup
          data-color-scheme={colorScheme}
          data-domainkit-part={kind === "provisioning" ? "plan-dialog" : "cleanup-dialog"}
          data-domainkit-root=""
          style={themeStyle}
        >
          <div data-domainkit-part="dialog-header">
            <div data-domainkit-part="dialog-heading">
              <BaseDialog.Title data-domainkit-part="dialog-title">{title}</BaseDialog.Title>
              <BaseDialog.Description data-domainkit-part="dialog-description">
                {kind === "provisioning" ? messages.planConsent : messages.cleanupConsent}
              </BaseDialog.Description>
            </div>
            {running ? null : (
              <BaseDialog.Close aria-label={messages.close} data-domainkit-part="dialog-close">
                ×
              </BaseDialog.Close>
            )}
          </div>
          {body}
          <div data-domainkit-part="dialog-footer">
            <Actions controller={controller} kind={kind} />
            {/*
             * The close in the header and a press outside already set a plan aside, so the footer
             * of a provisioning plan carries only the two decisions about the plan itself.
             */}
            {running || kind === "provisioning" ? null : (
              <BaseDialog.Close data-domainkit-part="dialog-cancel">
                {messages.cancel}
              </BaseDialog.Close>
            )}
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
