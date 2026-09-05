import { DomainFlow } from "@/components/domainkit/domain-flow";

import {
  PreviewRoot,
  previewDomain,
  previewMarks,
  previewRequirements,
} from "../../lib/preview-flow.tsx";

export default function DomainFlowExample() {
  return (
    <PreviewRoot>
      <DomainFlow domain={previewDomain} marks={previewMarks} requirements={previewRequirements} />
    </PreviewRoot>
  );
}
