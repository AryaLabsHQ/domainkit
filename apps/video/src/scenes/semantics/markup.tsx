import type { SceneMarkup } from "../../scene";
import { Badge, Header, Line, Scene } from "../parts";

const outcomes = [
  {
    word: "Noop",
    color: "var(--fm-set)",
    bg: "var(--fm-set-bg)",
    tone: "success",
    badge: "Already set",
    rule: "A matching record is already there.",
    record: ["TXT", "example.com", "v=spf1 include:_spf.yourapp.com ~all"],
    result: "Nothing is written.",
  },
  {
    word: "Create",
    color: "var(--fm-add)",
    bg: "var(--fm-add-bg)",
    tone: "warning",
    badge: "Will add",
    rule: "The record is missing.",
    record: ["CNAME", "track.example.com", "track.yourapp.com"],
    result: "Added once the digest is approved.",
  },
  {
    word: "Conflict",
    color: "var(--fm-conflict)",
    bg: "var(--fm-conflict-bg)",
    tone: "danger",
    badge: "Blocked",
    rule: "Incompatible state is in the way.",
    record: ["CNAME", "mail.example.com", "A CNAME cannot share a name with other records."],
    result: "Surfaced, never resolved silently.",
  },
] as const;

const COL = { width: 544, gap: 48, left: 96, top: 400, height: 456 } as const;

/** Plan semantics: three outcomes, each with a real record and what happens next. */
export const semantics: SceneMarkup = {
  id: "semantics",
  render: () => (
    <Scene>
      <Header label="Plan semantics" />
      <h1
        className="dk-h dk-abs"
        style={{ left: 96, top: 140, fontSize: 104, letterSpacing: "-0.05em" }}
      >
        <Line>Three outcomes for every record.</Line>
      </h1>
      <p data-a="lede" className="dk-lede dk-abs" style={{ left: 96, top: 276, fontSize: 36 }}>
        Plans are additive and fail closed.
      </p>
      {outcomes.map((outcome, index) => (
        <div
          key={outcome.word}
          data-a="column"
          className="dk-card"
          style={{
            left: COL.left + index * (COL.width + COL.gap),
            top: COL.top,
            width: COL.width,
            height: COL.height,
            padding: 0,
            overflow: "hidden",
          }}
        >
          <i
            className="dk-abs"
            style={{ left: 0, right: 0, top: 0, height: 8, background: outcome.color }}
          />
          <div
            className="dk-abs"
            style={{
              left: 32,
              top: 36,
              fontSize: 92,
              fontWeight: 500,
              letterSpacing: "-0.05em",
              color: outcome.color,
              lineHeight: 1,
            }}
          >
            {outcome.word}
          </div>
          <div
            className="dk-abs"
            style={{
              left: 32,
              top: 150,
              right: 32,
              fontSize: 30,
              lineHeight: 1.25,
              color: "var(--dk-ink)",
              letterSpacing: "-0.015em",
            }}
          >
            {outcome.rule}
          </div>
          <div
            className="dk-abs"
            style={{
              left: 32,
              right: 32,
              top: 232,
              padding: "18px 20px",
              background: outcome.bg,
              borderRadius: 12,
            }}
          >
            <div className="dk-mono" style={{ fontSize: 21, color: "var(--dk-soft)" }}>
              <b style={{ color: "var(--dk-ink)", fontWeight: 600 }}>{outcome.record[0]}</b>{" "}
              {outcome.record[1]}
            </div>
            <div
              className="dk-mono"
              style={{ fontSize: 21, marginTop: 8, lineHeight: 1.3, color: "var(--dk-ink)" }}
            >
              {outcome.record[2]}
            </div>
          </div>
          <div className="dk-abs" style={{ left: 32, top: 372 }}>
            <Badge tone={outcome.tone}>{outcome.badge}</Badge>
          </div>
          <div
            className="dk-abs"
            style={{ left: 32, right: 32, bottom: 22, fontSize: 24, color: "var(--dk-soft)" }}
          >
            {outcome.result}
          </div>
        </div>
      ))}
      <div className="dk-abs" style={{ left: 96, top: 910, display: "flex", gap: 16 }}>
        {["Additive", "Reviewable", "Digest-bound", "Fail-closed"].map((tag) => (
          <span key={tag} data-a="tag" className="dk-tag">
            {tag}
          </span>
        ))}
      </div>
    </Scene>
  ),
};
