export interface Catalog {
  readonly applyCleanup: string;
  readonly applyDns: string;
  readonly applyingDns: string;
  readonly authenticationAlternative: string;
  readonly automaticUnavailable: string;
  readonly cancel: string;
  readonly checkAgain: string;
  readonly checkingDns: string;
  readonly checkDns: string;
  readonly cleanupConsent: string;
  readonly cleanupPartial: string;
  readonly cleaningDns: string;
  readonly connectProvider: (provider: string) => string;
  readonly connected: (provider: string) => string;
  readonly providerAvailable: (provider: string) => string;
  readonly connecting: string;
  readonly close: string;
  readonly detectingProvider: string;
  readonly disconnectDomain: string;
  readonly disconnectConsent: string;
  readonly disconnecting: string;
  readonly detaching: string;
  readonly disconnectTitle: (provider: string) => string;
  readonly domainDisconnected: string;
  readonly dialogDescription: (domain: string) => string;
  readonly dialogTitle: (provider: string) => string;
  readonly openingAuthorization: string;
  readonly moreActions: string;
  readonly noChanges: string;
  readonly planConsent: string;
  readonly planningCleanup: string;
  readonly planningDns: string;
  readonly recordsPartiallyApplied: string;
  readonly reviewCleanup: string;
  readonly reviewDns: string;
  readonly retry: string;
  readonly existingConnection: string;
  readonly targetUnavailable: string;
  readonly attachTarget: (target: string) => string;
  readonly tokenLabel: string;
}

export const english: Catalog = {
  applyCleanup: "Remove records",
  applyDns: "Add records",
  applyingDns: "Adding records…",
  authenticationAlternative: "or",
  automaticUnavailable: "Automatic connection is not available for this domain",
  cancel: "Cancel",
  checkAgain: "Check again",
  checkingDns: "Checking DNS…",
  checkDns: "Check DNS",
  cleanupConsent: "Only records proven by the apply receipt will be deleted.",
  cleanupPartial: "Some DNS records could not be deleted. Review and retry safely.",
  cleaningDns: "Removing records…",
  connectProvider: () => "Connect",
  connected: (provider) => `${provider} connected`,
  providerAvailable: (provider) => `${provider} manages DNS for this domain`,
  connecting: "Connecting…",
  close: "Close",
  detectingProvider: "Detecting DNS provider…",
  disconnectDomain: "Disconnect",
  disconnectConsent:
    "This domain will be detached from the provider. Existing DNS records will be preserved.",
  disconnecting: "Disconnecting…",
  detaching: "Detaching domain…",
  disconnectTitle: (provider) => `Detach ${provider}?`,
  domainDisconnected: "Domain detached. DNS records were preserved.",
  dialogDescription: (domain) => `Authorize DNS changes for ${domain}.`,
  dialogTitle: (provider) => `Connect ${provider}`,
  openingAuthorization: "Opening provider authorization…",
  moreActions: "More connection actions",
  noChanges: "No changes needed",
  planConsent: "Review the exact DNS operations before approving this plan.",
  planningCleanup: "Preparing cleanup…",
  planningDns: "Preparing DNS changes…",
  recordsPartiallyApplied: "Some DNS changes failed. Review and retry safely.",
  reviewCleanup: "Remove records",
  reviewDns: "Review changes",
  retry: "Try again",
  existingConnection: "Existing provider connection",
  targetUnavailable: "No provider targets are available for this connection.",
  attachTarget: (target) => `Use ${target}`,
  tokenLabel: "API token",
};

export const merge = (overrides: Partial<Catalog> = {}): Catalog => ({
  ...english,
  ...overrides,
});
