import { Popover as BasePopover } from "@base-ui/react/popover";
import type { DomainKitError } from "domainkit";
import type { Transport } from "domainkit/client";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import { Event } from "./events.ts";
import { useIcons } from "./icons.tsx";
import { failure as describeFailure } from "./messages.ts";
import { identity, Status as RecordStatus } from "./records.tsx";
import { useRunner } from "./task.ts";

export type Readiness = Transport.Readiness;
export type HostEvidence = Readiness["host"][number];
export type Requirement = Readiness["requirements"][number];

/**
 * Readiness rides on the state rather than a ref, so it can never outlive the render that
 * produced it: a controller pointed at a new domain has no readiness in the very first frame.
 */
export type State = Data.TaggedEnum<{
  Idle: {};
  Observing: { readonly readiness: Readiness | null };
  Observed: { readonly readiness: Readiness };
  Failure: { readonly error: DomainKitError.DomainKitError; readonly readiness: Readiness | null };
}>;
export const State = Data.taggedEnum<State>();

const readinessOf = (state: State): Readiness | null =>
  state._tag === "Idle" ? null : state.readiness;

export interface Controller {
  readonly state: State;
  /** The latest readiness, kept while a new observation runs. */
  readonly readiness: Readiness | null;
  readonly observe: () => void;
  /** Observe again after a failure. */
  readonly retry: () => void;
  /** Whether this controller re-observes at `nextCheckAt` while mounted. */
  readonly polling: boolean;
}

export interface Options {
  readonly domain: string;
  /** Re-observe at each `nextCheckAt` while mounted. Default true. */
  readonly polling?: boolean;
}

/** Observe once on mount, then follow the readiness's own `nextCheckAt` while polling is on. */
export function useController({ domain, polling = true }: Options): Controller {
  const { emit, revision, transport } = useDomainKit();
  const verification = transport.verification;
  const runner = useRunner();
  const [state, setState] = useState<State>(State.Idle());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Readiness belongs to the domain that was observed. Dropping it while rendering, rather than
  // in an effect, keeps the first frame for a new domain free of the previous one's evidence.
  const [observed, setObserved] = useState(domain);
  if (observed !== domain) {
    setObserved(domain);
    setState(State.Idle());
  }

  const observe = useCallback(() => {
    if (verification === undefined) return;
    clearTimeout(timer.current);
    setState((previous) => State.Observing({ readiness: readinessOf(previous) }));
    runner.run(verification.observe(domain), {
      onFailure: (error) => {
        setState((previous) => State.Failure({ error, readiness: readinessOf(previous) }));
        emit(Event.Failed({ domain, error }));
      },
      onSuccess: (readiness) => setState(State.Observed({ readiness })),
    });
  }, [domain, emit, runner, verification]);

  useEffect(() => {
    observe();
  }, [observe, revision]);

  useEffect(() => {
    if (!polling || state._tag !== "Observed") return;
    const next = state.readiness.nextCheckAt;
    if (next === null) return;
    const delay = Math.max(0, DateTime.toEpochMillis(next) - Date.now());
    timer.current = setTimeout(observe, delay);
    return () => clearTimeout(timer.current);
  }, [observe, polling, state]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    observe,
    polling,
    readiness: readinessOf(state),
    retry: observe,
    state,
  };
}

// ---------------------------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------------------------

export interface RootState extends Record<string, unknown> {
  readonly status: State["_tag"];
}

export interface RootProps extends PartProps<"div", RootState> {
  readonly controller: Controller;
}

export function Root({ controller, ...props }: RootProps): ReactElement {
  const overall = controller.readiness?.overall ?? null;
  return usePart(
    "div",
    props,
    { status: controller.state._tag },
    {
      "data-domainkit-part": "verification-status",
      "data-overall": overall ?? undefined,
      "data-state": controller.state._tag,
    },
  );
}

export interface ObserveActionProps extends PartProps<"button", RootState> {
  readonly controller: Controller;
}

export function ObserveAction({ controller, ...props }: ObserveActionProps): ReactElement {
  const { messages } = useDomainKit();
  const observing = controller.state._tag === "Observing";
  return usePart(
    "button",
    props,
    { status: controller.state._tag },
    {
      "aria-busy": observing,
      children: controller.readiness === null ? messages.checkDns : messages.checkAgain,
      "data-domainkit-part": "observe-action",
      "data-loading": observing ? "" : undefined,
      disabled: observing,
      onClick: controller.observe,
      type: "button",
    },
  );
}

/** Evidence carries no id; its source and position identify it within one requirement. */
const evidenceKey = (evidence: { readonly _tag: string }, index: number): string =>
  [evidence._tag, index].join("-");

export interface EvidenceProps {
  readonly readiness: Readiness;
}

/**
 * Per-requirement readiness and, below it, the host's own evidence: an SES identity, a certificate,
 * anything DomainKit cannot observe but the host feeds in.
 */
export function Evidence({ readiness }: EvidenceProps): ReactElement {
  const { messages } = useDomainKit();
  const icons = useIcons();
  return (
    <div data-domainkit-part="observation-list">
      {readiness.requirements.map((requirement) => (
        <section data-domainkit-part="observation-group" key={identity(requirement.record)}>
          <div data-domainkit-part="observation-row">
            <span data-domainkit-part="observation-record">
              {messages.recordType(requirement.record)} {requirement.record.name}
            </span>
            <RecordStatus status={requirement.status} />
          </div>
          <ul>
            {requirement.evidence.map((evidence, index) => (
              <li data-domainkit-part="observation-source" key={evidenceKey(evidence, index)}>
                {messages.evidenceSource(evidence)}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {readiness.host.length === 0 ? null : (
        <section data-domainkit-part="observation-group" data-source="host">
          <h3 data-domainkit-part="observation-source">{messages.hostEvidence}</h3>
          <ul>
            {readiness.host.map((evidence, index) => (
              <li data-domainkit-part="host-evidence" key={`${evidence.source}-${index}`}>
                <span aria-hidden="true" data-icon="inline-start">
                  {evidence.status === "ok"
                    ? icons.success
                    : evidence.status === "pending"
                      ? icons.pending
                      : icons.failure}
                </span>
                <span data-domainkit-part="observation-record">{evidence.label}</span>
                <span data-domainkit-part="record-status" data-status={evidence.status}>
                  {messages.hostEvidenceStatus(evidence.status)}
                </span>
                {evidence.detail === undefined ? null : (
                  <p data-domainkit-part="observation-note">{evidence.detail}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export interface OutcomeProps extends PartProps<"p", RootState> {
  readonly controller: Controller;
}

export function Outcome({ controller, ...props }: OutcomeProps): ReactElement | null {
  const { messages } = useDomainKit();
  const state = controller.state;
  const element = usePart(
    "p",
    props,
    { status: state._tag },
    {
      children:
        state._tag === "Failure" ? (
          <>
            {describeFailure(state.error, messages)}{" "}
            <button
              data-domainkit-part="verification-retry"
              onClick={controller.retry}
              type="button"
            >
              {messages.retry}
            </button>
          </>
        ) : null,
      "data-domainkit-part": "flow-outcome",
      "data-tone": "danger",
      role: "alert",
    },
  );
  return state._tag === "Failure" ? element : null;
}

export interface StatusProps extends Omit<RootProps, "render"> {
  /** Replace the popover surface with a panel of the host's own. */
  readonly render?: (props: { readonly open: boolean; readonly children: ReactNode }) => ReactNode;
}

/** The default verification slot: a button that observes, with the evidence behind it. */
export function Status({ controller, render, ...props }: StatusProps): ReactElement {
  const { colorScheme, messages, portalContainer, themeStyle } = useDomainKit();
  const readiness = controller.readiness;
  const body = (
    <>
      {controller.state._tag === "Observing" ? (
        <p data-domainkit-part="verification-progress" role="status">
          {messages.observing}
        </p>
      ) : null}
      {readiness === null ? (
        <p data-domainkit-part="verification-progress">{messages.noEvidence}</p>
      ) : (
        <Evidence readiness={readiness} />
      )}
      <Outcome controller={controller} />
    </>
  );
  return (
    <Root controller={controller} {...props}>
      {render === undefined ? (
        <BasePopover.Root>
          <BasePopover.Trigger render={<ObserveAction controller={controller} />} />
          <BasePopover.Portal container={portalContainer}>
            <BasePopover.Positioner
              align="end"
              data-domainkit-part="verification-positioner"
              sideOffset={6}
            >
              <BasePopover.Popup
                aria-busy={controller.state._tag === "Observing"}
                aria-label={messages.checkDns}
                data-color-scheme={colorScheme}
                data-domainkit-part="verification-popover"
                data-domainkit-root=""
                style={themeStyle}
              >
                <BasePopover.Arrow data-domainkit-part="verification-arrow" />
                {body}
              </BasePopover.Popup>
            </BasePopover.Positioner>
          </BasePopover.Portal>
        </BasePopover.Root>
      ) : (
        <>
          <ObserveAction controller={controller} />
          {render({ children: body, open: controller.state._tag !== "Idle" })}
        </>
      )}
    </Root>
  );
}
