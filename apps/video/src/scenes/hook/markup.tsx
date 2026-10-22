import type { SceneMarkup } from "../../scene";
import { Cursor, Kicker, Line, Scene } from "../parts";
import { ROW_HEIGHT, ROW_TOP, WINDOW, rows } from "./layout";

/**
 * The villain: a copy-paste DNS instructions page. A pointer copies a value, switches browser
 * tabs, and pastes it into a DNS provider's form; the words Copy. Paste. Wait. land with each
 * step, then the line the film turns on. The browser is generic: no real vendor's chrome.
 */
export const hook: SceneMarkup = {
  id: "hook",
  render: () => (
    <Scene>
      {/* The words, one per step. */}
      <div className="dk-abs" style={{ left: 96, top: 214 }}>
        {["Copy.", "Paste.", "Wait."].map((word) => (
          <div key={word} className="dk-mask" style={{ height: 184 }}>
            <span
              data-a="step-word"
              className="dk-h"
              style={{ fontSize: 176, lineHeight: 1.05, fontWeight: 500 }}
            >
              {word}
            </span>
          </div>
        ))}
      </div>

      {/* The page the customer is following. */}
      <div
        data-a="window"
        className="dk-window"
        style={{ left: WINDOW.left, top: WINDOW.top, width: WINDOW.width, height: WINDOW.height }}
      >
        <div className="dk-tabs">
          <div className="dk-tab" style={{ marginBottom: -2 }}>
            yourapp.com
            <div data-a="tab-1-on" className="dk-tab-on">
              yourapp.com
            </div>
          </div>
          <div className="dk-tab" style={{ marginBottom: -2 }}>
            DNS provider
            <div data-a="tab-2-on" className="dk-tab-on">
              DNS provider
            </div>
          </div>
        </div>

        <div data-a="page-1" className="dk-abs" style={{ inset: `${WINDOW.tabs}px 0 0 0` }}>
          <div
            className="dk-mono"
            style={{
              height: 64,
              padding: "0 32px",
              display: "flex",
              alignItems: "center",
              fontSize: 21,
              color: "var(--dk-faint)",
              borderBottom: "2px solid var(--blume-border)",
            }}
          >
            yourapp.com/settings/domains
          </div>
          <div
            className="dk-abs"
            style={{ left: 32, top: 92, fontSize: 38, fontWeight: 600, letterSpacing: "-0.03em" }}
          >
            Add these records at your DNS provider
          </div>
          <div
            className="dk-abs"
            style={{ left: 32, top: 150, fontSize: 24, color: "var(--dk-soft)" }}
          >
            Copy each value into your DNS settings.
          </div>
          {rows.map((row, index) => (
            <div
              key={row.name}
              className="dk-abs"
              style={{
                left: 0,
                right: 0,
                top: ROW_TOP + ROW_HEIGHT * index,
                height: ROW_HEIGHT,
                borderTop: "2px solid var(--blume-border)",
              }}
            >
              <div
                className="dk-mono dk-abs"
                style={{ left: 32, top: 24, fontSize: 21, color: "var(--dk-soft)" }}
              >
                <b style={{ color: "var(--dk-ink)", fontWeight: 600 }}>{row.type}</b>
                {"  "}
                {row.name}
              </div>
              {index === 0 && (
                <i
                  data-a="select"
                  className="dk-abs"
                  style={{
                    left: 28,
                    top: 62,
                    width: 330,
                    height: 46,
                    background: "color-mix(in srgb, var(--dk-blue) 18%, transparent)",
                    transformOrigin: "left center",
                  }}
                />
              )}
              <div
                className="dk-mono dk-abs"
                style={{
                  left: 32,
                  top: 66,
                  fontSize: 27,
                  color: "var(--dk-ink)",
                  whiteSpace: "nowrap",
                }}
              >
                {row.value}
              </div>
              <div className="dk-abs" style={{ right: 32, top: 40 }}>
                <span
                  className="dk-btn dk-btn--outline dk-btn--sm"
                  style={{ width: 128 }}
                  data-a={index === 0 ? "copy" : undefined}
                >
                  Copy
                </span>
                {index === 0 && (
                  <span
                    data-a="copied"
                    className="dk-btn dk-btn--sm dk-abs"
                    style={{
                      left: 0,
                      top: 0,
                      width: 128,
                      background: "var(--fm-set-bg)",
                      borderColor: "var(--fm-set)",
                      color: "var(--fm-set)",
                    }}
                  >
                    Copied
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div data-a="page-2" className="dk-abs" style={{ inset: `${WINDOW.tabs}px 0 0 0` }}>
          <div
            className="dk-mono"
            style={{
              height: 64,
              padding: "0 32px",
              display: "flex",
              alignItems: "center",
              fontSize: 21,
              color: "var(--dk-faint)",
              borderBottom: "2px solid var(--blume-border)",
            }}
          >
            dns.provider.example/example.com
          </div>
          <div
            className="dk-abs"
            style={{ left: 32, top: 92, fontSize: 38, fontWeight: 600, letterSpacing: "-0.03em" }}
          >
            Add record
          </div>
          {[
            { label: "Type", value: "CNAME", top: 180 },
            { label: "Name", value: "help", top: 310 },
          ].map((field) => (
            <div
              key={field.label}
              className="dk-abs"
              style={{ left: 32, right: 32, top: field.top }}
            >
              <div className="dk-field-label">{field.label}</div>
              <div className="dk-field" style={{ marginTop: 10 }}>
                {field.value}
              </div>
            </div>
          ))}
          <div className="dk-abs" style={{ left: 32, right: 32, top: 440 }}>
            <div className="dk-field-label">Target</div>
            <div className="dk-field" style={{ marginTop: 10 }}>
              <span data-a="paste">domains.yourapp.com</span>
              <i
                data-a="caret"
                className="dk-abs"
                style={{ left: 24, top: 18, width: 3, height: 40, background: "var(--dk-blue)" }}
              />
            </div>
          </div>
          <div className="dk-abs" style={{ left: 32, top: 590 }}>
            <span data-a="save" className="dk-btn" style={{ width: 180, height: 76 }}>
              Save
            </span>
            <div
              data-a="waiting"
              className="dk-abs"
              style={{
                left: 0,
                top: 0,
                height: 76,
                display: "flex",
                alignItems: "center",
                gap: 20,
                whiteSpace: "nowrap",
                fontSize: 28,
                fontWeight: 500,
                color: "var(--dk-soft)",
              }}
            >
              <i data-a="spin" className="dk-spin" />
              Waiting for DNS to update
            </div>
          </div>
        </div>
      </div>

      {/* The line the film turns on. */}
      <div className="dk-abs" style={{ left: 96, top: 232 }}>
        <Kicker a="stall-kicker">The DNS instructions page</Kicker>
      </div>
      <h1
        className="dk-h dk-abs"
        style={{ left: 96, top: 312, fontSize: 164, letterSpacing: "-0.045em" }}
      >
        <Line a="stall-line">Custom domain setup</Line>
        <Line a="stall-line">
          <span style={{ color: "var(--fm-conflict)" }}>stalls here.</span>
        </Line>
      </h1>
      <div className="dk-abs" style={{ left: 96, right: 96, top: 800, height: 2 }}>
        <i data-a="track" className="dk-hair" style={{ width: "100%" }} />
        <i
          data-a="fill"
          className="dk-abs"
          style={{
            left: 0,
            top: -2,
            width: "62%",
            height: 6,
            background: "var(--dk-ink)",
            transformOrigin: "left center",
          }}
        />
        <i
          data-a="stop"
          className="dk-abs"
          style={{
            left: "62%",
            top: -22,
            width: 6,
            height: 46,
            background: "var(--fm-conflict)",
            marginLeft: -3,
          }}
        />
      </div>

      <Cursor />
    </Scene>
  ),
};
