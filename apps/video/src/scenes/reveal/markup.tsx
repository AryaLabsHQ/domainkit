import type { SceneMarkup } from "../../scene";
import { Kicker, Line, Mark, Scene } from "../parts";

/**
 * The brand and the promise: the mark resolves inside its hairline frame, then the homepage H1
 * lands line by line with a blue rule under the outcome.
 */
export const reveal: SceneMarkup = {
  id: "reveal",
  render: () => (
    <Scene>
      <div className="dk-abs" style={{ left: 96, top: 170, width: 240, height: 240 }}>
        <i data-a="frame-top" className="dk-hair dk-abs" style={{ left: 0, top: 0, width: 240 }} />
        <i
          data-a="frame-bottom"
          className="dk-hair dk-abs"
          style={{ left: 0, bottom: 0, width: 240 }}
        />
        <i
          data-a="frame-left"
          className="dk-vhair dk-abs"
          style={{ left: 0, top: 0, height: 240, transformOrigin: "center top" }}
        />
        <i
          data-a="frame-right"
          className="dk-vhair dk-abs"
          style={{ right: 0, top: 0, height: 240, transformOrigin: "center top" }}
        />
        <div data-a="mark" className="dk-abs" style={{ left: 50, top: 50 }}>
          <Mark size={140} />
        </div>
      </div>
      <div className="dk-abs" style={{ left: 392, top: 246 }}>
        <div className="dk-mask">
          <span
            data-a="wordmark"
            className="dk-h"
            style={{ fontSize: 108, fontWeight: 600, letterSpacing: "-0.04em" }}
          >
            DomainKit
          </span>
        </div>
      </div>
      <h1
        data-a="h1"
        className="dk-h dk-abs"
        style={{ left: 96, top: 560, fontSize: 118, letterSpacing: "-0.045em", lineHeight: 1.06 }}
      >
        <Line>Custom domains for your SaaS,</Line>
        <span style={{ position: "relative", display: "inline-block" }}>
          <Line>without the DNS instructions.</Line>
          <i
            data-a="underline"
            className="dk-bar dk-abs"
            style={{ left: 0, right: 0, bottom: -22 }}
          />
        </span>
      </h1>
      <div
        className="dk-abs"
        style={{
          left: 96,
          right: 96,
          top: 930,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <i data-a="foot-rule" className="dk-hair dk-abs" style={{ left: 0, right: 0, top: -36 }} />
        <Kicker a="foot">Open-source TypeScript library</Kicker>
        <Kicker a="foot">domain-kit.dev</Kicker>
      </div>
    </Scene>
  ),
};
