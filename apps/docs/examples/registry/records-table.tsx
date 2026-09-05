import { Domain } from "@domainkit/react";

import { ProviderRow } from "@/components/domainkit/provider-row";
import { RecordsTable } from "@/components/domainkit/records-table";

import {
  PreviewRoot,
  previewDomain,
  previewMarks,
  previewRequirements,
} from "../../lib/preview-flow.tsx";

function Table() {
  const flow = Domain.useFlow({ domain: previewDomain, requirements: previewRequirements });
  return <RecordsTable flow={flow} header={<ProviderRow flow={flow} marks={previewMarks} />} />;
}

export default function RecordsTableExample() {
  return (
    <PreviewRoot>
      <Table />
    </PreviewRoot>
  );
}
