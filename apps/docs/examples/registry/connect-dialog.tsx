import { Domain } from "@domainkit/react";

import { ConnectDialog } from "@/components/domainkit/connect-dialog";

import {
  PreviewRoot,
  previewDomain,
  previewMarks,
  previewRequirements,
} from "../../lib/preview-flow.tsx";

function Trigger() {
  const flow = Domain.useFlow({ domain: previewDomain, requirements: previewRequirements });
  return <ConnectDialog flow={flow} marks={previewMarks} />;
}

export default function ConnectDialogExample() {
  return (
    <PreviewRoot oauth>
      <Trigger />
    </PreviewRoot>
  );
}
