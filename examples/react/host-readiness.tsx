import { Verify as CoreVerify } from "domainkit";
import { Transport } from "domainkit/client";
import { Domain, DomainKit, Verify } from "@domainkit/react";
import { useCallback, useEffect, useState } from "react";

const transport = Transport.fromFetch("/api/domainkit");
/** The same transport in Promises, which is how a component reads outside Effect. */
const api = Transport.toAsync(transport);

declare const requirements: Parameters<typeof Domain.useFlow>[0]["requirements"];

// #region host-readiness
/**
 * The host owns the clock: it reads the stored readiness on its own schedule, and the flow renders
 * what it was given. Nothing observes on mount, no timer runs, and `observe` and `retry` on the
 * surface ask the host for a fresh reading.
 */
function HostObservedSetup({ domain }: { readonly domain: string }) {
  const [readiness, setReadiness] = useState<Verify.Readiness | null>(null);
  const refresh = useCallback(() => {
    void api.verification?.latest(domain).then(setReadiness);
  }, [domain]);
  useEffect(refresh, [refresh]);

  const flow = Domain.useFlow({
    domain,
    requirements,
    verification: { readiness, observe: refresh },
  });
  const counts = CoreVerify.summary(flow.readiness);
  return (
    <section>
      <p>{counts.observed ? `${counts.satisfied} of ${counts.total} found` : "Not checked yet"}</p>
      <button onClick={() => flow.verification.observe()} type="button">
        Check again
      </button>
    </section>
  );
}

export function HostObserved({ domain }: { readonly domain: string }) {
  return (
    <DomainKit.Root transport={transport}>
      <HostObservedSetup domain={domain} />
    </DomainKit.Root>
  );
}
// #endregion host-readiness
