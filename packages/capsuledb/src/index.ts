import packageJson from "../package.json" with { type: "json" };

export const VERSION = packageJson.version;

export * as CredentialCustody from "./custody.ts";
export * as HostBindings from "./host-bindings.ts";
export { capsule } from "./persistence.ts";
