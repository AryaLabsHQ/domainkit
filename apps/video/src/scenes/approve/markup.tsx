import type { SceneMarkup } from "../../scene";
import { approvedDigest, mail, track, spf } from "../data";
import { Badge, Check, Cursor, Header, Kicker, Lock, Scene } from "../parts";
import { BUTTON, CARD } from "./layout";

const COLS = "110px 240px 1fr";

function Stack({ a, children }: { a: string; children: React.ReactNode }) {
  return (
    <span className="dk-slot" data-a={a}>
      {children}
    </span>
  );
}

/**
 * Approve the exact plan, apply only that digest, keep the receipt. The plan is the compatible one
 * from the plan scene; its digest is the thing the customer approves, and the receipt carries it.
 */
export const approve: SceneMarkup = {
  id: "approve",
  render: () => (
    <Scene>
      <Header label="03 Approve" />
      <h2
        className="dk-h dk-abs"
        style={{
          left: 96,
          top: 150,
          fontSize: 80,
          letterSpacing: "-0.045em",
          width: 1728,
          height: 100,
        }}
      >
        <span className="dk-slot">
          {["Approve the exact plan.", "Apply only what was approved.", "Keep a receipt."].map(
            (text) => (
              <span key={text} className="dk-mask" style={{ gridArea: "1 / 1" }}>
                <span data-a="caption">{text}</span>
              </span>
            ),
          )}
        </span>
      </h2>

      <div
        className="dk-panel dk-abs"
        data-a="table"
        style={{ left: 96, top: 290, width: 1040, height: 456 }}
      >
        <div className="dk-panel-head">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 20 }}>
            <Kicker>Plan</Kicker>
            <span className="dk-mono" style={{ fontSize: 26, fontWeight: 500 }}>
              example.com
            </span>
          </span>
        </div>
        <div className="dk-table-cols" style={{ gridTemplateColumns: COLS }}>
          <span>Type</span>
          <span>Status</span>
          <span>Name</span>
        </div>
        <div className="dk-row" style={{ gridTemplateColumns: COLS }}>
          <span className="dk-type">{spf.type}</span>
          <Badge tone="success">Already set</Badge>
          <span className="dk-name">{spf.name}</span>
        </div>
        {[track, mail].map((record, index) => (
          <div
            key={record.name}
            className={index === 1 ? "dk-row dk-row--last" : "dk-row"}
            style={{ gridTemplateColumns: COLS }}
          >
            <span className="dk-type">{record.type}</span>
            <Stack a={`state-${index}`}>
              <Badge a={`state-${index}-plan`} tone="warning">
                Will add
              </Badge>
              <Badge a={`state-${index}-busy`} tone="action">
                Adding&hellip;
              </Badge>
              <Badge a={`state-${index}-done`} tone="success">
                Added
              </Badge>
            </Stack>
            <span className="dk-name">{record.name}</span>
          </div>
        ))}
      </div>

      <div className="dk-abs" style={{ left: 96, top: 790, width: 1040 }}>
        <div
          className="dk-slot"
          style={{ fontSize: 30, fontWeight: 500, letterSpacing: "-0.015em", height: 44 }}
        >
          <span data-a="progress-label" style={{ color: "var(--dk-soft)" }}>
            Adding records&hellip;
          </span>
          <span
            data-a="progress-done"
            style={{
              color: "var(--fm-set)",
              display: "inline-flex",
              gap: 14,
              alignItems: "center",
            }}
          >
            <Check size={30} />
            DNS records added.
          </span>
        </div>
        <i data-a="track" className="dk-hair dk-abs" style={{ left: 0, right: 0, top: 70 }} />
        <i data-a="progress" className="dk-bar dk-abs" style={{ left: 0, right: 0, top: 68 }} />
      </div>

      <div
        data-a="digest-card"
        className="dk-panel dk-abs"
        style={{
          left: CARD.left,
          top: CARD.top,
          width: CARD.width,
          height: CARD.height,
          overflow: "visible",
        }}
      >
        <i
          data-a="card-ring"
          className="dk-abs"
          style={{ inset: -2, border: "3px solid var(--dk-blue)", borderRadius: 16 }}
        />
        <div className="dk-abs" style={{ left: 30, top: 26 }}>
          <Stack a="digest-kicker">
            <Kicker a="digest-kicker-1">Plan digest</Kicker>
            <span
              data-a="digest-kicker-2"
              className="dk-kicker dk-kicker--blue"
              style={{ display: "inline-flex", alignItems: "center", gap: 12 }}
            >
              <Lock size={24} />
              Approved digest
            </span>
          </Stack>
        </div>
        <div
          className="dk-mono dk-abs"
          style={{
            left: 30,
            top: 74,
            fontSize: 46,
            fontWeight: 500,
            lineHeight: 1.18,
            letterSpacing: "0.02em",
          }}
        >
          <div>
            <span
              style={{
                fontSize: 22,
                color: "var(--dk-faint)",
                letterSpacing: "0.04em",
                marginRight: 14,
              }}
            >
              sha256
            </span>
            {approvedDigest.head}
          </div>
          <div style={{ paddingLeft: 134 }}>&hellip;{approvedDigest.tail}</div>
        </div>
        <div
          className="dk-abs dk-slot"
          style={{ left: BUTTON.left, top: BUTTON.top, width: BUTTON.width, height: BUTTON.height }}
        >
          <span data-a="approve" className="dk-btn" style={{ width: BUTTON.width }}>
            Approve
          </span>
          <span
            data-a="approved"
            className="dk-btn"
            style={{
              width: BUTTON.width,
              background: "var(--fm-set-bg)",
              borderColor: "var(--fm-set)",
              color: "var(--fm-set)",
            }}
          >
            <Check size={34} />
            Approved
          </span>
        </div>
      </div>

      <i
        data-a="tie"
        className="dk-vhair dk-abs"
        style={{ left: 1503, top: 600, height: 30, width: 3, background: "var(--dk-blue)" }}
      />

      <div
        data-a="receipt"
        className="dk-panel dk-abs"
        style={{ left: CARD.left, top: 630, width: CARD.width, height: 330 }}
      >
        <div className="dk-panel-head" style={{ height: 68 }}>
          <Kicker>Receipt</Kicker>
          <span className="dk-mono" style={{ fontSize: 22, color: "var(--dk-faint)" }}>
            example.com
          </span>
        </div>
        {[
          ["Digest", `${approvedDigest.head}…${approvedDigest.tail}`],
          ["Added", "2"],
          ["Already set", "1"],
        ].map(([label, value], line) => (
          <div
            key={label}
            data-a="receipt-line"
            className="dk-abs dk-mono"
            style={{
              left: 30,
              right: 30,
              height: 52,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 28,
              borderBottom: "2px solid var(--blume-border)",
              top: 82 + line * 56,
            }}
          >
            <span style={{ color: "var(--dk-soft)" }}>{label}</span>
            <span style={{ fontWeight: 500 }}>{value}</span>
          </div>
        ))}
        <div
          data-a="receipt-status"
          className="dk-abs"
          style={{
            left: 30,
            top: 262,
            display: "inline-flex",
            gap: 14,
            alignItems: "center",
            fontSize: 28,
            fontWeight: 500,
            color: "var(--fm-set)",
          }}
        >
          <Check size={30} />
          DNS records added.
        </div>
      </div>
      <Cursor />
    </Scene>
  ),
};
