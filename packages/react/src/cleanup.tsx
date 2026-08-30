import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Transport } from "domainkit";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import { failureFromError, type Failure } from "./atom.ts";
import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import { Event as LifecycleEvent } from "./lifecycle.ts";
import * as Operations from "./operations.tsx";

type LocalState = Data.TaggedEnum<{
  Cleaned: {
    readonly result: Extract<Transport.CleanupResult, { readonly _tag: "Cleaned" }>;
  };
  Cleaning: { readonly plan: Transport.CleanupPlan };
  Idle: {};
  Partial: {
    readonly result: Extract<Transport.CleanupResult, { readonly _tag: "Partial" }>;
  };
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
  readonly state: State;
}

export function useModel(connection: Transport.Connected, receiptId: string): Model {
  const { emit, runtime } = useDomainKit();
  return useMemo(() => {
    const state = Atom.make<State>(State.Idle());
    const execute = runtime.fn<Command>()((command, get) => {
      if (command._tag === "Dismiss") {
        get.set(state, State.Idle());
        return Effect.void;
      }
      if (command._tag === "Plan") {
        get.set(state, State.Planning());
        return Effect.flatMap(Transport.Service, (transport) =>
          transport.cleanup.plan({
            connectionId: connection.connectionId,
            domain: connection.domain,
            receiptId,
          }),
        ).pipe(
          Effect.tap((plan) => Effect.sync(() => get.set(state, State.Review({ plan })))),
          Effect.catch((error) => Effect.sync(() => get.set(state, failureFromError(error)))),
          Effect.asVoid,
        );
      }
      const current = get(state);
      if (
        current._tag !== "Review" ||
        current.plan.operations.some((operation) => operation._tag === "Blocked")
      )
        return Effect.void;
      const plan = current.plan;
      get.set(state, State.Cleaning({ plan }));
      return Effect.flatMap(Transport.Service, (transport) =>
        transport.cleanup.apply({
          connectionId: connection.connectionId,
          domain: connection.domain,
          planDigest: plan.digest,
          receiptId,
        }),
      ).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (result._tag === "Cleaned") {
              get.set(state, State.Cleaned({ result }));
              emit(LifecycleEvent.RecordsCleaned({ connection, result }));
            } else if (result._tag === "Partial") {
              get.set(state, State.Partial({ result }));
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
  }, [connection.connectionId, connection.domain, emit, receiptId, runtime]);
}

export function useController(connection: Transport.Connected, receiptId: string): Controller {
  const model = useModel(connection, receiptId);
  const state = useAtomValue(model.state);
  const execute = useAtomSet(model.command);

  return {
    apply: () => execute(Command.Apply()),
    dismiss: () => execute(Command.Dismiss()),
    plan: () => execute(Command.Plan()),
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
  if (state._tag === "Cleaned") {
    return (
      <p data-domainkit-part="flow-outcome" data-tone="success">
        {messages.cleanupComplete}
      </p>
    );
  }
  if (state._tag === "Partial" || state._tag === "Failure" || state._tag === "Stale") {
    return (
      <p data-domainkit-part="flow-outcome" data-tone="danger" role="alert">
        {state._tag === "Partial" ? messages.cleanupPartial : state.message}
      </p>
    );
  }
  return null;
}

export function Dialog({ controller }: { readonly controller: Controller }) {
  const { colorScheme, messages, portalContainer, themeStyle } = useDomainKit();
  const state = controller.state;
  const plan = state._tag === "Review" || state._tag === "Cleaning" ? state.plan : undefined;
  return (
    <BaseDialog.Root
      onOpenChange={(open) => {
        if (!open) controller.dismiss();
      }}
      open={plan !== undefined}
    >
      <BaseDialog.Trigger
        data-domainkit-part="cleanup-trigger"
        disabled={state._tag === "Planning" || state._tag === "Cleaning"}
        onClick={() => controller.plan()}
      >
        {state._tag === "Planning" ? messages.planningCleanup : messages.reviewCleanup}
      </BaseDialog.Trigger>
      {plan === undefined ? null : (
        <BaseDialog.Portal container={portalContainer ?? undefined}>
          <BaseDialog.Backdrop data-domainkit-part="dialog-backdrop" />
          <BaseDialog.Popup
            data-color-scheme={colorScheme}
            data-domainkit-part="cleanup-dialog"
            data-domainkit-root=""
            style={themeStyle}
          >
            <div data-domainkit-part="dialog-header">
              <div data-domainkit-part="dialog-heading">
                <BaseDialog.Title data-domainkit-part="dialog-title">
                  {messages.reviewCleanup}
                </BaseDialog.Title>
                <BaseDialog.Description data-domainkit-part="dialog-description">
                  {messages.cleanupConsent}
                </BaseDialog.Description>
              </div>
              <BaseDialog.Close aria-label={messages.close} data-domainkit-part="dialog-close">
                ×
              </BaseDialog.Close>
            </div>
            <div data-domainkit-part="dialog-body">
              <Operations.List lifecycle="cleanup" operations={plan.operations} />
            </div>
            <div data-domainkit-part="dialog-footer">
              <BaseDialog.Close data-domainkit-part="dialog-cancel">
                {messages.cancel}
              </BaseDialog.Close>
              <button
                data-domainkit-part="cleanup-apply"
                disabled={
                  state._tag === "Cleaning" ||
                  plan.operations.some((operation) => operation._tag === "Blocked")
                }
                onClick={() => controller.apply()}
                type="button"
              >
                {state._tag === "Cleaning" ? messages.cleaningDns : messages.applyCleanup}
              </button>
            </div>
          </BaseDialog.Popup>
        </BaseDialog.Portal>
      )}
    </BaseDialog.Root>
  );
}

export interface FlowProps extends Omit<RootProps, "status"> {
  readonly connection: Transport.Connected;
  readonly receiptId: string;
}

export function Flow({ connection, receiptId, ...props }: FlowProps) {
  const controller = useController(connection, receiptId);
  const state = controller.state;
  return (
    <Root status={state._tag} {...props}>
      <Outcome state={state} />
      <Dialog controller={controller} />
    </Root>
  );
}
