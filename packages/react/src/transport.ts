export interface Failure {
  readonly _tag: "Failure";
  readonly message: string;
  readonly retry: "never" | "after-user-action" | "safe" | "unknown";
}

export interface AuthenticationParameter {
  readonly description?: string;
  readonly key: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly required?: boolean;
}

export type AuthenticationMethod =
  | { readonly _tag: "OAuth"; readonly label: string }
  | {
      readonly _tag: "Token";
      readonly label: string;
      readonly parameters?: ReadonlyArray<AuthenticationParameter>;
      readonly placeholder?: string;
    };

export interface Provider {
  readonly authentication: ReadonlyArray<AuthenticationMethod>;
  readonly id: string;
  readonly name: string;
}

export interface Connected {
  readonly _tag: "Connected";
  readonly connectionId: string;
  readonly domain: string;
  readonly provider: Provider;
}

export interface ReusableConnection {
  readonly connectionId: string;
  readonly label: string;
}

export type ConnectionSnapshot =
  | Connected
  | {
      readonly _tag: "Disconnected";
      readonly domain: string;
      readonly provider: Provider;
      readonly reusableConnection?: ReusableConnection;
    }
  | { readonly _tag: "Unsupported"; readonly domain: string }
  | Failure;

export type ConnectionResult =
  | Connected
  | { readonly _tag: "Redirect"; readonly authorizationUrl: string }
  | Failure;

export interface ConnectionTransport {
  readonly connect: (input: {
    readonly domain: string;
    readonly method: "oauth" | "token";
    readonly parameters?: Readonly<Record<string, string>>;
    readonly providerId: string;
    readonly token?: string;
  }) => Promise<ConnectionResult>;
  readonly inspect: (input: { readonly domain: string }) => Promise<ConnectionSnapshot>;
  readonly reuse: (input: {
    readonly connectionId: string;
    readonly domain: string;
  }) => Promise<Connected | Failure>;
  readonly removeDomain: (input: {
    readonly connectionId: string;
    readonly domain: string;
    readonly preserveDns: true;
  }) => Promise<RemoveDomainResult | Failure>;
}

export interface RemoveDomainResult {
  readonly _tag: "Removed";
  readonly connectionId: string;
  readonly domain: string;
  readonly remainingDomainCount: number;
}

export interface DnsRecord {
  readonly id: string;
  readonly name: string;
  readonly priority?: number;
  readonly type: string;
  readonly value: string;
}

export type PlanOperation =
  | { readonly _tag: "Create"; readonly id: string; readonly record: DnsRecord }
  | { readonly _tag: "Noop"; readonly id: string; readonly record: DnsRecord }
  | {
      readonly _tag: "Conflict";
      readonly id: string;
      readonly record: DnsRecord;
      readonly reason: string;
    };

export interface ProvisioningPlan {
  readonly _tag: "Plan";
  readonly digest: string;
  readonly expiresAt: string;
  readonly operations: ReadonlyArray<PlanOperation>;
}

export type OperationResult =
  | { readonly _tag: "Applied"; readonly operationId: string }
  | { readonly _tag: "Unchanged"; readonly operationId: string }
  | { readonly _tag: "Failed"; readonly message: string; readonly operationId: string };

export type ApplyResult =
  | {
      readonly _tag: "Applied";
      readonly operationId: string;
      readonly receiptId: string;
      readonly results: ReadonlyArray<OperationResult>;
    }
  | {
      readonly _tag: "Partial";
      readonly operationId: string;
      readonly receiptId: string;
      readonly results: ReadonlyArray<OperationResult>;
    }
  | { readonly _tag: "Stale"; readonly message: string }
  | Failure;

export interface ProvisioningTransport {
  readonly plan: (input: {
    readonly connectionId: string;
    readonly domain: string;
    readonly records: ReadonlyArray<DnsRecord>;
  }) => Promise<ProvisioningPlan | Failure>;
  readonly apply: (input: {
    readonly connectionId: string;
    readonly domain: string;
    readonly planDigest: string;
  }) => Promise<ApplyResult>;
}

export type ObservationEvidence =
  | { readonly _tag: "Found"; readonly recordId: string }
  | { readonly _tag: "Missing"; readonly recordId: string }
  | { readonly _tag: "Mismatch"; readonly recordId: string; readonly message: string }
  | { readonly _tag: "Unavailable"; readonly recordId: string; readonly message: string };

export interface Observation {
  readonly _tag: "Observation";
  readonly provider: ReadonlyArray<ObservationEvidence>;
  readonly publicDns: ReadonlyArray<ObservationEvidence>;
}

export interface VerificationTransport {
  readonly observe: (input: {
    readonly connectionId?: string;
    readonly domain: string;
    readonly records: ReadonlyArray<DnsRecord>;
    readonly sources: {
      readonly provider: boolean;
      readonly publicDns: boolean;
    };
  }) => Promise<Observation | Failure>;
}

export type CleanupOperation =
  | { readonly _tag: "Delete"; readonly id: string; readonly record: DnsRecord }
  | { readonly _tag: "AlreadyAbsent"; readonly id: string; readonly record: DnsRecord }
  | {
      readonly _tag: "Blocked";
      readonly id: string;
      readonly record: DnsRecord;
      readonly reason: string;
    };

export interface CleanupPlan {
  readonly _tag: "CleanupPlan";
  readonly digest: string;
  readonly expiresAt: string;
  readonly operations: ReadonlyArray<CleanupOperation>;
}

export type CleanupResult =
  | {
      readonly _tag: "Cleaned";
      readonly operationId: string;
      readonly results: ReadonlyArray<OperationResult>;
    }
  | {
      readonly _tag: "Partial";
      readonly operationId: string;
      readonly results: ReadonlyArray<OperationResult>;
    }
  | { readonly _tag: "Stale"; readonly message: string }
  | Failure;

export interface CleanupTransport {
  readonly plan: (input: {
    readonly connectionId: string;
    readonly domain: string;
    readonly receiptId: string;
  }) => Promise<CleanupPlan | Failure>;
  readonly apply: (input: {
    readonly connectionId: string;
    readonly domain: string;
    readonly planDigest: string;
    readonly receiptId: string;
  }) => Promise<CleanupResult>;
}

export interface DomainKitTransport {
  readonly cleanup: CleanupTransport;
  readonly connection: ConnectionTransport;
  readonly provisioning: ProvisioningTransport;
  readonly verification: VerificationTransport;
}
