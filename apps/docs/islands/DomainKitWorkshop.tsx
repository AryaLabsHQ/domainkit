import { Workshop, stateFromSearch } from "../../../packages/react/examples/vite/src/workshop.tsx";
// oxlint-disable-next-line import/no-unassigned-import -- The workshop consumes the package stylesheet as an explicit visual dependency.
import "../../../packages/react/src/styles.css";
// oxlint-disable-next-line import/no-unassigned-import -- The existing Vite workshop remains the shared presentation source.
import "../../../packages/react/examples/vite/src/workshop.css";
// oxlint-disable-next-line import/no-unassigned-import -- Dialkit controls require their package stylesheet.
import "dialkit/styles.css";

// oxlint-disable-next-line import/no-unassigned-import -- Docs-only sizing and responsive adaptations belong to the host.
import "./workshop-host.css";

export const client = "only";

export default function DomainKitWorkshop() {
  return (
    <div data-docs-workshop-host="">
      <Workshop initial={stateFromSearch(window.location.search)} />
    </div>
  );
}
