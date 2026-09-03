import type { DnsRecord } from "domainkit";
import type { Transport } from "domainkit/client";
import { Domain, DomainKit, Records, Verify } from "@domainkit/react";

declare const transport: Transport.Interface;
declare const requirements: ReadonlyArray<DnsRecord.Model>;
declare const domains: ReadonlyArray<{ readonly name: string; readonly mine: boolean }>;

// #region root
/**
 * A customer who may read the domain but not change it. Status, records, and evidence render;
 * every control that would start a write is gone rather than disabled.
 */
export function MemberView() {
  return (
    <DomainKit.Root readOnly transport={transport}>
      <Domain.Flow domain="app.example.com" requirements={requirements} />
    </DomainKit.Root>
  );
}
// #endregion root

// #region per-domain
/** One domain among several, when the rest of the page is writable. */
export function DomainList() {
  return (
    <DomainKit.Root transport={transport}>
      {domains.map((domain) => (
        <Domain.Flow
          domain={domain.name}
          key={domain.name}
          readOnly={!domain.mine}
          requirements={requirements}
        />
      ))}
    </DomainKit.Root>
  );
}
// #endregion per-domain

// #region hook
/** A part of your own asks which mode it is in. */
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
export function ReadOnlyRecords() {
  return (
    <DomainKit.ReadOnly value={true}>
      <Records.Table records={requirements} />
    </DomainKit.ReadOnly>
  );
}
// #endregion hook

// #region observe
/**
 * Observation stays available: checking DNS reads the world rather than changing the domain. A host
 * whose `Identity.authorize` denies `observe` to members drops the slot instead.
 */
export function MemberViewWithoutChecks() {
  return (
    <DomainKit.Root readOnly transport={transport}>
      <Domain.Flow
        domain="app.example.com"
        requirements={requirements}
        slots={{ verification: () => null }}
      />
    </DomainKit.Root>
  );
}
// #endregion observe

// #region unattached
/**
 * The flow observes the requirements it was given, so a domain with no provider attached still
 * reports which records are in place.
 */
export function UnattachedStatus({ domain }: { readonly domain: string }) {
  const controller = Verify.useController({ domain, requirements });
  return <Verify.Status controller={controller} />;
}
// #endregion unattached
