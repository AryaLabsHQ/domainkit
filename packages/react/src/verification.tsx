import { useCallback } from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import { Status as RecordStatus } from "./records.tsx";
import * as RequestState from "./request-state.ts";
import type {
  Connected,
  DnsRecord,
  Failure,
  Observation,
  ObservationEvidence,
} from "./transport.ts";

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

const evidenceNote = (evidence: ObservationEvidence): string | undefined => {
  switch (evidence._tag) {
    case "Mismatch":
    case "Unavailable":
      return evidence.message;
    case "Found":
    case "Missing":
      return undefined;
    default: {
      const _exhaustive: never = evidence;
      return _exhaustive;
    }
  }
};

const observationGroups = (
  observation: Observation,
): ReadonlyArray<{
  readonly evidence: ReadonlyArray<ObservationEvidence>;
  readonly label: string;
}> =>
  [
    { evidence: observation.provider, label: "Provider" },
    { evidence: observation.publicDns, label: "Public DNS" },
  ].filter((group) => group.evidence.length > 0);

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
            <div data-domainkit-part="observation-list">
              {observationGroups(state).map((group) => (
                <section data-domainkit-part="observation-group" key={group.label}>
                  <p data-domainkit-part="observation-source">{group.label}</p>
                  <ul>
                    {group.evidence.map((evidence, index) => {
                      const note = evidenceNote(evidence);
                      return (
                        <li key={`${evidence._tag}-${evidence.recordId}-${index}`}>
                          <div data-domainkit-part="observation-row">
                            <span data-domainkit-part="observation-record">
                              {evidence.recordId}
                            </span>
                            <RecordStatus evidence={evidence} />
                          </div>
                          {note === undefined ? null : (
                            <p data-domainkit-part="observation-note">{note}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
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
