import { useCallback } from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import * as RequestState from "./request-state.ts";
import type { Connected, DnsRecord, Failure, Observation } from "./transport.ts";

export type State =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Observing" }
  | Observation
  | Failure;

export interface ObserveConfig {
  readonly connection?: Connected;
  readonly domain: string;
  readonly records: ReadonlyArray<DnsRecord>;
  readonly sources?: {
    readonly provider?: boolean;
    readonly publicDns?: boolean;
  };
}

export function useController(config: ObserveConfig) {
  const { transport } = useDomainKit();
  const sources = {
    provider: config.sources?.provider ?? config.connection !== undefined,
    publicDns: config.sources?.publicDns ?? true,
  };
  const requestState = RequestState.useController<State>(
    `${config.connection?.connectionId ?? "public"}:${config.domain}:${sources.provider}:${sources.publicDns}:${RequestState.recordsIdentity(config.records)}`,
    { _tag: "Idle" },
  );
  const state = requestState.state;
  const observe = useCallback(async () => {
    const request = requestState.begin({ _tag: "Observing" });
    try {
      requestState.commit(
        request,
        await transport.verification.observe({
          ...(config.connection === undefined
            ? {}
            : { connectionId: config.connection.connectionId }),
          domain: config.domain,
          records: config.records,
          sources,
        }),
      );
    } catch (cause) {
      requestState.commit(request, {
        _tag: "Failure",
        message: cause instanceof Error ? cause.message : "DNS observation failed",
        retry: "safe",
      });
    }
  }, [config, requestState, sources, transport]);
  return { observe, state } as const;
}

export interface StatusProps extends PartProps<"div", { readonly status: State["_tag"] }> {
  readonly config: ObserveConfig;
}

export function Status({ config, ...props }: StatusProps) {
  const controller = useController(config);
  const { messages } = useDomainKit();
  const state = controller.state;
  return usePart(
    "div",
    props,
    { status: state._tag },
    {
      children: (
        <>
          {state._tag === "Observation" ? (
            <ul>
              {[...state.provider, ...state.publicDns].map((evidence, index) => (
                <li key={`${evidence._tag}-${evidence.recordId}-${index}`}>
                  {evidence.recordId}: {evidence._tag}
                </li>
              ))}
            </ul>
          ) : state._tag === "Failure" ? (
            <p data-domainkit-part="flow-outcome" data-tone="danger" role="alert">
              {state.message}
            </p>
          ) : null}
          <button
            data-domainkit-part="observe-action"
            disabled={state._tag === "Observing"}
            onClick={() => void controller.observe()}
            type="button"
          >
            {state._tag === "Observing" ? messages.checkingDns : messages.checkDns}
          </button>
        </>
      ),
      "data-domainkit-part": "verification-status",
      "data-state": state._tag,
    },
  );
}

export type { Observation };
