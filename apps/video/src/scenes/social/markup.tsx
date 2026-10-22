import type { SceneMarkup } from "../../scene";
import { Kicker, Mark, Scene } from "../parts";

/** A held brand card with generous margins for both social aspect ratios. */
export const social: SceneMarkup = {
  id: "social",
  render: () => (
    <Scene>
      <div
        className="dk-abs"
        style={{ left: 120, top: 150, display: "flex", alignItems: "center", gap: 32 }}
      >
        <Mark size={112} />
        <span className="dk-h" style={{ fontSize: 88, fontWeight: 600 }}>
          DomainKit
        </span>
      </div>
      <h1
        className="dk-h dk-abs"
        style={{ left: 120, top: 412, fontSize: 112, letterSpacing: "-0.045em", lineHeight: 1.12 }}
      >
        <span style={{ display: "block" }}>Custom domains for your SaaS,</span>
        <span style={{ display: "block" }}>without the DNS instructions.</span>
      </h1>
      <i className="dk-bar dk-abs" style={{ left: 120, top: 732, width: 160 }} />
      <div className="dk-abs" style={{ left: 120, right: 120, top: 870 }}>
        <i className="dk-hair" style={{ marginBottom: 32 }} />
        <Kicker>domain-kit.dev</Kicker>
      </div>
    </Scene>
  ),
};
