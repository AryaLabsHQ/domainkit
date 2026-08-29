export interface Failure {
  readonly _tag: "Failure";
  readonly message: string;
  readonly retry: "never" | "after-user-action" | "safe" | "unknown";
}

export type AuthenticationMethod =
  | { readonly _tag: "OAuth"; readonly label: string }
  | { readonly _tag: "Token"; readonly label: string; readonly placeholder?: string };

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
    readonly providerId: string;
    readonly token?: string;
  }) => Promise<ConnectionResult>;
  readonly inspect: (input: { readonly domain: string }) => Promise<ConnectionSnapshot>;
  readonly reuse: (input: {
    readonly connectionId: string;
    readonly domain: string;
  }) => Promise<Connected | Failure>;
}

export interface DomainKitTransport {
  readonly connection: ConnectionTransport;
}
