"use client";

/**
 * @domainkit/react runs custom-domain setup over a host-owned, browser-safe transport. The
 * package supplies state, copy, and accessibility; the host application supplies the markup.
 *
 *   <DomainKit.Root transport={Transport.fromFetch("/api/domainkit")}>
 *     <DomainSetup domain="app.example.com" />
 *   </DomainKit.Root>
 *
 *   const flow = Domain.useFlow({ domain, requirements });
 *
 * The styled composition is the shadcn registry at https://domain-kit.dev/components/registry,
 * which writes the flow against your own button, dialog, table, and badge.
 */
export * as Cleanup from "./cleanup.ts";
export * as Connect from "./connect.ts";
export * as Domain from "./domain.ts";
export * as DomainKit from "./domain-kit.tsx";
export * as Messages from "./messages.ts";
export * as Outcome from "./outcome.ts";
export * as Provision from "./provision.ts";
export * as Records from "./records.ts";
export * as Testing from "./testing.ts";
export * as Verify from "./verify.ts";

export { Event, type Listener } from "./events.ts";
export { Failure } from "./failure.ts";
