/**
 * @domainkit/react — React flows over a host-owned, browser-safe transport.
 *
 *   <DomainKit.Root transport={Transport.fromFetch("/api/domainkit")}>
 *     <Domain.Flow domain="app.example.com" requirements={requirements} />
 *   </DomainKit.Root>
 *
 * Namespaces mirror the core lifecycle: Connect, Provision, Cleanup, Verify. `Domain.Flow`
 * composes them, and each of its slots has a default.
 */
export * as Cleanup from "./cleanup.tsx";
export * as Connect from "./connect.tsx";
export * as DomainKit from "./domain-kit.tsx";
export * as Messages from "./messages.ts";
export * as Operations from "./operations.tsx";
export * as Provider from "./provider.tsx";
export * as Provision from "./provision.tsx";
export * as Records from "./records.tsx";
export * as Testing from "./testing.ts";
export * as Theme from "./theme.ts";
export * as Verify from "./verify.tsx";

export { Event, type Listener } from "./events.ts";
export { Failure } from "./failure.ts";
export { defaultIcons, useIcons, type Icons } from "./icons.tsx";
export type { ClassName, PartProps, Style } from "./composition.tsx";
