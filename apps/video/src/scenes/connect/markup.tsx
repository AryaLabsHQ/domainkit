import type { SceneMarkup } from "../../scene";
import { Arrow, Check, Cursor, Header, Kicker, Line, ProviderLogo, Scene } from "../parts";
import { DIALOG, ROW } from "./layout";

const providers = [
  { id: "cloudflare", name: "Cloudflare" },
  { id: "vercel", name: "Vercel" },
] as const;

/**
 * The customer connects their own account. The dialog follows the registry's connect dialog, with
 * its catalog words: "Connect a DNS provider", "Authorize DNS changes for ...", "Continue with ...".
 */
export const connect: SceneMarkup = {
  id: "connect",
  render: () => (
    <Scene>
      <Header label="01 Connect" />
      <div className="dk-abs" style={{ left: 96, top: 180 }}>
        <Kicker a="kicker" blue>
          Connect
        </Kicker>
      </div>
      <h2
        className="dk-h dk-abs"
        style={{ left: 96, top: 250, fontSize: 112, letterSpacing: "-0.045em" }}
      >
        <Line>Connect the</Line>
        <Line>customer&rsquo;s own</Line>
        <Line>Cloudflare or</Line>
        <Line>Vercel account.</Line>
      </h2>
      <p data-a="lede" className="dk-lede dk-abs" style={{ left: 96, top: 800, width: 760 }}>
        Cloudflare and Vercel are built in.
      </p>

      <div
        data-a="dialog"
        className="dk-panel dk-abs"
        style={{ left: DIALOG.left, top: DIALOG.top, width: DIALOG.width, height: DIALOG.height }}
      >
        <div
          className="dk-abs"
          style={{ left: 44, top: 48, fontSize: 48, fontWeight: 600, letterSpacing: "-0.03em" }}
        >
          Connect a DNS provider
        </div>
        <div
          className="dk-abs"
          style={{ left: 44, top: 118, fontSize: 30, color: "var(--dk-soft)" }}
        >
          Authorize DNS changes for example.com.
        </div>
        {providers.map((provider, index) => (
          <div
            key={provider.id}
            data-a={`row-${provider.id}`}
            className="dk-abs"
            style={{
              left: ROW.left,
              right: ROW.left,
              top: ROW.top + index * (ROW.height + ROW.gap),
              height: ROW.height,
              border: "2px solid var(--dk-line)",
              borderRadius: 14,
              background: "var(--fm-panel)",
              display: "flex",
              alignItems: "center",
              gap: 24,
              padding: "0 28px",
              fontSize: 36,
              fontWeight: 500,
              letterSpacing: "-0.02em",
            }}
          >
            <span
              data-a={`${provider.id}-content`}
              style={{ flex: 1, display: "flex", alignItems: "center", gap: 24 }}
            >
              <ProviderLogo provider={provider.id} size={provider.id === "cloudflare" ? 92 : 58} />
              <span style={{ flex: 1 }}>Continue with {provider.name}</span>
              <Arrow size={36} />
            </span>
            {provider.id === "cloudflare" && (
              <>
                <i
                  data-a="row-ring"
                  className="dk-ring dk-abs"
                  style={{ inset: -6, borderRadius: 18 }}
                />
                <div
                  data-a="row-connected"
                  className="dk-abs"
                  style={{
                    inset: -2,
                    border: "2px solid var(--fm-set)",
                    borderRadius: 14,
                    background: "var(--fm-set-bg)",
                    color: "var(--fm-set)",
                    display: "flex",
                    alignItems: "center",
                    gap: 24,
                    padding: "0 28px",
                  }}
                >
                  <ProviderLogo provider="cloudflare" size={92} />
                  <span style={{ flex: 1 }}>Cloudflare connected</span>
                  <Check size={36} a="check" />
                </div>
              </>
            )}
          </div>
        ))}
        <div
          data-a="destination"
          className="dk-abs dk-mono"
          style={{ left: 44, top: 600, fontSize: 28, color: "var(--dk-soft)" }}
        >
          Your app keeps the provider credentials.
        </div>
      </div>
      <Cursor />
    </Scene>
  ),
};
