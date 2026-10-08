import { Domain } from "@domainkit/react";

import { DisconnectDialog } from "@/components/domainkit/disconnect-dialog";

import { PreviewRoot, previewDomain, previewRequirements } from "../../lib/preview-flow.tsx";

// Hydrate on load: the preview renders nothing until its grant lands, so the island has no
// server-rendered element for the default visible trigger to observe.
export const client = "load";

function Trigger() {
  const flow = Domain.useFlow({ domain: previewDomain, requirements: previewRequirements });
  return <DisconnectDialog flow={flow} />;
}

export default function DisconnectDialogExample() {
  return (
    <PreviewRoot connected>
      <Trigger />
    </PreviewRoot>
  );
}
