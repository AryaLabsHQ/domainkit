import type { SceneMarkup } from "../../scene";
import { Header, Kicker, Line, Mark, Scene } from "../parts";
import { owned } from "../boundary/markup";

const does = [
  "Plans exact changes",
  "Applies the approved digest",
  "Returns a receipt",
  "Observes DNS",
];

/** The ownership split: seven things the host keeps, four things DomainKit does. */
export const hostBoundary: SceneMarkup = {
  id: "host-boundary",
  render: () => (
    <Scene>
      <Header label="Host boundary" />
      <h1
        className="dk-h dk-abs"
        style={{ left: 96, top: 140, fontSize: 84, letterSpacing: "-0.05em" }}
      >
        <Line>What your app keeps,</Line>
        <Line>and what DomainKit does.</Line>
      </h1>

      <div className="dk-abs" style={{ left: 96, top: 380, width: 960 }}>
        <Kicker a="left-kicker">Your app keeps</Kicker>
        {owned.map((item, index) => (
          <div
            key={item}
            data-a="owned"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 28,
              height: 76,
              marginTop: index === 0 ? 14 : 0,
              borderBottom: "2px solid var(--dk-line)",
              fontSize: 46,
              fontWeight: 500,
              letterSpacing: "-0.04em",
            }}
          >
            <span className="dk-mono" style={{ fontSize: 20, color: "var(--dk-faint)", width: 40 }}>
              {String(index + 1).padStart(2, "0")}
            </span>
            {item}
          </div>
        ))}
      </div>

      <div
        data-a="engine"
        className="dk-abs"
        style={{
          left: 1176,
          top: 380,
          width: 648,
          height: 580,
          border: "3px solid var(--dk-blue)",
          borderRadius: 18,
          background: "var(--dk-blue-wash)",
          padding: 36,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Mark size={64} color="var(--dk-blue)" />
          <span style={{ fontSize: 58, fontWeight: 600, letterSpacing: "-0.045em" }}>
            DomainKit
          </span>
        </div>
        <div className="dk-kicker dk-kicker--blue" style={{ marginTop: 18 }}>
          Runs in your app
        </div>
        <div style={{ marginTop: 28 }}>
          {does.map((item) => (
            <div
              key={item}
              data-a="does"
              style={{
                height: 72,
                display: "flex",
                alignItems: "center",
                borderBottom: "2px solid color-mix(in srgb, var(--dk-blue) 20%, transparent)",
                fontSize: 33,
                fontWeight: 500,
                letterSpacing: "-0.025em",
              }}
            >
              {item}
            </div>
          ))}
        </div>
        <div
          className="dk-mono dk-abs"
          style={{ left: 36, bottom: 28, fontSize: 24, color: "var(--dk-blue)" }}
        >
          Interfaces, not custody.
        </div>
      </div>
    </Scene>
  ),
};
