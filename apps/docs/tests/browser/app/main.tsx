/**
 * The browser fixture: the registry block over the same fake transport the package's hook tests
 * use, so the Playwright run exercises the real dialogs, portals, and focus behaviour with no host
 * application around it.
 */
import { DomainKit as Kit, Reason } from "domainkit";
import { Transport } from "domainkit/client";
import { DomainKit, Testing } from "@domainkit/react";
import * as Effect from "effect/Effect";
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

// oxlint-disable-next-line import/no-unassigned-import -- a stylesheet has nothing to bind
import "./fixture.css";

import { DomainField } from "@/components/domainkit/domain-field";
import { DomainFlow } from "@/components/domainkit/domain-flow";
import { conflictSeedFor, requirementsFor, seedFor } from "../../../lib/preview-flow.tsx";

const parameters = new URLSearchParams(window.location.search);
const zone = parameters.get("zone") ?? "northwind.app";
const domain = `mail.${zone}`;
// `host=none` drops the nameserver suffixes, so discovery finds no provider for the zone.
const hosted = parameters.get("host") !== "none";
// The field view offers a token method, so the fixture can grant an account without leaving the page.
const view = parameters.get("view");

const requirements = requirementsFor(domain);
// `seed=conflict` puts an A record on the tracking host, which blocks its CNAME.
const seed = parameters.get("seed") === "conflict" ? conflictSeedFor(domain) : seedFor(domain);

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

/** The memory host lives at domainkit.test; give it an equivalent host-relative destination. */
const browserDestination = (transport: Transport.Interface): Transport.Interface => {
  const connection = transport.connection;
  if (connection === undefined) return transport;
  return {
    ...transport,
    connection: {
      ...connection,
      start: (input) => {
        const method = input.method;
        if (method._tag !== "OAuth" || method.returnTo === undefined)
          return connection.start(input);
        const url = new URL(method.returnTo, window.location.href);
        if (url.origin !== window.location.origin) return connection.start(input);
        return connection.start({
          ...input,
          method: Transport.Method.oauth({ returnTo: `${url.pathname}${url.search}${url.hash}` }),
        });
      },
    },
  };
};

function Fixture() {
  const transport = useMemo(
    () =>
      Testing.transport({
        provider: {
          id: "meridian",
          name: "Meridian",
          labels: { [zone]: `${zone} (Northwind Traders)` },
          ...(hosted ? { nameserverSuffixes: [zone] } : {}),
          oauth: parameters.get("method") === "oauth" || view !== "field",
          records: seed.map((record) => ({ record, zone })),
          zones: [zone],
        },
      }),
    [],
  );
  const browser = useMemo(() => browserDestination(transport), [transport]);
  const live = parameters.get("connect") === "refused" ? refusing(browser) : browser;
  const [value, setValue] = useState("");
  const [destination, setDestination] = useState("");
  return (
    <DomainKit.Root
      navigate={setDestination}
      readOnly={parameters.get("mode") === "read-only"}
      transport={live}
    >
      <output data-slot="fixture-destination" hidden>
        {destination}
      </output>
      <output data-slot="fixture-calls" hidden>
        {JSON.stringify(transport.calls)}
      </output>
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
