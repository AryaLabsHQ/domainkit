import type { DnsRecord } from "domainkit";
import { Transport } from "domainkit/client";
import { Domain, DomainKit, Records, Verify } from "@domainkit/react";
import { useCallback, useEffect, useState } from "react";

const transport = Transport.fromFetch("/api/domainkit");
/** The same transport in Promises, which is how a component reads outside Effect. */
const api = Transport.toAsync(transport);

declare const requirements: ReadonlyArray<DnsRecord.Model>;

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
  const counts = Verify.summary(flow.readiness);
  return (
    <section>
      <p>{counts.observed ? `${counts.satisfied} of ${counts.total} found` : "Not checked yet"}</p>
      <table>
        <tbody>
          {flow.requirements.map((record) => {
            // Two facts, two columns: what a pending plan will do, and what was read back.
            const standing = Records.standingOf(record, {
              plan: flow.plan,
              readiness: flow.readiness,
            });
            return (
              <tr key={Records.identity(record)}>
                <td>{record.name}</td>
                <td>{standing.planned === null ? null : standing.planned._tag}</td>
                <td>{standing.observed?.status ?? "not checked"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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

// #region drop-in
/** No `verification`: the flow observes on mount and follows `nextCheckAt` on its own. */
function SelfObservingSetup({ domain }: { readonly domain: string }) {
  const flow = Domain.useFlow({ domain, requirements });
  return <p>{flow.readiness?.overall ?? "not checked"}</p>;
}

/** The stored readiness over the same transport, for a host that wants it without observing. */
export const storedReadiness = (domain: string) => api.verification?.latest(domain) ?? null;

export function SelfObserving({ domain }: { readonly domain: string }) {
  return (
    <DomainKit.Root transport={transport}>
      <SelfObservingSetup domain={domain} />
    </DomainKit.Root>
  );
}
// #endregion drop-in
