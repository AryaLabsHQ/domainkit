import { Connect } from "@domainkit/react";
import { useEffect } from "react";

import { Outcome } from "@/components/domainkit/outcome";

import { PreviewRoot, previewDomain } from "../../lib/preview-flow.tsx";

/** The failure is real: the fake provider turns down an empty token. */
function Failed() {
  const controller = Connect.useController({ domain: previewDomain });
  const connect = controller.connect;
  useEffect(() => {
    connect({ method: "token", provider: "meridian", values: { token: "" } });
  }, [connect]);
  const error = controller.state._tag === "Failure" ? controller.state.error : null;
  return (
    <div className="grid gap-4">
      <Outcome context={{ provider: "Meridian DNS" }} error={error} onRetry={controller.retry} />
      <Outcome context={{ provider: "Meridian DNS" }} error={error} layout="inline" />
    </div>
  );
}

export default function OutcomeExample() {
  return (
    <PreviewRoot>
      <Failed />
    </PreviewRoot>
  );
}
