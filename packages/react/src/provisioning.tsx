import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Transport } from "domainkit";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo, useRef, type ReactElement } from "react";

import { failureFromError, recordsIdentity, type Failure } from "./atom.ts";
import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import { Event as LifecycleEvent } from "./lifecycle.ts";
import * as Operations from "./operations.tsx";
import * as Records from "./records.tsx";

type LocalState = Data.TaggedEnum<{
  Applying: { readonly plan: Transport.ProvisioningPlan };
  Complete: { readonly result: Extract<Transport.ApplyResult, { readonly _tag: "Applied" }> };
  Idle: {};
  Partial: { readonly result: Extract<Transport.ApplyResult, { readonly _tag: "Partial" }> };
  Planning: {};
  Review: { readonly plan: Transport.ProvisioningPlan };
}>;
export const State = Data.taggedEnum<LocalState>();
export type State =
  | LocalState
  | Extract<Transport.ApplyResult, { readonly _tag: "Stale" }>
  | Failure;

export interface Controller {
  readonly apply: () => void;
  readonly dismiss: () => void;
  readonly plan: () => void;
  readonly retry: () => void;
  readonly state: State;
}

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

export function useModel(
  connection: Transport.Connected,
  records: ReadonlyArray<Transport.DnsRecord>,
  onApplied?: (
    result: Extract<Transport.ApplyResult, { readonly _tag: "Applied" | "Partial" }>,
  ) => void,
): Model {
  const { emit, runtime } = useDomainKit();
  const recordKey = recordsIdentity(records);
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;
  return useMemo(() => {
    const state = Atom.make<State>(State.Idle());
    const execute = runtime.fn<Command>()((command, get) => {
      const current = get(state);
      if (command._tag === "Dismiss") {
        if (current._tag === "Planning" || current._tag === "Applying") return Effect.void;
        get.set(state, State.Idle());
        return Effect.void;
      }
      if (command._tag === "Plan") {
        if (current._tag === "Planning" || current._tag === "Applying") return Effect.void;
        get.set(state, State.Planning());
        return Effect.flatMap(Transport.Service, (transport) =>
          transport.provisioning.plan({
            connectionId: connection.connectionId,
            domain: connection.domain,
            records,
          }),
        ).pipe(
          Effect.tap((plan) => Effect.sync(() => get.set(state, State.Review({ plan })))),
          Effect.catch((error) => Effect.sync(() => get.set(state, failureFromError(error)))),
          Effect.asVoid,
        );
      }
      if (
        current._tag !== "Review" ||
        current.plan.operations.some((operation) => operation._tag === "Conflict")
      )
        return Effect.void;
      const plan = current.plan;
      get.set(state, State.Applying({ plan }));
      return Effect.flatMap(Transport.Service, (transport) =>
        transport.provisioning.apply({
          connectionId: connection.connectionId,
          domain: connection.domain,
          planDigest: plan.digest,
        }),
      ).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (result._tag === "Applied") {
              get.set(state, State.Complete({ result }));
              emit(LifecycleEvent.RecordsApplied({ connection, result }));
              onAppliedRef.current?.(result);
            } else if (result._tag === "Partial") {
              get.set(state, State.Partial({ result }));
              emit(LifecycleEvent.RecordsPartiallyApplied({ connection, result }));
              onAppliedRef.current?.(result);
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
  }, [connection.connectionId, connection.domain, emit, recordKey, runtime]);
}

export function useController(
  connection: Transport.Connected,
  records: ReadonlyArray<Transport.DnsRecord>,
  onApplied?: (
    result: Extract<Transport.ApplyResult, { readonly _tag: "Applied" | "Partial" }>,
  ) => void,
): Controller {
  const model = useModel(connection, records, onApplied);
  const state = useAtomValue(model.state);
  const execute = useAtomSet(model.command);

  return {
    apply: () => execute(Command.Apply()),
    dismiss: () => execute(Command.Dismiss()),
    plan: () => execute(Command.Plan()),
    retry: () => execute(Command.Plan()),
    state,
  };
}

export interface RootProps extends PartProps<"div", { readonly status: State["_tag"] }> {
  readonly status: State["_tag"];
}

export function Root({ status, ...props }: RootProps) {
  return usePart(
    "div",
    props,
    { status },
    { "data-domainkit-part": "provisioning-flow", "data-state": status },
  );
}

export function Outcome({ state }: { readonly state: State }) {
  const { messages } = useDomainKit();
  if (state._tag === "Partial" || state._tag === "Failure" || state._tag === "Stale") {
    return (
      <p data-domainkit-part="flow-outcome" data-tone="danger" role="alert">
        {state._tag === "Partial" ? messages.recordsPartiallyApplied : state.message}
      </p>
    );
  }
  return null;
}

export interface DialogProps {
  readonly controller: Controller;
  readonly trigger?: ReactElement;
}

export function Dialog({ controller, trigger }: DialogProps) {
  const { colorScheme, messages, portalContainer, themeStyle } = useDomainKit();
  const state = controller.state;
  const planRef = useRef<Transport.ProvisioningPlan | undefined>(undefined);
  if (state._tag === "Idle") planRef.current = undefined;
  if (state._tag === "Review" || state._tag === "Applying") planRef.current = state.plan;
  const plan = planRef.current;
  const busy = state._tag === "Planning" || state._tag === "Applying";
  const open = state._tag !== "Idle" && state._tag !== "Complete";
  return (
    <BaseDialog.Root
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen && busy) {
          eventDetails.cancel();
          return;
        }
        if (!nextOpen) controller.dismiss();
      }}
      open={open}
    >
      <BaseDialog.Trigger
        data-domainkit-part="plan-trigger"
        disabled={state._tag !== "Idle"}
        onClick={() => controller.plan()}
        {...(trigger === undefined ? {} : { render: trigger })}
      >
        {messages.reviewDns}
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
          data-domainkit-part="plan-dialog"
          data-domainkit-root=""
          style={themeStyle}
        >
          <div data-domainkit-part="dialog-header">
            <div data-domainkit-part="dialog-heading">
              <BaseDialog.Title data-domainkit-part="dialog-title">
                {messages.reviewDns}
              </BaseDialog.Title>
              <BaseDialog.Description data-domainkit-part="dialog-description">
                {messages.planConsent}
              </BaseDialog.Description>
            </div>
            {busy ? null : (
              <BaseDialog.Close aria-label={messages.close} data-domainkit-part="dialog-close">
                ×
              </BaseDialog.Close>
            )}
          </div>
          <div data-domainkit-part="dialog-body">
            {plan === undefined ? (
              <p data-domainkit-part="dialog-progress" role="status">
                {messages.planningDns}
              </p>
            ) : (
              <Operations.List lifecycle="provisioning" operations={plan.operations} />
            )}
            <Outcome state={state} />
          </div>
          <div data-domainkit-part="dialog-footer">
            {busy ? (
              <button data-domainkit-part="plan-apply" disabled type="button">
                {state._tag === "Applying" ? messages.applyingDns : messages.planningDns}
              </button>
            ) : state._tag === "Review" && plan !== undefined ? (
              <>
                <BaseDialog.Close data-domainkit-part="dialog-cancel">
                  {messages.cancel}
                </BaseDialog.Close>
                <button
                  data-domainkit-part="plan-apply"
                  disabled={plan.operations.some((operation) => operation._tag === "Conflict")}
                  onClick={() => controller.apply()}
                  type="button"
                >
                  {messages.applyDns}
                </button>
              </>
            ) : (
              <>
                <BaseDialog.Close data-domainkit-part="dialog-cancel">
                  {messages.close}
                </BaseDialog.Close>
                <button
                  data-domainkit-part="provisioning-retry"
                  onClick={() => controller.retry()}
                  type="button"
                >
                  {messages.retry}
                </button>
              </>
            )}
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export function RetryAction({ controller }: { readonly controller: Controller }) {
  const { messages } = useDomainKit();
  const state = controller.state;
  if (state._tag !== "Failure" && state._tag !== "Stale" && state._tag !== "Partial") return null;
  return (
    <button
      data-domainkit-part="provisioning-retry"
      onClick={() => controller.retry()}
      type="button"
    >
      {messages.retry}
    </button>
  );
}

export interface FlowProps extends Omit<RootProps, "status"> {
  readonly connection: Transport.Connected;
  readonly onApplied?: (
    result: Extract<Transport.ApplyResult, { readonly _tag: "Applied" | "Partial" }>,
  ) => void;
  readonly records: ReadonlyArray<Transport.DnsRecord>;
  readonly showRecords?: boolean;
  readonly trigger?: ReactElement;
}

export function Flow({
  connection,
  onApplied,
  records,
  showRecords = true,
  trigger,
  ...props
}: FlowProps) {
  const controller = useController(connection, records, onApplied);
  const state = controller.state;
  return (
    <Root status={state._tag} {...props}>
      {showRecords ? <Records.Table records={records} /> : null}
      <Dialog controller={controller} {...(trigger === undefined ? {} : { trigger })} />
    </Root>
  );
}
