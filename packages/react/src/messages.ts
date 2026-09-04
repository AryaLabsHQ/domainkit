/**
 * Every string the package can put on screen. Nothing renders a `_tag`, a reason name, or a
 * status literal directly: each one arrives here first, so a host translates the whole surface by
 * passing `messages` to `DomainKit.Root`.
 */
import type { DnsRecord, DomainKit, Plan, Reason, Receipt, Storage } from "domainkit";

export interface Catalog {
  // Actions
  readonly connect: string;
  /** The token method's button, which carries the verb rather than the method's own label. */
  readonly methodToken: string;
  readonly methodOAuth: (provider: string) => string;
  readonly methodIntegration: (provider: string) => string;
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
  /** Reveals the fields a provider does not need, such as an account id. */
  readonly moreOptions: string;
  /** Reveals the providers the dialog narrowed away. */
  readonly useAnotherProvider: string;
  /** Opens the token form where a provider also offers a method the customer clicks through. */
  readonly useTokenInstead: string;
  /** Returns from one method's form to the provider's methods. */
  readonly back: string;
  /** The connected card's own line, beside the provider's name. */
  readonly connected: string;
  readonly needsReconnect: string;
  /** The disconnect dialog's scope question, when the connection serves other domains too. */
  readonly disconnectScope: string;
  readonly disconnectThisDomain: string;
  readonly disconnectEveryDomain: (count: number) => string;
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
  /** The dialog heading, and the trigger, when no provider is named yet. */
  readonly connectAnyTitle: string;
  /** What the disconnected prompt says about the provider whose nameservers serve the domain. */
  readonly hostOwnsZone: string;
  readonly connectDescription: (domain: string) => string;
  readonly connectedTo: (provider: string) => string;
  /** Shown where a connect control would be when the customer may not connect. */
  readonly notConnected: string;
  readonly reconnectRequired: (provider: string) => string;
  readonly disconnectTitle: (provider: string) => string;
  readonly disconnectConsent: string;
  /** The option inside the disconnect dialog that removes what an apply receipt proves. */
  readonly disconnectWithCleanup: string;
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
  readonly applied: (receipt: Receipt.Model) => string;
  readonly cleaned: (receipt: Receipt.Model) => string;
  readonly partiallyAppliedTitle: string;
  readonly partiallyApplied: string;
  readonly partiallyCleanedTitle: string;
  readonly partiallyCleaned: string;
  readonly receiptOutcome: (outcome: Receipt.Outcome) => string;
  readonly skippedReason: (reason: Receipt.Skipped["reason"]) => string;

  // Verification
  readonly requirementStatus: (status: Storage.RequirementStatus) => string;
  readonly overall: (overall: Storage.Overall) => string;
  readonly evidenceSource: (evidence: EvidenceLike) => string;
  readonly hostEvidenceStatus: (status: "failed" | "ok" | "pending") => string;
  /** What the requirement asks for, shown when an observation disagrees with it. */
  readonly expectedValue: (value: string) => string;
  /** What one observer actually read back for that name. */
  readonly observedValues: (values: ReadonlyArray<string>) => string;
  readonly observedNothing: string;
  readonly checkedAt: (at: string) => string;
  readonly nextCheckAt: (at: string) => string;
  readonly hostEvidence: string;
  readonly noEvidence: string;

  // Failures, rendered from the error's reason: a heading and the sentence under it
  readonly invalidInput: (reason: Reason.InvalidInput, context: OutcomeContext) => Outcome;
  readonly unauthenticated: (reason: Reason.Unauthenticated, context: OutcomeContext) => Outcome;
  readonly forbidden: (reason: Reason.Forbidden, context: OutcomeContext) => Outcome;
  readonly notFound: (reason: Reason.NotFound, context: OutcomeContext) => Outcome;
  readonly conflict: (reason: Reason.Conflict, context: OutcomeContext) => Outcome;
  readonly stale: (reason: Reason.Stale, context: OutcomeContext) => Outcome;
  readonly expired: (reason: Reason.Expired, context: OutcomeContext) => Outcome;
  readonly busy: (reason: Reason.Busy, context: OutcomeContext) => Outcome;
  readonly providerRejected: (reason: Reason.ProviderRejected, context: OutcomeContext) => Outcome;
  readonly providerUnavailable: (
    reason: Reason.ProviderUnavailable,
    context: OutcomeContext,
  ) => Outcome;
  readonly providerConflict: (reason: Reason.ProviderConflict, context: OutcomeContext) => Outcome;
  readonly unsupported: (reason: Reason.Unsupported, context: OutcomeContext) => Outcome;
  readonly reconnect: (reason: Reason.Reconnect, context: OutcomeContext) => Outcome;
  readonly storageFailed: (reason: Reason.StorageFailed, context: OutcomeContext) => Outcome;
  readonly cryptoFailed: (reason: Reason.CryptoFailed, context: OutcomeContext) => Outcome;
  readonly resolverFailed: (reason: Reason.ResolverFailed, context: OutcomeContext) => Outcome;
}

/** What an outcome says: a heading the customer reads first, then what to do about it. */
export interface Outcome {
  readonly title: string;
  readonly description: string;
}

/**
 * What the flow was doing when it failed. The reason alone cannot name the provider a customer
 * typed a token for, so the part that renders the outcome supplies it.
 */
export interface OutcomeContext {
  /** The provider's display name, when the flow knows which one the customer acted on. */
  readonly provider?: string;
  readonly domain?: string;
}

/** The evidence shapes `Verify` produces, structurally, so the catalog needs no service import. */
export type EvidenceLike =
  | { readonly _tag: "Host"; readonly source: string; readonly label: string }
  | { readonly _tag: "Provider"; readonly provider: string }
  | { readonly _tag: "PublicDns"; readonly resolver: string };

const entity: Readonly<Record<Reason.NotFound["entity"], string>> = {
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

const expiredEntity: Readonly<Record<Reason.Expired["entity"], string>> = {
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

/** The provider the customer acted on, or a neutral stand-in when the flow does not know it. */
const named = (provider: string | undefined): string => provider ?? "The provider";

/** The domain the failure is about, or a neutral stand-in. */
const where = (domain: string | undefined): string => domain ?? "this domain";

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
  methodToken: "Connect with an API token",
  methodOAuth: (provider) => `Continue with ${provider}`,
  methodIntegration: (provider) => `Install the ${provider} integration`,
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
  moreOptions: "Need an account id?",
  useAnotherProvider: "Use a different provider",
  useTokenInstead: "Use an API token instead",
  back: "Back",
  connected: "Connected",
  needsReconnect: "Needs reconnecting",
  disconnectScope: "This connection serves other domains.",
  disconnectThisDomain: "Only this domain",
  disconnectEveryDomain: (count) => `All ${count} domains`,
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
  connectAnyTitle: "Connect a DNS provider",
  hostOwnsZone: "Owns DNS for this domain.",
  connectDescription: (domain) => `Authorize DNS changes for ${domain}.`,
  connectedTo: (provider) => `${provider} connected`,
  notConnected: "No DNS provider is connected.",
  reconnectRequired: (provider) => `${provider} needs to be reconnected`,
  disconnectTitle: (provider) => `Disconnect ${provider}?`,
  disconnectConsent: "The provider connection is removed.",
  disconnectWithCleanup: "Also remove the records DomainKit added",
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
  partiallyAppliedTitle: "Some DNS changes did not land",
  partiallyApplied: "Review what applied, then retry. Retrying is safe.",
  partiallyCleanedTitle: "Some DNS records are still there",
  partiallyCleaned: "Review what is left, then retry. Retrying is safe.",
  receiptOutcome: (outcome) => {
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
  expectedValue: (value) => `Expected ${value}`,
  observedValues: (values) => `Found ${values.join(", ")}`,
  observedNothing: "Found nothing",
  checkedAt: (at) => `Checked ${at}`,
  nextCheckAt: (at) => `Next check ${at}`,
  hostEvidence: "Other checks",
  noEvidence: "Nothing has been checked yet.",

  invalidInput: (reason) => ({
    description: reason.message,
    title:
      reason.field === undefined
        ? "Check what you entered"
        : `Check the ${humanize(reason.field).toLowerCase()}`,
  }),
  unauthenticated: (_reason, context) => ({
    description: "Check it can edit DNS for this zone.",
    title: `${named(context.provider)} didn't accept this token`,
  }),
  forbidden: (_reason, context) => ({
    description: `The connection needs permission to edit DNS for ${where(context.domain)}.`,
    title: "This connection can't change DNS here",
  }),
  notFound: (reason) => ({
    description: "Reload the page and start this step again.",
    title: `That ${entity[reason.entity]} no longer exists`,
  }),
  conflict: (reason) => ({
    description: "Review what the zone already holds, then build a new plan.",
    title:
      reason.operations.length === 1
        ? "A record is in the way"
        : `${reason.operations.length} records are in the way`,
  }),
  stale: () => ({
    description: "Review the new plan before you apply it.",
    title: "The zone changed since you reviewed",
  }),
  expired: (reason) => ({
    description: "Start this step again.",
    title: `That ${expiredEntity[reason.entity]} expired`,
  }),
  busy: () => ({
    description: "Wait for it to finish, then try again.",
    title: "Another change is running",
  }),
  providerRejected: (reason, context) => ({
    description: reason.message,
    title: `${named(context.provider ?? reason.provider)} refused the change`,
  }),
  providerUnavailable: (reason, context) => ({
    description: "Nothing changed. Try again in a minute.",
    title: `${named(context.provider ?? reason.provider)} isn't responding`,
  }),
  providerConflict: (reason, context) => ({
    description: "Remove or rename that record at the provider, then try again.",
    title: `${named(context.provider ?? reason.provider)} already holds a conflicting record`,
  }),
  unsupported: (reason, context) => ({
    description: "Nothing changed. This step needs a provider that can do it.",
    title: `${named(context.provider ?? reason.provider)} cannot ${reason.operation}`,
  }),
  reconnect: (reason, context) => ({
    description: "The stored credential no longer works. Connect again to continue.",
    title: `Reconnect ${named(context.provider ?? reason.provider)}`,
  }),
  storageFailed: () => ({
    description: "Nothing changed. Try again.",
    title: "The change could not be saved",
  }),
  cryptoFailed: () => ({
    description: "Connect the provider again to replace it.",
    title: "A stored credential could not be read",
  }),
  resolverFailed: (reason) => ({
    description: "The lookup failed, which says nothing about your DNS. Try again in a moment.",
    title: `DNS lookups through ${reason.resolver} failed`,
  }),
};

export const merge = (overrides: Partial<Catalog> = {}): Catalog => ({ ...english, ...overrides });

/** The title and description for a failure, chosen by the error's reason. */
export const outcome = (
  error: DomainKit.Error,
  catalog: Catalog,
  context: OutcomeContext = {},
): Outcome => {
  const reason = error.reason;
  switch (reason._tag) {
    case "InvalidInput":
      return catalog.invalidInput(reason, context);
    case "Unauthenticated":
      return catalog.unauthenticated(reason, context);
    case "Forbidden":
      return catalog.forbidden(reason, context);
    case "NotFound":
      return catalog.notFound(reason, context);
    case "Conflict":
      return catalog.conflict(reason, context);
    case "Stale":
      return catalog.stale(reason, context);
    case "Expired":
      return catalog.expired(reason, context);
    case "Busy":
      return catalog.busy(reason, context);
    case "ProviderRejected":
      return catalog.providerRejected(reason, context);
    case "ProviderUnavailable":
      return catalog.providerUnavailable(reason, context);
    case "ProviderConflict":
      return catalog.providerConflict(reason, context);
    case "Unsupported":
      return catalog.unsupported(reason, context);
    case "Reconnect":
      return catalog.reconnect(reason, context);
    case "StorageFailed":
      return catalog.storageFailed(reason, context);
    case "CryptoFailed":
      return catalog.cryptoFailed(reason, context);
    case "ResolverFailed":
      return catalog.resolverFailed(reason, context);
  }
};

/** The same failure as one sentence, for a host that renders text rather than a card. */
export const failure = (
  error: DomainKit.Error,
  catalog: Catalog,
  context: OutcomeContext = {},
): string => {
  const { description, title } = outcome(error, catalog, context);
  return `${title}. ${description}`;
};
