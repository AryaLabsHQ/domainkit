import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Transport } from "domainkit";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import { failureFromError, recordsIdentity, type Failure } from "./atom.ts";
import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import { Status as RecordStatus } from "./records.tsx";

type LocalState = Data.TaggedEnum<{
  Idle: {};
  Observing: {};
}>;
export const State = Data.taggedEnum<LocalState>();
export type State = LocalState | Transport.Observation | Failure;

export interface ObserveConfig {
  readonly connection?: Transport.Connected;
  readonly domain: string;
  readonly records: ReadonlyArray<Transport.DnsRecord>;
  readonly sources?: {
    readonly provider?: boolean;
    readonly publicDns?: boolean;
  };
}

export type Command = Data.TaggedEnum<{
  Observe: {};
  Reset: {};
}>;
export const Command = Data.taggedEnum<Command>();

export interface Model {
  readonly command: Atom.AtomResultFn<Command, void>;
  readonly state: Atom.Atom<State>;
}

export interface Controller {
  readonly observe: () => void;
  readonly reset: () => void;
  readonly state: State;
}

export function useModel(config: ObserveConfig): Model {
  const { runtime } = useDomainKit();
  const provider = config.sources?.provider ?? config.connection !== undefined;
  const publicDns = config.sources?.publicDns ?? true;
  const recordKey = recordsIdentity(config.records);
  return useMemo(() => {
    const state = Atom.make<State>(State.Idle());
    const observe = runtime.fn<Command>()((command, get) => {
      if (command._tag === "Reset") {
        get.set(state, State.Idle());
        return Effect.void;
      }
      get.set(state, State.Observing());
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
        Effect.catch((error) => Effect.sync(() => get.set(state, failureFromError(error)))),
        Effect.asVoid,
      );
    });
    return { command: observe, state };
  }, [config.connection?.connectionId, config.domain, provider, publicDns, recordKey, runtime]);
}

export function useController(config: ObserveConfig): Controller {
  const model = useModel(config);
  const state = useAtomValue(model.state);
  const dispatch = useAtomSet(model.command);
  const observe = () => dispatch(Command.Observe());
  const reset = () => dispatch(Command.Reset());
  return { observe, reset, state };
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

export interface RootProps extends PartProps<"div", { readonly status: State["_tag"] }> {
  readonly status: State["_tag"];
}

export function Root({ status, ...props }: RootProps) {
  return usePart(
    "div",
    props,
    { status },
    { "data-domainkit-part": "verification-status", "data-state": status },
  );
}

export function Evidence({ observation }: { readonly observation: Transport.Observation }) {
  return (
    <div data-domainkit-part="observation-list">
      {observationGroups(observation).map((group) => (
        <section data-domainkit-part="observation-group" key={group.label}>
          <p data-domainkit-part="observation-source">{group.label}</p>
          <ul>
            {group.evidence.map((evidence, index) => {
              const note = evidenceNote(evidence);
              return (
                <li key={`${evidence._tag}-${evidence.recordId}-${index}`}>
                  <div data-domainkit-part="observation-row">
                    <span data-domainkit-part="observation-record">{evidence.recordId}</span>
                    <RecordStatus evidence={evidence} />
                  </div>
                  {note === undefined ? null : <p data-domainkit-part="observation-note">{note}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function Outcome({ state }: { readonly state: State }) {
  if (state._tag !== "Failure") return null;
  return (
    <p data-domainkit-part="flow-outcome" data-tone="danger" role="alert">
      {state.message}
    </p>
  );
}

export function ObserveAction({ controller }: { readonly controller: Controller }) {
  const { messages } = useDomainKit();
  return (
    <button
      data-domainkit-part="observe-action"
      disabled={controller.state._tag === "Observing"}
      onClick={() => controller.observe()}
      type="button"
    >
      {controller.state._tag === "Observing" ? messages.checkingDns : messages.checkDns}
    </button>
  );
}

export interface StatusProps extends Omit<RootProps, "status"> {
  readonly config: ObserveConfig;
}

export function Status({ config, ...props }: StatusProps) {
  const controller = useController(config);
  const state = controller.state;
  return (
    <Root status={state._tag} {...props}>
      {state._tag === "Observation" ? <Evidence observation={state} /> : null}
      <Outcome state={state} />
      <ObserveAction controller={controller} />
    </Root>
  );
}

export type Observation = Transport.Observation;
