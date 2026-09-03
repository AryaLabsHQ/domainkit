/**
 * Every string the package can put on screen. Nothing renders a `_tag`, a reason name, or a
 * status literal directly: each one arrives here first, so a host translates the whole surface by
 * passing `messages` to `DomainKit.Root`.
 */
import type { DnsRecord, DomainKitError, Plan, Receipt, Storage } from "domainkit";

export interface Catalog {
  // Actions
  readonly connect: string;
  readonly connectWith: (method: string) => string;
  readonly disconnect: string;
  readonly detach: string;
  readonly cancel: string;
  readonly close: string;
  readonly retry: string;
  readonly approve: string;
  readonly decline: string;
  readonly reviewChanges: string;
  readonly cleanUp: string;
  readonly checkDns: string;
  readonly checkAgain: string;
  readonly moreActions: string;
  readonly copy: string;
  readonly copied: string;
  readonly copyZone: string;
  readonly download: string;
  readonly useConnection: (label: string) => string;
  readonly chooseZone: string;
  readonly getToken: string;

  // Progress
  readonly loading: string;
  readonly connecting: string;
  readonly redirecting: string;
  readonly detaching: string;
  readonly disconnecting: string;
  readonly planning: string;
  readonly approving: string;
  readonly applying: string;
  readonly rejecting: string;
  readonly planningCleanup: string;
  readonly cleaning: string;
  readonly observing: string;

  // Connection
  readonly connectTitle: (provider: string) => string;
  /** The dialog heading before a provider is chosen. */
  readonly connectAnyTitle: string;
  readonly connectDescription: (domain: string) => string;
  readonly connectedTo: (provider: string) => string;
  readonly reconnectRequired: (provider: string) => string;
  readonly disconnectTitle: (provider: string) => string;
  readonly disconnectConsent: string;
  readonly detachConsent: string;
  readonly detached: string;
  readonly reusableConnections: string;
  readonly authenticationAlternative: string;
  readonly discoveredConnection: (label: string) => string;
  readonly discoveryAmbiguous: string;
  readonly discoveryNotFound: (nameservers: ReadonlyArray<string>) => string;
  readonly noProviders: string;
  readonly fieldLabel: (name: string) => string;
  readonly optionalField: string;

  // Plan review
  readonly planTitle: string;
  readonly planConsent: string;
  readonly cleanupTitle: string;
  readonly cleanupConsent: string;
  readonly noChanges: string;
  readonly planExpires: (at: string) => string;
  readonly declinedBy: (actor: string) => string;
  readonly declineReason: (reason: string) => string;
  readonly operation: (operation: Plan.Operation) => string;
  readonly conflictReason: (reason: Plan.Conflict["reason"]) => string;
  readonly attemptStatus: (status: Storage.AttemptStatus) => string;

  // Records
  readonly recordsCaption: (domain: string) => string;
  readonly headingType: string;
  readonly headingName: string;
  readonly headingValue: string;
  readonly headingStatus: string;
  readonly headingPurpose: string;
  readonly priority: (priority: number) => string;
  readonly ttl: (seconds: number) => string;
  readonly recordType: (record: DnsRecord.Observed) => string;

  // Receipts
  readonly applied: (receipt: Receipt.Receipt) => string;
  readonly cleaned: (receipt: Receipt.Receipt) => string;
  readonly partiallyApplied: string;
  readonly partiallyCleaned: string;
  readonly outcome: (outcome: Receipt.Outcome) => string;
  readonly skippedReason: (reason: Receipt.Skipped["reason"]) => string;

  // Verification
  readonly requirementStatus: (status: Storage.RequirementStatus) => string;
  readonly overall: (overall: Storage.Overall) => string;
  readonly evidenceSource: (evidence: EvidenceLike) => string;
  readonly hostEvidenceStatus: (status: "failed" | "ok" | "pending") => string;
  readonly checkedAt: (at: string) => string;
  readonly nextCheckAt: (at: string) => string;
  readonly hostEvidence: string;
  readonly noEvidence: string;

  // Failures, rendered from `DomainKitError.reason`
  readonly invalidInput: (reason: DomainKitError.InvalidInput) => string;
  readonly unauthenticated: (reason: DomainKitError.Unauthenticated) => string;
  readonly forbidden: (reason: DomainKitError.Forbidden) => string;
  readonly notFound: (reason: DomainKitError.NotFound) => string;
  readonly conflict: (reason: DomainKitError.Conflict) => string;
  readonly stale: (reason: DomainKitError.Stale) => string;
  readonly expired: (reason: DomainKitError.Expired) => string;
  readonly busy: (reason: DomainKitError.Busy) => string;
  readonly providerRejected: (reason: DomainKitError.ProviderRejected) => string;
  readonly providerUnavailable: (reason: DomainKitError.ProviderUnavailable) => string;
  readonly providerConflict: (reason: DomainKitError.ProviderConflict) => string;
  readonly unsupported: (reason: DomainKitError.Unsupported) => string;
  readonly reconnect: (reason: DomainKitError.Reconnect) => string;
  readonly storageFailed: (reason: DomainKitError.StorageFailed) => string;
  readonly cryptoFailed: (reason: DomainKitError.CryptoFailed) => string;
  readonly resolverFailed: (reason: DomainKitError.ResolverFailed) => string;
}

/** The evidence shapes `Verify` produces, structurally, so the catalog needs no service import. */
export type EvidenceLike =
  | { readonly _tag: "Host"; readonly source: string; readonly label: string }
  | { readonly _tag: "Provider"; readonly provider: string }
  | { readonly _tag: "PublicDns"; readonly resolver: string };

const entity: Readonly<Record<DomainKitError.NotFound["entity"], string>> = {
  approval: "approval",
  attachment: "domain attachment",
  authorization: "provider authorization",
  connection: "provider connection",
  continuation: "sign-in attempt",
  plan: "plan",
  provider: "provider",
  receipt: "receipt",
  record: "DNS record",
  zone: "DNS zone",
};

const expiredEntity: Readonly<Record<DomainKitError.Expired["entity"], string>> = {
  approval: "approval",
  continuation: "sign-in attempt",
  credential: "provider credential",
  plan: "plan",
};

const recordTypes: Readonly<Record<Exclude<DnsRecord.Observed["_tag"], "Opaque">, string>> = {
  A: "A",
  AAAA: "AAAA",
  CAA: "CAA",
  CNAME: "CNAME",
  MX: "MX",
  NS: "NS",
  SRV: "SRV",
  TXT: "TXT",
};

/** `accountId` reads as "Account id" until a host names the field itself. */
const humanize = (name: string): string => {
  const spaced = name
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[_-]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
};

export const english: Catalog = {
  connect: "Connect",
  connectWith: (method) => method,
  disconnect: "Disconnect",
  detach: "Detach domain",
  cancel: "Cancel",
  close: "Close",
  retry: "Try again",
  approve: "Approve",
  decline: "Decline",
  reviewChanges: "Review changes",
  cleanUp: "Remove records",
  checkDns: "Check DNS",
  checkAgain: "Check again",
  moreActions: "More actions",
  copy: "Copy",
  copied: "Copied",
  copyZone: "Copy zone file",
  download: "Download",
  useConnection: (label) => `Use ${label}`,
  chooseZone: "Choose the zone that serves this domain",
  getToken: "Where do I find this?",

  loading: "Loading…",
  connecting: "Connecting…",
  redirecting: "Opening the provider…",
  detaching: "Detaching…",
  disconnecting: "Disconnecting…",
  planning: "Preparing DNS changes…",
  approving: "Approving…",
  applying: "Adding records…",
  rejecting: "Declining…",
  planningCleanup: "Preparing cleanup…",
  cleaning: "Removing records…",
  observing: "Checking DNS…",

  connectTitle: (provider) => `Connect ${provider}`,
  connectAnyTitle: "Connect your DNS provider",
  connectDescription: (domain) => `Authorize DNS changes for ${domain}.`,
  connectedTo: (provider) => `${provider} connected`,
  reconnectRequired: (provider) => `${provider} needs to be reconnected`,
  disconnectTitle: (provider) => `Disconnect ${provider}?`,
  disconnectConsent: "The provider connection is removed. Existing DNS records are preserved.",
  detachConsent: "This domain is detached from the provider. Existing DNS records are preserved.",
  detached: "Domain detached. DNS records were preserved.",
  reusableConnections: "Connections you already have",
  authenticationAlternative: "or",
  discoveredConnection: (label) => `${label} already serves this domain`,
  discoveryAmbiguous: "More than one connection can serve this domain. Pick one.",
  discoveryNotFound: (nameservers) =>
    nameservers.length === 0
      ? "No connected provider serves this domain yet."
      : `No connected provider serves this domain. Its nameservers are ${nameservers.join(", ")}.`,
  noProviders: "No DNS providers are available.",
  fieldLabel: humanize,
  optionalField: "optional",

  planTitle: "Review DNS changes",
  planConsent: "Review the exact DNS operations before approving this plan.",
  cleanupTitle: "Review the records to remove",
  cleanupConsent: "Only records the apply receipt proves DomainKit created will be deleted.",
  noChanges: "No changes needed",
  planExpires: (at) => `This plan expires at ${at}.`,
  declinedBy: (actor) => `Declined by ${actor}. Build a new plan to continue.`,
  declineReason: (reason) => `Reason: ${reason}`,
  operation: (operation) => {
    switch (operation._tag) {
      case "Create":
        return "Add";
      case "Noop":
        return "Already in place";
      case "Delete":
        return "Remove";
      case "Conflict":
        return "Blocked";
    }
  },
  conflictReason: (reason) => {
    switch (reason) {
      case "exclusive-name":
        return "Another record already owns this name.";
      case "cname-collision":
        return "A CNAME cannot share a name with other records.";
      case "value-mismatch":
        return "A record with this name holds a different value.";
      case "opaque":
        return "A record here uses a form DomainKit will not overwrite.";
      case "missing":
        return "The record this plan expected is gone.";
    }
  },
  attemptStatus: (status) => {
    switch (status) {
      case "planned":
        return "Awaiting review";
      case "approved":
        return "Approved";
      case "applying":
        return "Applying";
      case "complete":
        return "Applied";
      case "partial":
        return "Partly applied";
      case "failed":
        return "Failed";
      case "expired":
        return "Expired";
      case "rejected":
        return "Declined";
    }
  },

  recordsCaption: (domain) => `DNS records for ${domain}`,
  headingType: "Type",
  headingName: "Name",
  headingValue: "Value",
  headingStatus: "Status",
  headingPurpose: "Purpose",
  priority: (priority) => `Priority ${priority}`,
  ttl: (seconds) => `TTL ${seconds}s`,
  recordType: (record) => (record._tag === "Opaque" ? record.type : recordTypes[record._tag]),

  applied: (receipt) =>
    receipt.status === "complete" ? "DNS records added." : "Some DNS records were not added.",
  cleaned: (receipt) =>
    receipt.status === "complete" ? "DNS records removed." : "Some DNS records were not removed.",
  partiallyApplied: "Some DNS changes failed. Review and retry safely.",
  partiallyCleaned: "Some DNS records could not be deleted. Review and retry safely.",
  outcome: (outcome) => {
    switch (outcome._tag) {
      case "Applied":
        return "Done";
      case "Skipped":
        return "Skipped";
      case "Failed":
        return outcome.message;
    }
  },
  skippedReason: (reason) => {
    switch (reason) {
      case "noop":
        return "The record was already in place.";
      case "not-approved":
        return "The approval left this operation out.";
      case "not-attempted":
        return "An earlier operation failed before this one ran.";
    }
  },

  requirementStatus: (status) => {
    switch (status) {
      case "satisfied":
        return "Found";
      case "missing":
        return "Missing";
      case "mismatch":
        return "Different value";
      case "unknown":
        return "Not checked";
    }
  },
  overall: (overall) => {
    switch (overall) {
      case "ready":
        return "Ready";
      case "pending":
        return "Pending";
      case "failed":
        return "Failed";
    }
  },
  evidenceSource: (evidence) => {
    switch (evidence._tag) {
      case "Host":
        return evidence.label;
      case "Provider":
        return `${evidence.provider} records`;
      case "PublicDns":
        return `Public DNS via ${evidence.resolver}`;
    }
  },
  hostEvidenceStatus: (status) => {
    switch (status) {
      case "ok":
        return "Ready";
      case "pending":
        return "Pending";
      case "failed":
        return "Failed";
    }
  },
  checkedAt: (at) => `Checked ${at}`,
  nextCheckAt: (at) => `Next check ${at}`,
  hostEvidence: "Other checks",
  noEvidence: "Nothing has been checked yet.",

  invalidInput: (reason) =>
    reason.field === undefined ? reason.message : `${humanize(reason.field)}: ${reason.message}`,
  unauthenticated: () => "The provider rejected these credentials.",
  forbidden: () => "You do not have access to this domain.",
  notFound: (reason) => `That ${entity[reason.entity]} no longer exists.`,
  conflict: (reason) =>
    reason.operations.length === 1
      ? "One DNS record conflicts with what is already in the zone."
      : `${reason.operations.length} DNS records conflict with what is already in the zone.`,
  stale: () => "The zone changed while you were reviewing. Build a new plan.",
  expired: (reason) => `That ${expiredEntity[reason.entity]} expired. Start again.`,
  busy: () => "Another change is running. Try again in a moment.",
  providerRejected: (reason) => `${reason.provider} refused the change: ${reason.message}`,
  providerUnavailable: (reason) => `${reason.provider} is unreachable right now.`,
  providerConflict: (reason) => `${reason.provider} already holds a conflicting record.`,
  unsupported: (reason) => `${reason.provider} cannot ${reason.operation}.`,
  reconnect: (reason) => `Reconnect ${reason.provider} to continue.`,
  storageFailed: () => "The change could not be saved. Try again.",
  cryptoFailed: () => "A stored credential could not be read.",
  resolverFailed: (reason) => `DNS lookups through ${reason.resolver} failed.`,
};

export const merge = (overrides: Partial<Catalog> = {}): Catalog => ({ ...english, ...overrides });

/** The user-facing sentence for a failure, chosen by the error's reason. */
export const failure = (error: DomainKitError.DomainKitError, catalog: Catalog): string => {
  const reason = error.reason;
  switch (reason._tag) {
    case "InvalidInput":
      return catalog.invalidInput(reason);
    case "Unauthenticated":
      return catalog.unauthenticated(reason);
    case "Forbidden":
      return catalog.forbidden(reason);
    case "NotFound":
      return catalog.notFound(reason);
    case "Conflict":
      return catalog.conflict(reason);
    case "Stale":
      return catalog.stale(reason);
    case "Expired":
      return catalog.expired(reason);
    case "Busy":
      return catalog.busy(reason);
    case "ProviderRejected":
      return catalog.providerRejected(reason);
    case "ProviderUnavailable":
      return catalog.providerUnavailable(reason);
    case "ProviderConflict":
      return catalog.providerConflict(reason);
    case "Unsupported":
      return catalog.unsupported(reason);
    case "Reconnect":
      return catalog.reconnect(reason);
    case "StorageFailed":
      return catalog.storageFailed(reason);
    case "CryptoFailed":
      return catalog.cryptoFailed(reason);
    case "ResolverFailed":
      return catalog.resolverFailed(reason);
  }
};
