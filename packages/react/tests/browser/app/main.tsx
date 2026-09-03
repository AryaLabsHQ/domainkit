/**
 * The browser fixture: `Domain.Flow` over the same fake transport the unit tests use, so the
 * Playwright run exercises the real stylesheet, portals, and focus behaviour with no host app.
 */
import { DnsRecord } from "domainkit";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Domain, DomainKit, Testing } from "../../../src/index.ts";
// oxlint-disable-next-line import/no-unassigned-import -- a stylesheet has nothing to bind
import "../../../src/styles.css";

const parameters = new URLSearchParams(window.location.search);
const zone = parameters.get("zone") ?? "example.com";
const domain = `app.${zone}`;
const colorScheme = parameters.get("scheme") === "dark" ? "dark" : "light";

const transport = Testing.transport({ provider: { oauth: true, zones: [zone] } });

const requirements = [
  DnsRecord.cname({ name: domain, purpose: "Serve your site", target: "edge.example.com" }),
  DnsRecord.txt({
    name: `_acme.${domain}`,
    purpose: "Prove ownership",
    value: "acme-verify=7f3a",
  }),
];

const container = document.querySelector("#root");
if (container === null) throw new Error("The fixture has no #root");

createRoot(container).render(
  <StrictMode>
    <DomainKit.Root colorScheme={colorScheme} theme={{ accent: "#4f46e5" }} transport={transport}>
      <Domain.Flow domain={domain} requirements={requirements} />
    </DomainKit.Root>
  </StrictMode>,
);
