import { Domain } from "@domainkit/react";

import { PlanAction } from "@/components/domainkit/plan-action";
import { ProviderRow } from "@/components/domainkit/provider-row";
import { RecordsTable } from "@/components/domainkit/records-table";

import {
  PreviewRoot,
  previewConflictSeed,
  previewDomain,
  previewMarks,
  previewRequirements,
} from "../../lib/preview-flow.tsx";

// Hydrate on load: the preview renders nothing until its grant lands, so the island has no
// server-rendered element for the default visible trigger to observe.
export const client = "load";

function Table() {
  const flow = Domain.useFlow({ domain: previewDomain, requirements: previewRequirements });
  return (
    <div className="space-y-3">
      <RecordsTable flow={flow} header={<ProviderRow flow={flow} marks={previewMarks} />} />
      <PlanAction flow={flow} />
    </div>
  );
}

/** A zone whose A record on the tracking host blocks the CNAME, so the plan carries a conflict. */
export default function RecordsTableConflictExample() {
  return (
    <PreviewRoot connected seed={previewConflictSeed}>
      <Table />
    </PreviewRoot>
  );
}
