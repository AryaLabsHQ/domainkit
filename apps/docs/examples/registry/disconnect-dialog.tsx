import { Domain } from "@domainkit/react";

import { DisconnectDialog } from "@/components/domainkit/disconnect-dialog";

import { PreviewRoot, previewDomain, previewRequirements } from "../../lib/preview-flow.tsx";

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
