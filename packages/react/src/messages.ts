export interface Catalog {
  readonly automaticUnavailable: string;
  readonly cancel: string;
  readonly checkAgain: string;
  readonly connectProvider: (provider: string) => string;
  readonly connected: (provider: string) => string;
  readonly connecting: string;
  readonly close: string;
  readonly detectingProvider: string;
  readonly dialogDescription: (domain: string) => string;
  readonly dialogTitle: (provider: string) => string;
  readonly openingAuthorization: string;
  readonly retry: string;
  readonly reuseConnection: (connection: string) => string;
  readonly tokenLabel: string;
}

export const english: Catalog = {
  automaticUnavailable: "Automatic connection is not available for this domain",
  cancel: "Cancel",
  checkAgain: "Check again",
  connectProvider: (provider) => `Connect ${provider}`,
  connected: (provider) => `${provider} connected`,
  connecting: "Connecting…",
  close: "Close",
  detectingProvider: "Detecting DNS provider…",
  dialogDescription: (domain) => `Authorize DNS changes for ${domain}.`,
  dialogTitle: (provider) => `Connect ${provider}`,
  openingAuthorization: "Opening provider authorization…",
  retry: "Try again",
  reuseConnection: (connection) => `Use ${connection}`,
  tokenLabel: "API token",
};

export const merge = (overrides: Partial<Catalog> = {}): Catalog => ({ ...english, ...overrides });
