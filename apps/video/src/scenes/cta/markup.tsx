import type { SceneMarkup } from "../../scene";
import { Kicker, Line, Mark, Scene } from "../parts";

/** The close: the lockup, the install command typed out, the address. */
export const cta: SceneMarkup = {
  id: "cta",
  render: () => (
    <Scene>
      <div
        className="dk-abs"
        style={{ left: 96, top: 90, display: "flex", alignItems: "center", gap: 28 }}
      >
        <div data-a="mark">
          <Mark size={96} />
        </div>
        <div className="dk-mask">
          <span data-a="wordmark" className="dk-h" style={{ fontSize: 80, fontWeight: 600 }}>
            DomainKit
          </span>
        </div>
      </div>
      <div
        data-a="panel"
        className="dk-panel dk-abs"
        style={{
          left: 96,
          top: 330,
          width: 1728,
          height: 280,
          display: "flex",
          alignItems: "center",
          padding: "0 64px",
        }}
      >
        <span
          className="dk-mono"
          style={{
            fontSize: 112,
            color: "var(--dk-faint)",
            marginRight: 44,
            letterSpacing: "-0.04em",
          }}
        >
          $
        </span>
        <span
          data-a="command"
          className="dk-mono"
          style={{
            fontSize: 124,
            fontWeight: 500,
            letterSpacing: "-0.05em",
            display: "inline-block",
            whiteSpace: "nowrap",
          }}
        >
          bun add domainkit
        </span>
        <i
          data-a="caret"
          style={{
            display: "block",
            width: 8,
            height: 116,
            marginLeft: 16,
            background: "var(--dk-blue)",
          }}
        />
      </div>
      <h2
        className="dk-h dk-abs"
        style={{ left: 96, top: 680, fontSize: 128, letterSpacing: "-0.05em" }}
      >
        <span style={{ position: "relative", display: "inline-block" }}>
          <Line>domain-kit.dev</Line>
          <i
            data-a="underline"
            className="dk-bar dk-abs"
            style={{ left: 0, right: 0, bottom: -20 }}
          />
        </span>
      </h2>
      <div className="dk-abs" style={{ left: 96, right: 96, top: 930 }}>
        <i data-a="foot-rule" className="dk-hair dk-abs" style={{ left: 0, right: 0, top: -36 }} />
        <Kicker a="foot">Open source. MIT license.</Kicker>
      </div>
    </Scene>
  ),
};
