import type { SceneMarkup } from "../../scene";
import { Badge, Check, Header, Line, Scene } from "../parts";

const before = [
  "Open your DNS provider.",
  "Copy each record.",
  "Paste it, field by field.",
  "Wait, then check again.",
];
const after = [
  "Connect your account.",
  "Review every record.",
  "Approve the plan.",
  "Verified in public DNS.",
];

const COL = { width: 840, left: [96, 984] as const, top: 380 } as const;

function Steps({
  items,
  color,
  dot,
}: {
  items: ReadonlyArray<string>;
  color: string;
  dot: string;
}) {
  return (
    <div className="dk-abs" style={{ left: 0, top: 70, right: 0 }}>
      {items.map((item, index) => (
        <div
          key={item}
          data-a="step"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 22,
            height: 82,
            borderBottom: "2px solid var(--blume-border)",
            fontSize: 38,
            fontWeight: 500,
            letterSpacing: "-0.03em",
            color,
          }}
        >
          <span
            className="dk-mono"
            style={{ fontSize: 22, fontWeight: 600, color: dot, width: 36 }}
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          {item}
        </div>
      ))}
    </div>
  );
}

/** Before and after: the DNS instructions page against DomainKit in the product. */
export const comparison: SceneMarkup = {
  id: "comparison",
  render: () => (
    <Scene>
      <Header label="Before and after" />
      <h1
        className="dk-h dk-abs"
        style={{ left: 96, top: 140, fontSize: 104, letterSpacing: "-0.05em" }}
      >
        <Line>Copy and paste, or approve once.</Line>
      </h1>

      <div
        data-a="side"
        className="dk-abs"
        style={{ left: COL.left[0], top: COL.top, width: COL.width, height: 580 }}
      >
        <span className="dk-kicker">DNS instructions page</span>
        <Steps items={before} color="var(--dk-soft)" dot="var(--dk-faint)" />
        <div
          className="dk-abs dk-mono"
          style={{
            left: 0,
            right: 0,
            top: 424,
            height: 156,
            border: "2px dashed var(--dk-line)",
            borderRadius: 14,
            padding: "22px 26px",
            fontSize: 23,
            lineHeight: 1.55,
            color: "var(--dk-soft)",
          }}
        >
          <div>
            <b style={{ color: "var(--dk-ink)" }}>CNAME</b> help.example.com
          </div>
          <div style={{ color: "var(--dk-ink)" }}>domains.yourapp.com</div>
          <div>
            <b style={{ color: "var(--dk-ink)" }}>TXT</b> _verify.help.example.com
          </div>
        </div>
      </div>

      <i
        data-a="divider"
        className="dk-vhair dk-abs"
        style={{ left: 959, top: COL.top, height: 580 }}
      />

      <div
        data-a="side"
        className="dk-abs"
        style={{ left: COL.left[1], top: COL.top, width: COL.width, height: 580 }}
      >
        <span className="dk-kicker dk-kicker--blue">DomainKit in your app</span>
        <Steps items={after} color="var(--dk-ink)" dot="var(--dk-blue)" />
        <div className="dk-panel dk-abs" style={{ left: 0, right: 0, top: 424, height: 156 }}>
          <div className="dk-row" style={{ gridTemplateColumns: "120px 1fr 220px", height: 78 }}>
            <span className="dk-type">CNAME</span>
            <span className="dk-name">track.example.com</span>
            <Badge tone="warning">Will add</Badge>
          </div>
          <div
            className="dk-row dk-row--last"
            style={{ gridTemplateColumns: "120px 1fr 220px", height: 76 }}
          >
            <span className="dk-type">TXT</span>
            <span className="dk-name">example.com</span>
            <Badge tone="success">Already set</Badge>
          </div>
        </div>
        <span className="dk-abs" style={{ right: 0, top: -4, color: "var(--fm-set)" }}>
          <Check size={34} />
        </span>
      </div>
    </Scene>
  ),
};
