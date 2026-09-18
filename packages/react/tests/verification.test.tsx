import { act } from "@testing-library/react";
import { DnsRecord, Verify as CoreVerify } from "domainkit";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { Testing, Verify } from "../src/index.ts";
import { attach, methodsCalled, mount, run, scenario, until } from "./harness.tsx";

describe("Verify.useController", () => {
  it("observes on mount and reports readiness per requirement", async () => {
    const { domain, requirements, transport } = scenario();
    await attach(transport, domain);
    const view = mount(transport, () =>
      Verify.useController({ domain, polling: false, requirements }),
    );
    await until(() => expect(view.result.current.readiness).not.toBeNull());
    expect(view.result.current.readiness?.requirements).toHaveLength(requirements.length);
    expect(view.result.current.state._tag).toBe("Observed");
  });

  it("drops readiness when the domain changes", async () => {
    const { domain, requirements, sibling, transport } = scenario();
    await attach(transport, domain);
    const view = mount(
      transport,
      ({ target }: { readonly target: string }) =>
        Verify.useController({ domain: target, polling: false, requirements }),
      { initialProps: { target: domain } },
    );
    await until(() => expect(view.result.current.readiness).not.toBeNull());
    act(() => view.rerender({ target: sibling }));
    expect(view.result.current.readiness).toBeNull();
  });

  it("refuses an answer that arrives after the controller moved to another domain", async () => {
    const { domain, requirements, sibling, transport } = scenario();
    await attach(transport, domain);
    const view = mount(
      transport,
      ({ target }: { readonly target: string }) =>
        Verify.useController({ domain: target, polling: false, requirements }),
      { initialProps: { target: domain } },
    );
    await until(() => expect(view.result.current.readiness?.domain).toBe(domain));
    act(() => view.rerender({ target: sibling }));
    // The first frame is free of the previous domain's evidence, and the answer still in flight
    // for it never puts that evidence back.
    expect(view.result.current.readiness).toBeNull();
    await until(() => expect(view.result.current.state._tag).toBe("Observed"));
    expect(view.result.current.readiness?.domain).toBe(sibling);
  });

  it("observes again when a requirement changes in a way only the wire sees", async () => {
    const { domain, transport } = scenario();
    const base = DnsRecord.cname({
      name: domain,
      purpose: "Serve your site",
      target: "edge.example.com",
    });
    const retimed = DnsRecord.cname({
      name: domain,
      purpose: "Serve your site",
      target: "edge.example.com",
      ttl: 300,
    });
    const observations = () =>
      transport.calls.filter((call) => call.method === "verification.observe").length;
    const view = mount(
      transport,
      ({ record }: { readonly record: DnsRecord.Model }) =>
        Verify.useController({ domain, polling: false, requirements: [record] }),
      { initialProps: { record: base } },
    );
    await until(() => expect(observations()).toBe(1));
    act(() => view.rerender({ record: retimed }));
    await until(() => expect(observations()).toBe(2));
  });
});

describe("Verify.useController with host-supplied readiness", () => {
  /** Read the stored readiness the way a host does, rather than through the hook. */
  const readStored = async (
    transport: Testing.RecordingTransport,
    domain: string,
    requirements: ReadonlyArray<DnsRecord.Model>,
  ) => {
    const verification = transport.verification;
    if (verification === undefined) throw new Error("The fake transport has no verification group");
    await Effect.runPromise(verification.observe(domain, { requirements }));
    return Effect.runPromise(verification.latest(domain));
  };

  it("observes nothing on mount and reports the readiness the host holds", async () => {
    const { domain, requirements, transport } = scenario();
    await attach(transport, domain);
    const readiness = await readStored(transport, domain, requirements);
    const before = methodsCalled(transport).length;
    const view = mount(transport, () =>
      Verify.useController({ domain, requirements, supplied: { readiness } }),
    );
    await until(() => expect(view.result.current.readiness).not.toBeNull());
    expect(view.result.current.readiness).toEqual(readiness);
    expect(view.result.current.state._tag).toBe("Observed");
    // Polling is the host's clock now, and nothing reached the transport.
    expect(view.result.current.polling).toBe(false);
    expect(methodsCalled(transport).length).toBe(before);
  });

  it("is idle with no readiness, and observe and retry ask the host", async () => {
    const { domain, requirements, transport } = scenario();
    await attach(transport, domain);
    let asked = 0;
    const view = mount(transport, () =>
      Verify.useController({
        domain,
        requirements,
        supplied: { readiness: null, observe: () => (asked += 1) },
      }),
    );
    expect(view.result.current.state._tag).toBe("Idle");
    expect(view.result.current.readiness).toBeNull();
    await run(() => view.result.current.observe());
    await run(() => view.result.current.retry());
    expect(asked).toBe(2);
    expect(methodsCalled(transport)).not.toContain("verification.observe");
  });

  it("discards a supplied readiness that belongs to another domain", async () => {
    const { domain, requirements, sibling, transport } = scenario();
    await attach(transport, domain);
    const readiness = await readStored(transport, domain, requirements);
    const view = mount(
      transport,
      ({ target }: { readonly target: string }) =>
        Verify.useController({ domain: target, requirements, supplied: { readiness } }),
      { initialProps: { target: domain } },
    );
    await until(() => expect(view.result.current.readiness?.domain).toBe(domain));
    // The host moved the surface before its own read landed. The previous domain's evidence does
    // not travel with it, so nothing plans from drift that was never about this domain.
    act(() => view.rerender({ target: sibling }));
    expect(view.result.current.readiness).toBeNull();
    expect(view.result.current.state._tag).toBe("Idle");
  });

  it("stops its own timer when the host takes the clock mid-mount", async () => {
    const { domain, requirements, transport } = scenario();
    await attach(transport, domain);
    let asked = 0;
    const view = mount(
      transport,
      ({ supplied }: { readonly supplied: Verify.Supplied | undefined }) =>
        Verify.useController({
          domain,
          requirements,
          ...(supplied === undefined ? {} : { supplied }),
        }),
      { initialProps: { supplied: undefined as Verify.Supplied | undefined } },
    );
    await until(() => expect(view.result.current.state._tag).toBe("Observed"));
    const observations = () =>
      methodsCalled(transport).filter((method) => method === "verification.observe").length;
    const before = observations();

    // The host takes over. The schedule the controller's own observation left behind is not one
    // the host asked for, so nothing fires against it.
    act(() => view.rerender({ supplied: { readiness: null, observe: () => (asked += 1) } }));
    expect(view.result.current.polling).toBe(false);
    expect(view.result.current.state._tag).toBe("Idle");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(observations()).toBe(before);
    expect(asked).toBe(0);
  });

  it("does nothing when the host supplies no observe", async () => {
    const { domain, requirements, transport } = scenario();
    await attach(transport, domain);
    const view = mount(transport, () =>
      Verify.useController({ domain, requirements, supplied: { readiness: null } }),
    );
    await run(() => view.result.current.observe());
    expect(methodsCalled(transport)).not.toContain("verification.observe");
    expect(view.result.current.state._tag).toBe("Idle");
  });
});

describe("Verify.valuesOf", () => {
  const observedAt = DateTime.makeUnsafe("2026-09-04T10:00:00.000Z");

  it("reports what an observer read back, and nothing for a lookup that never answered", () => {
    const mismatch = new CoreVerify.PublicDnsEvidence({
      detail: null,
      observedAt,
      resolver: "cloudflare",
      status: "mismatch",
      values: ["old.example.com"],
    });
    expect(Verify.valuesOf(mismatch)).toEqual(["old.example.com"]);

    const unanswered = new CoreVerify.PublicDnsEvidence({
      detail: "The resolver did not answer.",
      observedAt,
      resolver: "quad9",
      status: "unknown",
      values: [],
    });
    // An unknown observation is a lookup that never answered, not a name that holds nothing.
    expect(Verify.valuesOf(unanswered)).toBeNull();

    const host = new CoreVerify.HostEvidence({
      detail: null,
      label: "Email identity",
      observedAt,
      source: "ses",
      status: "pending",
    });
    // Host evidence reports a status the host reached rather than values read off a name.
    expect(Verify.valuesOf(host)).toBeNull();
  });
});
