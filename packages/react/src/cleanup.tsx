import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Transport } from "domainkit";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo, useRef, type ReactElement } from "react";

import { failureFromError, type Failure } from "./atom.ts";
import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import { Event as LifecycleEvent } from "./lifecycle.ts";
import * as Operations from "./operations.tsx";

type LocalState = Data.TaggedEnum<{
  Cleaned: { readonly result: Extract<Transport.CleanupResult, { readonly _tag: "Cleaned" }> };
  Cleaning: { readonly plan: Transport.CleanupPlan };
  Idle: {};
  Partial: { readonly result: Extract<Transport.CleanupResult, { readonly _tag: "Partial" }> };
  Planning: {};
  Review: { readonly plan: Transport.CleanupPlan };
}>;
export const State = Data.taggedEnum<LocalState>();
export type State =
  | LocalState
  | Extract<Transport.CleanupResult, { readonly _tag: "Stale" }>
  | Failure;

export type Command = Data.TaggedEnum<{
  Apply: {};
  Dismiss: {};
  Plan: {};
}>;
export const Command = Data.taggedEnum<Command>();

export interface Model {
  readonly command: Atom.AtomResultFn<Command, void>;
  readonly state: Atom.Atom<State>;
}

export interface Controller {
  readonly apply: () => void;
  readonly dismiss: () => void;
  readonly plan: () => void;
  readonly retry: () => void;
  readonly state: State;
}

export type Completion = Extract<Transport.CleanupResult, { readonly _tag: "Cleaned" | "Partial" }>;

export function useModel(
  connection: Transport.Connected,
  receiptId: string,
  onCleaned?: (result: Completion) => void,
): Model {
  const { emit, runtime } = useDomainKit();
  const onCleanedRef = useRef(onCleaned);
  onCleanedRef.current = onCleaned;
  return useMemo(() => {
    const state = Atom.make<State>(State.Idle());
    const execute = runtime.fn<Command>()((command, get) => {
      const current = get(state);
      if (command._tag === "Dismiss") {
        if (current._tag === "Planning" || current._tag === "Cleaning") return Effect.void;
        get.set(state, State.Idle());
        return Effect.void;
      }
      if (command._tag === "Plan") {
        if (current._tag === "Planning" || current._tag === "Cleaning") return Effect.void;
        get.set(state, State.Planning());
        return Effect.flatMap(Transport.Service, (transport) =>
          transport.cleanup.plan({
            attachmentId: connection.attachment.id,
            domain: connection.attachment.domain,
            receiptId,
          }),
        ).pipe(
          Effect.tap((plan) => Effect.sync(() => get.set(state, State.Review({ plan })))),
          Effect.catch((error) => Effect.sync(() => get.set(state, failureFromError(error)))),
          Effect.asVoid,
        );
      }
      if (
        current._tag !== "Review" ||
        current.plan.operations.some((operation) => operation._tag === "Blocked")
      )
        return Effect.void;
      const plan = current.plan;
      get.set(state, State.Cleaning({ plan }));
      return Effect.flatMap(Transport.Service, (transport) =>
        transport.cleanup.apply({
          attachmentId: connection.attachment.id,
          domain: connection.attachment.domain,
          planDigest: plan.digest,
          receiptId,
        }),
      ).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (result._tag === "Cleaned") {
              get.set(state, State.Cleaned({ result }));
              onCleanedRef.current?.(result);
              emit(LifecycleEvent.RecordsCleaned({ connection, result }));
            } else if (result._tag === "Partial") {
              get.set(state, State.Partial({ result }));
              onCleanedRef.current?.(result);
              emit(LifecycleEvent.RecordsPartiallyCleaned({ connection, result }));
            } else {
              get.set(state, result);
            }
          }),
        ),
        Effect.catch((error) => Effect.sync(() => get.set(state, failureFromError(error)))),
        Effect.asVoid,
      );
    });
    return { command: execute, state };
  }, [connection.attachment.domain, connection.attachment.id, emit, receiptId, runtime]);
}

export function useController(
  connection: Transport.Connected,
  receiptId: string,
  onCleaned?: (result: Completion) => void,
): Controller {
  const model = useModel(connection, receiptId, onCleaned);
  const state = useAtomValue(model.state);
  const execute = useAtomSet(model.command);

  return {
    apply: () => execute(Command.Apply()),
    dismiss: () => execute(Command.Dismiss()),
    plan: () => execute(Command.Plan()),
    retry: () => execute(Command.Plan()),
    state,
  } as const;
}

export interface RootProps extends PartProps<"div", { readonly status: State["_tag"] }> {
  readonly status: State["_tag"];
}

export function Root({ status, ...props }: RootProps) {
  return usePart(
    "div",
    props,
    { status },
    { "data-domainkit-part": "cleanup-flow", "data-state": status },
  );
}

export function Outcome({ state }: { readonly state: State }) {
  const { messages } = useDomainKit();
  if (state._tag === "Partial" || state._tag === "Failure" || state._tag === "Stale") {
    return (
      <p data-domainkit-part="flow-outcome" data-tone="danger" role="alert">
        {state._tag === "Partial" ? messages.cleanupPartial : state.message}
      </p>
    );
  }
  return null;
}

export interface DialogProps {
  readonly controller: Controller;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onOpenChangeComplete?: (open: boolean) => void;
  readonly trigger?: ReactElement | null;
}

export function Dialog({ controller, onOpenChange, onOpenChangeComplete, trigger }: DialogProps) {
  const { colorScheme, messages, portalContainer, themeStyle } = useDomainKit();
  const state = controller.state;
  const planRef = useRef<Transport.CleanupPlan | undefined>(undefined);
  if (state._tag === "Idle") planRef.current = undefined;
  if (state._tag === "Review" || state._tag === "Cleaning") planRef.current = state.plan;
  const plan = planRef.current;
  const busy = state._tag === "Planning" || state._tag === "Cleaning";
  const open = state._tag !== "Idle" && state._tag !== "Cleaned";
  return (
    <BaseAlertDialog.Root
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen && busy) {
          eventDetails.cancel();
          return;
        }
        if (!nextOpen) {
          controller.dismiss();
        }
        onOpenChange?.(nextOpen);
      }}
      onOpenChangeComplete={onOpenChangeComplete}
      open={open}
    >
      {trigger === null ? null : (
        <BaseAlertDialog.Trigger
          data-domainkit-part="cleanup-trigger"
          disabled={state._tag !== "Idle"}
          onClick={() => controller.plan()}
          {...(trigger === undefined ? {} : { render: trigger })}
        >
          {messages.reviewCleanup}
        </BaseAlertDialog.Trigger>
      )}
      <BaseAlertDialog.Portal container={portalContainer}>
        <BaseAlertDialog.Backdrop
          data-color-scheme={colorScheme}
          data-domainkit-part="dialog-backdrop"
          data-domainkit-root=""
          style={themeStyle}
        />
        <BaseAlertDialog.Popup
          data-color-scheme={colorScheme}
          data-domainkit-part="cleanup-dialog"
          data-domainkit-root=""
          style={themeStyle}
        >
          <div data-domainkit-part="dialog-header">
            <div data-domainkit-part="dialog-heading">
              <BaseAlertDialog.Title data-domainkit-part="dialog-title">
                {messages.reviewCleanup}
              </BaseAlertDialog.Title>
              <BaseAlertDialog.Description data-domainkit-part="dialog-description">
                {messages.cleanupConsent}
              </BaseAlertDialog.Description>
            </div>
            {busy ? null : (
              <BaseAlertDialog.Close aria-label={messages.close} data-domainkit-part="dialog-close">
                ×
              </BaseAlertDialog.Close>
            )}
          </div>
          <div data-domainkit-part="dialog-body">
            {plan === undefined ? (
              <p data-domainkit-part="dialog-progress" role="status">
                {messages.planningCleanup}
              </p>
            ) : (
              <Operations.List lifecycle="cleanup" operations={plan.operations} />
            )}
            <Outcome state={state} />
          </div>
          <div data-domainkit-part="dialog-footer">
            {busy ? (
              <button data-domainkit-part="cleanup-apply" disabled type="button">
                {state._tag === "Cleaning" ? messages.cleaningDns : messages.planningCleanup}
              </button>
            ) : state._tag === "Review" && plan !== undefined ? (
              <>
                <BaseAlertDialog.Close data-domainkit-part="dialog-cancel">
                  {messages.cancel}
                </BaseAlertDialog.Close>
                <button
                  data-domainkit-part="cleanup-apply"
                  disabled={plan.operations.some((operation) => operation._tag === "Blocked")}
                  onClick={() => controller.apply()}
                  type="button"
                >
                  {messages.applyCleanup}
                </button>
              </>
            ) : (
              <>
                <BaseAlertDialog.Close data-domainkit-part="dialog-cancel">
                  {messages.close}
                </BaseAlertDialog.Close>
                <button
                  data-domainkit-part="cleanup-retry"
                  onClick={() => controller.retry()}
                  type="button"
                >
                  {messages.retry}
                </button>
              </>
            )}
          </div>
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  );
}

export interface FlowProps extends Omit<RootProps, "status"> {
  readonly connection: Transport.Connected;
  readonly onCleaned?: (result: Completion) => void;
  readonly receiptId: string;
  readonly trigger?: ReactElement;
}

export function Flow({ connection, onCleaned, receiptId, trigger, ...props }: FlowProps) {
  const controller = useController(connection, receiptId, onCleaned);
  const state = controller.state;
  return (
    <Root status={state._tag} {...props}>
      <Dialog controller={controller} {...(trigger === undefined ? {} : { trigger })} />
    </Root>
  );
}
