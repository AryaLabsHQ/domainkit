import type { SceneMarkup } from "../../scene";
import {
  approvedDigest,
  blockedDigest,
  conflictAdvice,
  conflictReason,
  mail,
  spf,
  track,
} from "../data";
import { Badge, Cursor, Header, Kicker, Line, Lock, Scene } from "../parts";

export const PLAN_COLS = "130px 190px 250px 380px 1fr";

const outcomeColor = {
  Noop: "var(--fm-set)",
  Create: "var(--fm-add)",
  Conflict: "var(--fm-conflict)",
} as const;

/** One requirement's cells; the plan column holds every state the row passes through. */
function Row({
  type,
  name,
  value,
  states,
  outcomes,
  last,
  tint,
  a,
}: {
  type: string;
  name: string;
  value: string;
  states: ReadonlyArray<{
    key: string;
    tone: "success" | "warning" | "danger" | "neutral";
    label: string;
  }>;
  /** The plan's semantic outcome(s) the row passes through, in order. */
  outcomes: ReadonlyArray<{ key: string; word: keyof typeof outcomeColor }>;
  last?: boolean;
  tint?: boolean;
  a: string;
}) {
  return (
    <div
      className={last ? "dk-row dk-row--last" : "dk-row"}
      style={{ gridTemplateColumns: PLAN_COLS }}
    >
      {tint && (
        <i
          data-a={`${a}-tint`}
          className="dk-row-tint"
          style={{ background: "var(--fm-conflict-bg)" }}
        />
      )}
      <span className="dk-type">{type}</span>
      <span className="dk-slot">
        {outcomes.map((outcome) => (
          <span
            key={outcome.key}
            data-a={`${a}-out-${outcome.key}`}
            className="dk-mono"
            style={{
              fontSize: 27,
              fontWeight: 600,
              color: outcomeColor[outcome.word],
              letterSpacing: "-0.02em",
            }}
          >
            {outcome.word}
          </span>
        ))}
      </span>
      <span className="dk-slot">
        {states.map((state) => (
          <Badge key={state.key} a={`${a}-${state.key}`} tone={state.tone}>
            {state.label}
          </Badge>
        ))}
      </span>
      <span className="dk-name">{name}</span>
      <span className="dk-value">{value}</span>
    </div>
  );
}

/**
 * The plan: every record resolves to Noop, Create, or Conflict. The conflict blocks the apply; the
 * customer fixes it at their provider and checks again, which builds a separate plan with its own
 * digest. Words are the registry catalog's (Already set, Will add, Blocked, Check again).
 */
export const plan: SceneMarkup = {
  id: "plan",
  render: () => (
    <Scene>
      <Header label="02 Plan" />
      <h2
        className="dk-h dk-abs"
        style={{ left: 96, top: 150, fontSize: 80, letterSpacing: "-0.045em" }}
      >
        <Line>See every record before anything changes.</Line>
      </h2>

      <div
        data-a="panel"
        className="dk-panel dk-abs"
        style={{ left: 96, top: 290, width: 1728, height: 456 }}
      >
        <div className="dk-panel-head">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 20 }}>
            <Kicker>Plan</Kicker>
            <span className="dk-mono" style={{ fontSize: 26, fontWeight: 500 }}>
              example.com
            </span>
          </span>
          <span className="dk-slot">
            <span data-a="digest-1" className="dk-digest" style={{ justifySelf: "end" }}>
              <em>Digest</em> {blockedDigest.head}&hellip;{blockedDigest.tail}
            </span>
            <span
              data-a="digest-2"
              className="dk-digest"
              style={{ justifySelf: "end", borderColor: "var(--dk-blue)" }}
            >
              <em>Digest</em> {approvedDigest.head}&hellip;{approvedDigest.tail}
            </span>
          </span>
        </div>
        <div className="dk-table-cols" style={{ gridTemplateColumns: PLAN_COLS }}>
          <span>Type</span>
          <span>Outcome</span>
          <span>Plan</span>
          <span>Name</span>
          <span>Value</span>
        </div>
        <Row
          a="r1"
          type={spf.type}
          name={spf.name}
          value={spf.value}
          states={[
            { key: "wait", tone: "neutral", label: "Checking…" },
            { key: "done", tone: "success", label: "Already set" },
          ]}
          outcomes={[{ key: "done", word: "Noop" }]}
        />
        <Row
          a="r2"
          type={track.type}
          name={track.name}
          value={track.value}
          states={[
            { key: "wait", tone: "neutral", label: "Checking…" },
            { key: "done", tone: "warning", label: "Will add" },
          ]}
          outcomes={[{ key: "done", word: "Create" }]}
        />
        <Row
          a="r3"
          type={mail.type}
          name={mail.name}
          value={mail.value}
          last
          tint
          states={[
            { key: "wait", tone: "neutral", label: "Checking…" },
            { key: "blocked", tone: "danger", label: "Blocked" },
            { key: "done", tone: "warning", label: "Will add" },
          ]}
          outcomes={[
            { key: "blocked", word: "Conflict" },
            { key: "done", word: "Create" },
          ]}
        />
        <div
          data-a="note"
          className="dk-abs"
          style={{
            left: 0,
            right: 0,
            top: 452,
            height: 96,
            padding: "18px 32px",
            borderTop: "2px solid var(--blume-border)",
            fontSize: 24,
            lineHeight: 1.4,
            color: "var(--dk-soft)",
            background: "var(--fm-conflict-bg)",
          }}
        >
          <b style={{ color: "var(--fm-conflict)", fontWeight: 600 }}>{conflictReason}</b>{" "}
          {conflictAdvice}
        </div>
      </div>

      <div
        className="dk-abs"
        style={{
          left: 96,
          right: 96,
          top: 880,
          height: 84,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span className="dk-slot" style={{ fontSize: 30, letterSpacing: "-0.015em" }}>
          <span
            data-a="caption-1"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 16,
              color: "var(--fm-conflict)",
              fontWeight: 500,
            }}
          >
            <Lock size={32} />
            Conflicts are surfaced, never resolved silently.
          </span>
          <span data-a="caption-2" style={{ color: "var(--dk-ink)", fontWeight: 500 }}>
            Fixed at the provider. New plan, new digest.
          </span>
        </span>
        <span style={{ display: "inline-flex", gap: 24, alignItems: "center" }}>
          <span data-a="check-again" className="dk-btn dk-btn--outline" style={{ width: 260 }}>
            Check again
          </span>
          <span className="dk-slot" style={{ width: 320 }}>
            <span data-a="add-blocked" className="dk-btn dk-btn--muted" style={{ width: 320 }}>
              Add records
            </span>
            <span data-a="add-ready" className="dk-btn" style={{ width: 320 }}>
              Add 2 records
            </span>
          </span>
        </span>
      </div>
      <Cursor />
    </Scene>
  ),
};
