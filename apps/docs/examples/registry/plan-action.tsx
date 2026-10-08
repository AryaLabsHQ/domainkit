import { Domain } from "@domainkit/react";

import { PlanAction } from "@/components/domainkit/plan-action";
import { ProviderRow } from "@/components/domainkit/provider-row";

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

function Action() {
  const flow = Domain.useFlow({ domain: previewDomain, requirements: previewRequirements });
  return <PlanAction flow={flow} />;
}

/** Every requirement is the tracking CNAME, and an A record on that host blocks it. */
const blockedRequirements = previewRequirements.filter((record) =>
  record.name.startsWith("track."),
);

function BlockedRow() {
  const flow = Domain.useFlow({ domain: previewDomain, requirements: blockedRequirements });
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <ProviderRow flow={flow} marks={previewMarks} />
    </div>
  );
}

export default function PlanActionExample() {
  return (
    <div className="w-full space-y-3">
      <PreviewRoot connected>
        <Action />
      </PreviewRoot>
      <PreviewRoot connected seed={previewConflictSeed}>
        <BlockedRow />
      </PreviewRoot>
    </div>
  );
}
