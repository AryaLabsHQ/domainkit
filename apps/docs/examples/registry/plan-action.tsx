import { Domain } from "@domainkit/react";

import { PlanAction } from "@/components/domainkit/plan-action";

import { PreviewRoot, previewDomain, previewRequirements } from "../../lib/preview-flow.tsx";

function Action() {
  const flow = Domain.useFlow({ domain: previewDomain, requirements: previewRequirements });
  return <PlanAction flow={flow} />;
}

export default function PlanActionExample() {
  return (
    <PreviewRoot connected>
      <Action />
    </PreviewRoot>
  );
}
