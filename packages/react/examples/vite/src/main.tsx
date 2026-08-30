import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { stateFromSearch, Workshop } from "./workshop.tsx";
// oxlint-disable-next-line import/no-unassigned-import -- CSS is an explicit opt-in package side effect.
import "@domainkit/react/styles.css";
// oxlint-disable-next-line import/no-unassigned-import -- Workshop chrome is example-only.
import "./workshop.css";

const root = document.getElementById("root");
if (root === null) throw new Error("DomainKit workshop root is missing");

createRoot(root).render(
  <StrictMode>
    <Workshop initial={stateFromSearch(window.location.search)} />
  </StrictMode>,
);
