import type { DnsRecord } from "domainkit";
import type { Transport } from "domainkit/client";
import { Connect, Domain, DomainKit, Verify } from "@domainkit/react";

declare const transport: Transport.Interface;
declare const requirements: ReadonlyArray<DnsRecord.Model>;
declare const domains: ReadonlyArray<{ readonly name: string; readonly mine: boolean }>;

// #region root
/**
 * A customer who may read the domain but not change it. Every command that would start a write
 * refuses to run, and `flow.state.readOnly` is what your surface reads to say who may connect.
 */
function MemberRow({ domain }: { readonly domain: string }) {
  const flow = Domain.useFlow({ domain, requirements });
  const host = Connect.hostProvider(flow.connection);
  if (!flow.state.readOnly || host === null) return null;
  return <p>An administrator can connect {host.name}</p>;
}

export function MemberView() {
  return (
    <DomainKit.Root readOnly transport={transport}>
      <MemberRow domain="app.example.com" />
    </DomainKit.Root>
  );
}
// #endregion root

// #region per-domain
/** One domain among several, when the rest of the page is writable. */
function DomainRow({ domain, mine }: { readonly domain: string; readonly mine: boolean }) {
  const flow = Domain.useFlow({ domain, readOnly: !mine, requirements });
  return <p>{flow.state.connection}</p>;
}

export function DomainList() {
  return (
    <DomainKit.Root transport={transport}>
      {domains.map((domain) => (
        <DomainRow domain={domain.name} key={domain.name} mine={domain.mine} />
      ))}
    </DomainKit.Root>
  );
}
// #endregion per-domain

// #region hook
/** A surface of your own asks which mode it is in. */
export function RemoveDomainButton({ onRemove }: { readonly onRemove: () => void }) {
  const readOnly = DomainKit.useReadOnly();
  if (readOnly) return null;
  return (
    <button onClick={onRemove} type="button">
      Remove this domain
    </button>
  );
}

/** Or narrow one subtree without touching the rest of the page. */
export function ReadOnlySection({ children }: { readonly children: React.ReactNode }) {
  return <DomainKit.ReadOnly value={true}>{children}</DomainKit.ReadOnly>;
}
// #endregion hook

// #region unattached
/**
 * Observation stays available, because checking DNS reads the world rather than changing the
 * domain, and it does not wait for a connection: the controller observes the requirements it was
 * given, so a domain with no provider attached still reports which records are in place.
 */
export function UnattachedStatus({ domain }: { readonly domain: string }) {
  const controller = Verify.useController({ domain, requirements });
  return <p>{controller.readiness?.overall ?? "checking"}</p>;
}
// #endregion unattached
