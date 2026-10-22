import type { SceneMarkup } from "../../scene";
import { Arrow, Header, Kicker, Line, Mark, ProviderLogo, Scene } from "../parts";

export const owned = [
  "Credentials",
  "Persistence",
  "Identity",
  "Tenancy",
  "Callback routes",
  "Consent",
  "Audit",
] as const;
const verbs = ["Plan", "Approve digest", "Apply", "Receipt", "Observe DNS"] as const;

/**
 * The host boundary as a diagram: seven things your app keeps, DomainKit running inside the same
 * frame, and the customer's own provider account outside it. Only the host-ownership list from
 * truth.md; nothing stored or hosted by DomainKit.
 */
export const boundary: SceneMarkup = {
  id: "boundary",
  render: () => (
    <Scene>
      <Header label="05 Boundary" />
      <h2
        className="dk-h dk-abs"
        style={{ left: 96, top: 150, fontSize: 104, letterSpacing: "-0.05em" }}
      >
        <Line>DomainKit runs in your app.</Line>
      </h2>
      <p
        data-a="lede"
        className="dk-lede dk-abs"
        style={{ left: 96, top: 288, width: 1300, fontSize: 34 }}
      >
        Your app keeps credentials, persistence, identity, tenancy, callback routes, consent, and
        audit.
      </p>

      {/* Your app. */}
      <div
        data-a="frame"
        className="dk-abs"
        style={{
          left: 96,
          top: 440,
          width: 1160,
          height: 540,
          border: "2px solid var(--dk-ink)",
          borderRadius: 20,
        }}
      >
        <span
          className="dk-abs"
          style={{ left: 28, top: -22, padding: "0 14px", background: "var(--blume-background)" }}
        >
          <Kicker a="frame-label">Your app</Kicker>
        </span>
        <div
          className="dk-abs"
          style={{
            left: 32,
            top: 46,
            width: 560,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          {owned.map((item, index) => (
            <div
              key={item}
              data-a="owned"
              className="dk-chip"
              style={{
                gridColumn: index === 6 ? "1 / 3" : undefined,
                height: 92,
                fontSize: 28,
                paddingLeft: 20,
                paddingRight: 16,
              }}
            >
              {item}
            </div>
          ))}
        </div>
        <div
          data-a="engine"
          className="dk-abs"
          style={{
            left: 640,
            top: 46,
            width: 480,
            height: 440,
            border: "3px solid var(--dk-blue)",
            borderRadius: 16,
            background: "var(--dk-blue-wash)",
            padding: 32,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Mark size={52} color="var(--dk-blue)" />
            <span style={{ fontSize: 50, fontWeight: 600, letterSpacing: "-0.04em" }}>
              DomainKit
            </span>
          </div>
          <div className="dk-kicker dk-kicker--blue" style={{ marginTop: 18 }}>
            Library, in your process
          </div>
          <div style={{ marginTop: 28, display: "grid", gap: 4 }}>
            {verbs.map((verb) => (
              <div
                key={verb}
                data-a="verb"
                className="dk-mono"
                style={{
                  fontSize: 28,
                  height: 46,
                  display: "flex",
                  alignItems: "center",
                  borderBottom: "2px solid color-mix(in srgb, var(--dk-blue) 18%, transparent)",
                }}
              >
                {verb}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* The line out, and the customer's own account. */}
      <i
        data-a="link"
        className="dk-abs"
        style={{
          left: 1256,
          top: 640,
          width: 168,
          height: 4,
          background: "var(--dk-blue)",
          transformOrigin: "left center",
        }}
      />
      <div
        data-a="link-head"
        className="dk-abs"
        style={{ left: 1404, top: 630, color: "var(--dk-blue)" }}
      >
        <Arrow size={26} />
      </div>
      <div
        data-a="provider"
        className="dk-abs"
        style={{ left: 1440, top: 440, width: 384, height: 540 }}
      >
        <Kicker blue>Customer&rsquo;s own account</Kicker>
        {(["cloudflare", "vercel"] as const).map((id, index) => (
          <div
            key={id}
            data-a="provider-card"
            className="dk-panel dk-abs"
            style={{
              left: 0,
              right: 0,
              top: 70 + index * 178,
              height: 150,
              display: "flex",
              alignItems: "center",
              gap: 24,
              padding: "0 28px",
              fontSize: 38,
              fontWeight: 600,
              letterSpacing: "-0.03em",
            }}
          >
            <ProviderLogo provider={id} size={id === "cloudflare" ? 84 : 52} />
            {id === "cloudflare" ? "Cloudflare" : "Vercel"}
          </div>
        ))}
      </div>
    </Scene>
  ),
};
