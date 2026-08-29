import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Connection, DomainKit, Testing } from "@domainkit/react";
// oxlint-disable-next-line import/no-unassigned-import -- CSS is an explicit opt-in package side effect.
import "@domainkit/react/styles.css";

const parameters = new URLSearchParams(window.location.search);
const branded = parameters.get("theme") === "brand";
const mode = parameters.get("mode") === "dark" ? "dark" : "light";
const transport = Testing.makeFakeTransport({
  inspect: {
    _tag: "Disconnected",
    domain: "mail.example.com",
    provider: Testing.provider(),
    reusableConnection: { connectionId: "connection-1", label: "Arya Labs account" },
  },
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
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>
    </main>
  </StrictMode>,
);
