/**
 * The browser fixture: the registry block over the same fake transport the package's hook tests
 * use, so the Playwright run exercises the real dialogs, portals, and focus behaviour with no host
 * application around it.
 */
import { DnsRecord, DomainKit as Kit, Reason } from "domainkit";
import type { Transport } from "domainkit/client";
import { DomainKit, Testing } from "@domainkit/react";
import * as Effect from "effect/Effect";
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

// oxlint-disable-next-line import/no-unassigned-import -- a stylesheet has nothing to bind
import "./fixture.css";

import { DomainField } from "@/components/domainkit/domain-field";
import { DomainFlow } from "@/components/domainkit/domain-flow";

const parameters = new URLSearchParams(window.location.search);
const zone = parameters.get("zone") ?? "northwind.app";
const domain = `mail.${zone}`;
// `host=none` drops the nameserver suffixes, so discovery finds no provider for the zone.
const hosted = parameters.get("host") !== "none";
// The field view offers a token method, so the fixture can grant an account without leaving the page.
const view = parameters.get("view");

const requirements = [
  DnsRecord.txt({
    name: `samva._domainkey.${domain}`,
    purpose: "Sign your mail",
    value: "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA",
  }),
  DnsRecord.mx({
    exchange: "feedback-smtp.us-east-1.amazonses.com",
    name: `mail.${domain}`,
    priority: 10,
    purpose: "Receive bounce reports",
  }),
  DnsRecord.txt({
    name: `mail.${domain}`,
    purpose: "Authorize the sender",
    value: "v=spf1 include:amazonses.com ~all",
  }),
];

const marks = {
  meridian: (
    <svg aria-hidden="true" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <rect fill="#312e81" height="32" rx="8" width="32" />
      <circle cx="16" cy="16" fill="none" r="8.5" stroke="#c7d2fe" strokeWidth="1.8" />
    </svg>
  ),
};

/** `connect=refused` makes the provider turn every credential down, which is the answer to test. */
const refusing = (transport: Transport.Interface): Transport.Interface => {
  const connection = transport.connection;
  if (connection === undefined) return transport;
  return {
    ...transport,
    connection: {
      ...connection,
      start: () =>
        Effect.fail(
          new Kit.Error({
            reason: new Reason.Unauthenticated({ message: "The token was not accepted" }),
          }),
        ),
    },
  };
};

function Fixture() {
  const transport = useMemo(
    () =>
      Testing.transport({
        provider: {
          id: "meridian",
          name: "Meridian DNS",
          labels: { [zone]: `${zone} (Northwind Traders)` },
          ...(hosted ? { nameserverSuffixes: [zone] } : {}),
          oauth: view !== "field",
          zones: [zone],
        },
      }),
    [],
  );
  const live = parameters.get("connect") === "refused" ? refusing(transport) : transport;
  const [value, setValue] = useState("");
  return (
    <DomainKit.Root
      navigate={() => {}}
      readOnly={parameters.get("mode") === "read-only"}
      transport={live}
    >
      <main>
        {view === "field" ? (
          <DomainField marks={marks} onChange={setValue} value={value} />
        ) : (
          <DomainFlow domain={domain} marks={marks} requirements={requirements} />
        )}
      </main>
    </DomainKit.Root>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
