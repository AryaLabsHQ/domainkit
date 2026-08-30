export interface Catalog {
  readonly applyCleanup: string;
  readonly applyDns: string;
  readonly applyingDns: string;
  readonly automaticUnavailable: string;
  readonly cancel: string;
  readonly checkAgain: string;
  readonly checkingDns: string;
  readonly checkDns: string;
  readonly cleanupComplete: string;
  readonly cleanupConsent: string;
  readonly cleanupPartial: string;
  readonly cleaningDns: string;
  readonly connectProvider: (provider: string) => string;
  readonly connected: (provider: string) => string;
  readonly providerAvailable?: (provider: string) => string;
  readonly connecting: string;
  readonly close: string;
  readonly detectingProvider: string;
  readonly disconnectDomain: string;
  readonly disconnecting: string;
  readonly domainDisconnected: string;
  readonly dialogDescription: (domain: string) => string;
  readonly dialogTitle: (provider: string) => string;
  readonly openingAuthorization: string;
  readonly planConsent: string;
  readonly planningCleanup: string;
  readonly planningDns: string;
  readonly recordsApplied: string;
  readonly recordsPartiallyApplied: string;
  readonly reviewCleanup: string;
  readonly reviewDns: string;
  readonly retry: string;
  readonly reuseConnection: (connection: string) => string;
  readonly tokenLabel: string;
}

export type ResolvedCatalog = Required<Catalog>;

export const english: ResolvedCatalog = {
  applyCleanup: "Remove records",
  applyDns: "Add records",
  applyingDns: "Adding records…",
  automaticUnavailable: "Automatic connection is not available for this domain",
  cancel: "Cancel",
  checkAgain: "Check again",
  checkingDns: "Checking DNS…",
  checkDns: "Check DNS",
  cleanupComplete: "DNS cleanup complete",
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
  disconnecting: "Disconnecting…",
  domainDisconnected: "Domain disconnected. DNS records were preserved.",
  dialogDescription: (domain) => `Authorize DNS changes for ${domain}.`,
  dialogTitle: (provider) => `Connect ${provider}`,
  openingAuthorization: "Opening provider authorization…",
  planConsent: "Review the exact DNS operations before approving this plan.",
  planningCleanup: "Preparing cleanup…",
  planningDns: "Preparing DNS changes…",
  recordsApplied: "DNS changes applied",
  recordsPartiallyApplied: "Some DNS changes failed. Review and retry safely.",
  reviewCleanup: "Remove records",
  reviewDns: "Review changes",
  retry: "Try again",
  reuseConnection: (connection) => `Use ${connection}`,
  tokenLabel: "API token",
};

export const merge = (overrides: Partial<Catalog> = {}): ResolvedCatalog => ({
  ...english,
  ...overrides,
});
