import type { SceneMarkup } from "../../scene";
import { mail, spf, track } from "../data";
import { Badge, Check, Header, Kicker, Scene } from "../parts";

const COLS = "130px 1fr 280px 300px";
const rows = [spf, track, mail];

/**
 * Verification reads two sources apart: the provider's own readback, and public DNS. Only the
 * public-DNS column earns "Verified in public DNS". Words follow the registry catalog (Checking
 * DNS, Found, Ready).
 */
export const verify: SceneMarkup = {
  id: "verify",
  render: () => (
    <Scene>
      <Header label="04 Verify" />
      <h2
        className="dk-h dk-abs"
        style={{
          left: 96,
          top: 150,
          fontSize: 112,
          letterSpacing: "-0.05em",
          width: 1728,
          height: 130,
        }}
      >
        <span className="dk-slot">
          <span className="dk-mask" style={{ gridArea: "1 / 1" }}>
            <span data-a="head-1">Checking public DNS&hellip;</span>
          </span>
          <span className="dk-mask" style={{ gridArea: "1 / 1" }}>
            <span data-a="head-2">Verified in public DNS.</span>
          </span>
        </span>
      </h2>

      <div
        data-a="table"
        className="dk-panel dk-abs"
        style={{ left: 96, top: 340, width: 1728, height: 456 }}
      >
        <div className="dk-panel-head">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 20 }}>
            <Kicker>Observation</Kicker>
            <span className="dk-mono" style={{ fontSize: 26, fontWeight: 500 }}>
              example.com
            </span>
          </span>
          <span className="dk-slot">
            <Badge a="overall-1" tone="neutral" style={{ justifySelf: "end" }}>
              Pending
            </Badge>
            <Badge a="overall-2" tone="success" style={{ justifySelf: "end" }}>
              Ready
            </Badge>
          </span>
        </div>
        <div className="dk-table-cols" style={{ gridTemplateColumns: COLS }}>
          <span>Type</span>
          <span>Name</span>
          <span>Provider</span>
          <span>Public DNS</span>
        </div>
        {rows.map((record, index) => (
          <div
            key={record.name}
            className={index === 2 ? "dk-row dk-row--last" : "dk-row"}
            style={{ gridTemplateColumns: COLS }}
          >
            <span className="dk-type">{record.type}</span>
            <span className="dk-name">{record.name}</span>
            <span className="dk-slot">
              <Badge a={`provider-${index}-wait`} tone="neutral">
                Checking&hellip;
              </Badge>
              <Badge a={`provider-${index}-done`} tone="neutral">
                Found
              </Badge>
            </span>
            <span className="dk-slot">
              <Badge a={`public-${index}-wait`} tone="neutral">
                Checking&hellip;
              </Badge>
              <Badge a={`public-${index}-done`} tone="success">
                Found
              </Badge>
            </span>
          </div>
        ))}
      </div>

      <div className="dk-abs" style={{ left: 96, right: 96, top: 850, height: 90 }}>
        <i className="dk-hair dk-abs" style={{ left: 0, right: 0, top: 0 }} />
        <div
          data-a="summary"
          className="dk-abs"
          style={{
            left: 0,
            top: 28,
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 36,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            color: "var(--fm-set)",
          }}
        >
          <Check size={40} />3 of 3 records found in public DNS.
        </div>
      </div>
    </Scene>
  ),
};
