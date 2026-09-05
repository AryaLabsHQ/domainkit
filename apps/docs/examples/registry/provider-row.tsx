import { Domain } from "@domainkit/react";

import { ProviderRow } from "@/components/domainkit/provider-row";

import {
  PreviewRoot,
  previewDomain,
  previewMarks,
  previewRequirements,
} from "../../lib/preview-flow.tsx";

function Row({ readOnly }: { readonly readOnly?: boolean }) {
  const flow = Domain.useFlow({
    domain: previewDomain,
    requirements: previewRequirements,
    ...(readOnly === undefined ? {} : { readOnly }),
  });
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <ProviderRow flow={flow} marks={previewMarks} />
    </div>
  );
}

export default function ProviderRowExample() {
  return (
    <PreviewRoot>
      <div className="grid gap-3">
        <Row />
        <Row readOnly />
      </div>
    </PreviewRoot>
  );
}
