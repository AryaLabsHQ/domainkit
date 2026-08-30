import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Connection, Domain, DomainKit, Testing, Transport } from "@domainkit/react";
// oxlint-disable-next-line import/no-unassigned-import -- CSS is an explicit opt-in package side effect.
import "@domainkit/react/styles.css";

const parameters = new URLSearchParams(window.location.search);
const branded = parameters.get("theme") === "brand";
const mode = parameters.get("mode") === "dark" ? "dark" : "light";
const lifecycle = parameters.get("flow") === "lifecycle";
const records: ReadonlyArray<Transport.DnsRecord> = [
  {
    id: "mx",
    name: "mail.example.com",
    priority: 10,
    type: "MX",
    value: "feedback-smtp.example.net",
  },
  {
    id: "spf",
    name: "mail.example.com",
    type: "TXT",
    value: "v=spf1 include:example.net ~all",
  },
];
const transport = Testing.makeFakeTransport({
  inspect: lifecycle
    ? {
        _tag: "Connected",
        connectionId: "connection-1",
        domain: "mail.example.com",
        provider: Testing.provider(),
      }
    : {
        _tag: "Disconnected",
        domain: "mail.example.com",
        provider: Testing.provider(),
        reusableConnection: { connectionId: "connection-1", label: "Arya Labs account" },
      },
  cleanupPlan: {
    _tag: "CleanupPlan",
    digest: "cleanup-digest-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    operations: records.map((record) => ({
      _tag: "Delete",
      id: `delete-${record.id}`,
      record,
    })),
  } satisfies Transport.CleanupPlan,
});

const root = document.getElementById("root");
if (root === null) throw new Error("DomainKit tracer root is missing");

createRoot(root).render(
  <StrictMode>
    <main
      style={{
        background: mode === "dark" ? "#09090b" : "#f4f4f5",
        boxSizing: "border-box",
        minHeight: "100vh",
        padding: "4rem",
      }}
    >
      <DomainKit.Root
        colorScheme={mode}
        theme={
          branded
            ? {
                accent: "#7c3aed",
                accentContrast: "#ffffff",
                fontFamily: "Inter, ui-sans-serif, system-ui",
                radius: "1rem",
              }
            : undefined
        }
        transport={transport}
      >
        {lifecycle ? (
          <Domain.Flow domain="mail.example.com" receiptId="receipt-1" records={records} />
        ) : (
          <Connection.Flow domain="mail.example.com" />
        )}
      </DomainKit.Root>
    </main>
  </StrictMode>,
);
