import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useCallback } from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import * as RequestState from "./request-state.ts";
import type {
  CleanupPlan,
  CleanupResult,
  Connected,
  Failure,
  RemoveDomainResult,
} from "./transport.ts";

export type State =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Planning" }
  | { readonly _tag: "Review"; readonly plan: CleanupPlan }
  | { readonly _tag: "Cleaning"; readonly plan: CleanupPlan }
  | {
      readonly _tag: "Cleaned";
      readonly result: Extract<CleanupResult, { readonly _tag: "Cleaned" }>;
    }
  | {
      readonly _tag: "Partial";
      readonly result: Extract<CleanupResult, { readonly _tag: "Partial" }>;
    }
  | { readonly _tag: "Stale"; readonly message: string }
  | { readonly _tag: "Disconnecting" }
  | RemoveDomainResult
  | Failure;

export function useController(connection: Connected, receiptId: string) {
  const { transport } = useDomainKit();
  const requestState = RequestState.useController<State>(
    `${connection.connectionId}:${connection.domain}:${receiptId}`,
    { _tag: "Idle" },
  );
  const state = requestState.state;

  const plan = useCallback(async () => {
    const request = requestState.begin({ _tag: "Planning" });
    try {
      const result = await transport.cleanup.plan({
        connectionId: connection.connectionId,
        domain: connection.domain,
        receiptId,
      });
      requestState.commit(
        request,
        result._tag === "CleanupPlan" ? { _tag: "Review", plan: result } : result,
      );
    } catch (cause) {
      requestState.commit(request, toFailure(cause));
    }
  }, [connection.connectionId, connection.domain, receiptId, requestState, transport]);

  const apply = useCallback(async () => {
    if (state._tag !== "Review") return;
    const reviewedPlan = state.plan;
    if (reviewedPlan.operations.some((operation) => operation._tag === "Blocked")) return;
    const request = requestState.begin({ _tag: "Cleaning", plan: reviewedPlan });
    try {
      const result = await transport.cleanup.apply({
        connectionId: connection.connectionId,
        domain: connection.domain,
        planDigest: reviewedPlan.digest,
        receiptId,
      });
      requestState.commit(
        request,
        result._tag === "Cleaned"
          ? { _tag: "Cleaned", result }
          : result._tag === "Partial"
            ? { _tag: "Partial", result }
            : result,
      );
    } catch (cause) {
      requestState.commit(request, toFailure(cause));
    }
  }, [connection.connectionId, connection.domain, receiptId, requestState, state, transport]);

  const disconnect = useCallback(async () => {
    const request = requestState.begin({ _tag: "Disconnecting" });
    try {
      requestState.commit(
        request,
        await transport.connection.removeDomain({
          connectionId: connection.connectionId,
          domain: connection.domain,
          preserveDns: true,
        }),
      );
    } catch (cause) {
      requestState.commit(request, toFailure(cause));
    }
  }, [connection.connectionId, connection.domain, requestState, transport]);

  return {
    apply,
    disconnect,
    dismiss: () => requestState.reset({ _tag: "Idle" }),
    plan,
    state,
  } as const;
}

const toFailure = (cause: unknown): Failure => ({
  _tag: "Failure",
  message: cause instanceof Error ? cause.message : "Domain cleanup failed",
  retry: "safe",
});

export interface FlowProps extends PartProps<"div", { readonly status: State["_tag"] }> {
  readonly connection: Connected;
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
          {state._tag === "Removed" ? (
            <p data-domainkit-part="flow-outcome" data-tone="success">
              {messages.domainDisconnected}
            </p>
          ) : null}
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
                    <BaseDialog.Close aria-label={messages.close} data-domainkit-part="dialog-close">
                      ×
                    </BaseDialog.Close>
                  </div>
                  <div data-domainkit-part="dialog-body">
                    <ul data-domainkit-part="cleanup-operations">
                      {plan.operations.map((operation) => (
                        <li data-operation={operation._tag} key={operation.id}>
                          <span data-domainkit-part="operation-kind">{operation._tag}</span>{" "}
                          <strong>{operation.record.type}</strong>{" "}
                          <span data-domainkit-part="operation-record">
                            {operation.record.name}
                            {operation._tag === "Blocked" ? ` ${operation.reason}` : ""}
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
          <button
            data-domainkit-part="disconnect-action"
            disabled={state._tag === "Disconnecting"}
            onClick={() => void controller.disconnect()}
            type="button"
          >
            {state._tag === "Disconnecting" ? messages.disconnecting : messages.disconnectDomain}
          </button>
        </>
      ),
      "data-domainkit-part": "cleanup-flow",
      "data-state": state._tag,
    },
  );
}
