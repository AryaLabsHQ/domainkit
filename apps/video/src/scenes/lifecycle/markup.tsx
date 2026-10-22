import type { SceneMarkup } from "../../scene";
import { Header, Line, Scene } from "../parts";

export const steps = [
  { n: "01", name: "Connect", detail: "The customer’s own Cloudflare or Vercel account." },
  { n: "02", name: "Discover zone", detail: "Find the zone that serves the domain." },
  { n: "03", name: "Plan", detail: "Noop, Create, or Conflict for every record." },
  { n: "04", name: "Approve digest", detail: "The customer approves the exact plan." },
  { n: "05", name: "Apply", detail: "Only the approved digest." },
  { n: "06", name: "Receipt", detail: "A record of what the attempt completed." },
  { n: "07", name: "Observe DNS", detail: "Provider and public-DNS evidence." },
  { n: "08", name: "Clean up", detail: "Separately approved. Bound to the receipt." },
] as const;

const CARD = { width: 390, height: 236, gap: 56, left: 96, top: [376, 686] } as const;
const x = (column: number) => CARD.left + column * (CARD.width + CARD.gap);

/**
 * The lifecycle as two rows of four stations: connect to approve, then apply to cleanup. Hairlines
 * join the stations; the last is dashed and blue because cleanup is its own approval.
 */
export const lifecycle: SceneMarkup = {
  id: "lifecycle",
  render: () => (
    <Scene>
      <Header label="Lifecycle" />
      <h1
        className="dk-h dk-abs"
        style={{ left: 96, top: 140, fontSize: 88, letterSpacing: "-0.05em" }}
      >
        <Line>From connect to cleanup,</Line>
        <Line>each write is approved.</Line>
      </h1>

      {steps.map((step, index) => {
        const row = Math.floor(index / 4);
        const column = index % 4;
        const last = index === 7;
        return (
          <div
            key={step.n}
            data-a="station"
            className={last ? "dk-card dk-card--dashed" : "dk-card"}
            style={{ left: x(column), top: CARD.top[row], width: CARD.width, height: CARD.height }}
          >
            <div className="dk-num">{step.n}</div>
            <div
              style={{
                marginTop: 18,
                fontSize: 44,
                fontWeight: 600,
                letterSpacing: "-0.035em",
                lineHeight: 1.05,
              }}
            >
              {step.name}
            </div>
            <div style={{ marginTop: 14, fontSize: 25, lineHeight: 1.32, color: "var(--dk-soft)" }}>
              {step.detail}
            </div>
            {last && (
              <span className="dk-tag dk-tag--blue dk-abs" style={{ right: 20, top: 20 }}>
                Own approval
              </span>
            )}
          </div>
        );
      })}

      {/* Joins within each row. */}
      {[0, 1].flatMap((row) =>
        [0, 1, 2].map((column) => (
          <i
            key={`${row}-${column}`}
            data-a="join"
            className="dk-abs"
            style={{
              left: x(column) + CARD.width,
              top: CARD.top[row] + CARD.height / 2 - 1,
              width: CARD.gap,
              height: 2,
              background: "var(--dk-blue)",
              transformOrigin: "left center",
            }}
          />
        )),
      )}
      {/* The turn from approve to apply. */}
      <i
        data-a="turn"
        className="dk-abs"
        style={{
          left: x(3) + CARD.width / 2 - 1,
          top: CARD.top[0] + CARD.height,
          width: 2,
          height: 36,
          background: "var(--dk-blue)",
          transformOrigin: "center top",
        }}
      />
      <i
        data-a="turn"
        className="dk-abs"
        style={{
          left: x(0) + CARD.width / 2,
          top: CARD.top[0] + CARD.height + 35,
          width: x(3) - x(0),
          height: 2,
          background: "var(--dk-blue)",
          transformOrigin: "right center",
        }}
      />
      <i
        data-a="turn"
        className="dk-abs"
        style={{
          left: x(0) + CARD.width / 2 - 1,
          top: CARD.top[0] + CARD.height + 36,
          width: 2,
          height: CARD.top[1] - CARD.top[0] - CARD.height - 36,
          background: "var(--dk-blue)",
          transformOrigin: "center top",
        }}
      />
    </Scene>
  ),
};
