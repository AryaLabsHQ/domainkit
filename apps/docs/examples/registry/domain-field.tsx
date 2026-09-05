import { useState } from "react";

import { DomainField } from "@/components/domainkit/domain-field";

import { PreviewRoot, previewMarks } from "../../lib/preview-flow.tsx";

function Field() {
  const [value, setValue] = useState("");
  return (
    <DomainField
      marks={previewMarks}
      onChange={setValue}
      placeholder="mail.northwind.app"
      value={value}
    />
  );
}

export default function DomainFieldExample() {
  return (
    <PreviewRoot>
      <Field />
    </PreviewRoot>
  );
}
