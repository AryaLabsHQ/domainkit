import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Transport } from "domainkit";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import { failureFromCause } from "./atom.ts";
import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";

export type State =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Planning" }
  | { readonly _tag: "Review"; readonly plan: Transport.CleanupPlan }
  | { readonly _tag: "Cleaning"; readonly plan: Transport.CleanupPlan }
  | {
      readonly _tag: "Cleaned";
      readonly result: Extract<Transport.CleanupResult, { readonly _tag: "Cleaned" }>;
    }
  | {
      readonly _tag: "Partial";
      readonly result: Extract<Transport.CleanupResult, { readonly _tag: "Partial" }>;
    }
  | { readonly _tag: "Stale"; readonly message: string }
  | Transport.Failure;

type Command = Data.TaggedEnum<{
  Apply: { readonly plan: Transport.CleanupPlan };
  Plan: {};
}>;
const Command = Data.taggedEnum<Command>();

export function useController(connection: Transport.Connected, receiptId: string) {
  const { runtime } = useDomainKit();
  const controller = useMemo(() => {
    const state = Atom.make<State>({ _tag: "Idle" });
    const execute = runtime.fn<Command>()((command, get) => {
      if (command._tag === "Plan") {
        get.set(state, { _tag: "Planning" });
        return Effect.flatMap(Transport.Service, (transport) =>
          transport.cleanup.plan({
            connectionId: connection.connectionId,
            domain: connection.domain,
            receiptId,
          }),
        ).pipe(
          Effect.tap((plan) => Effect.sync(() => get.set(state, { _tag: "Review", plan }))),
          Effect.catchCause((cause) =>
            Effect.sync(() =>
              get.set(state, failureFromCause(cause, "cleanup.plan", "Domain cleanup failed")),
            ),
          ),
          Effect.asVoid,
        );
      }
      get.set(state, { _tag: "Cleaning", plan: command.plan });
      return Effect.flatMap(Transport.Service, (transport) =>
        transport.cleanup.apply({
          connectionId: connection.connectionId,
          domain: connection.domain,
          planDigest: command.plan.digest,
          receiptId,
        }),
      ).pipe(
        Effect.tap((result) =>
          Effect.sync(() =>
            get.set(
              state,
              result._tag === "Cleaned"
                ? { _tag: "Cleaned", result }
                : result._tag === "Partial"
                  ? { _tag: "Partial", result }
                  : result,
            ),
          ),
        ),
        Effect.catchCause((cause) =>
          Effect.sync(() =>
            get.set(state, failureFromCause(cause, "cleanup.apply", "Domain cleanup failed")),
          ),
        ),
        Effect.asVoid,
      );
    });
    return { execute, state };
  }, [connection.connectionId, connection.domain, receiptId, runtime]);
  const state = useAtomValue(controller.state);
  const setState = useAtomSet(controller.state);
  const execute = useAtomSet(controller.execute);

  return {
    apply: () => {
      if (
        state._tag === "Review" &&
        !state.plan.operations.some((operation) => operation._tag === "Blocked")
      )
        execute(Command.Apply({ plan: state.plan }));
    },
    dismiss: () => setState({ _tag: "Idle" }),
    plan: () => execute(Command.Plan()),
    state,
  } as const;
}

export interface FlowProps extends PartProps<"div", { readonly status: State["_tag"] }> {
  readonly connection: Transport.Connected;
  readonly receiptId: string;
}

export function Flow({ connection, receiptId, ...props }: FlowProps) {
  const controller = useController(connection, receiptId);
  const { colorScheme, messages, portalContainer, themeStyle } = useDomainKit();
  const state = controller.state;
  const plan = state._tag === "Review" || state._tag === "Cleaning" ? state.plan : undefined;
  return usePart(
    "div",
    props,
    { status: state._tag },
    {
      children: (
        <>
          {state._tag === "Cleaned" ? (
            <p data-domainkit-part="flow-outcome" data-tone="success">
              {messages.cleanupComplete}
            </p>
          ) : null}
          {state._tag === "Partial" || state._tag === "Failure" || state._tag === "Stale" ? (
            <p data-domainkit-part="flow-outcome" data-tone="danger" role="alert">
              {state._tag === "Partial" ? messages.cleanupPartial : state.message}
            </p>
          ) : null}
          <BaseDialog.Root
            onOpenChange={(open) => {
              if (!open) controller.dismiss();
            }}
            open={plan !== undefined}
          >
            <BaseDialog.Trigger
              data-domainkit-part="cleanup-trigger"
              disabled={state._tag === "Planning" || state._tag === "Cleaning"}
              onClick={() => void controller.plan()}
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
                    <BaseDialog.Close
                      aria-label={messages.close}
                      data-domainkit-part="dialog-close"
                    >
                      ×
                    </BaseDialog.Close>
                  </div>
                  <div data-domainkit-part="dialog-body">
                    <ul data-domainkit-part="cleanup-operations">
                      {plan.operations.map((operation) => (
                        <li data-operation={operation._tag} key={operation.id}>
                          <span data-domainkit-part="operation-kind">{operation._tag}</span>{" "}
                          <strong data-domainkit-part="operation-type">
                            {operation.record.type}
                          </strong>{" "}
                          <span data-domainkit-part="operation-record">
                            <span data-domainkit-part="operation-name">
                              {operation.record.name}
                            </span>
                            <code data-domainkit-part="operation-value">
                              {operation.record.value}
                            </code>
                            {operation.record.priority === undefined ? null : (
                              <span data-domainkit-part="operation-priority">
                                Priority {operation.record.priority}
                              </span>
                            )}
                            {operation._tag === "Blocked" ? (
                              <span data-domainkit-part="operation-reason">{operation.reason}</span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
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
                      onClick={() => void controller.apply()}
                      type="button"
                    >
                      {state._tag === "Cleaning" ? messages.cleaningDns : messages.applyCleanup}
                    </button>
                  </div>
                </BaseDialog.Popup>
              </BaseDialog.Portal>
            )}
          </BaseDialog.Root>
        </>
      ),
      "data-domainkit-part": "cleanup-flow",
      "data-state": state._tag,
    },
  );
}
