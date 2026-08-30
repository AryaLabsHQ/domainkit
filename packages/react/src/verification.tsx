import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Transport } from "domainkit";
import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import { failureFromCause, recordsIdentity, type Failure } from "./atom.ts";
import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import { Status as RecordStatus } from "./records.tsx";

export type State =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Observing" }
  | Transport.Observation
  | Failure;

export interface ObserveConfig {
  readonly connection?: Transport.Connected;
  readonly domain: string;
  readonly records: ReadonlyArray<Transport.DnsRecord>;
  readonly sources?: {
    readonly provider?: boolean;
    readonly publicDns?: boolean;
  };
}

export function useController(config: ObserveConfig) {
  const { runtime } = useDomainKit();
  const provider = config.sources?.provider ?? config.connection !== undefined;
  const publicDns = config.sources?.publicDns ?? true;
  const recordKey = recordsIdentity(config.records);
  const controller = useMemo(() => {
    const state = Atom.make<State>({ _tag: "Idle" });
    const observe = runtime.fn<void>()((_, get) => {
      get.set(state, { _tag: "Observing" });
      return Effect.flatMap(Transport.Service, (transport) =>
        transport.verification.observe({
          ...(config.connection === undefined
            ? {}
            : { connectionId: config.connection.connectionId }),
          domain: config.domain,
          records: config.records,
          sources: { provider, publicDns },
        }),
      ).pipe(
        Effect.tap((observation) => Effect.sync(() => get.set(state, observation))),
        Effect.catchCause((cause) =>
          Effect.sync(() =>
            get.set(
              state,
              failureFromCause(cause, "verification.observe", "DNS observation failed"),
            ),
          ),
        ),
        Effect.asVoid,
      );
    });
    return { observe, state };
  }, [config.connection?.connectionId, config.domain, provider, publicDns, recordKey, runtime]);
  const state = useAtomValue(controller.state);
  const dispatch = useAtomSet(controller.observe);
  const observe = () => dispatch();
  return { observe, state } as const;
}

const evidenceNote = (evidence: Transport.ObservationEvidence): string | undefined => {
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
  observation: Transport.Observation,
): ReadonlyArray<{
  readonly evidence: ReadonlyArray<Transport.ObservationEvidence>;
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

export type Observation = Transport.Observation;
