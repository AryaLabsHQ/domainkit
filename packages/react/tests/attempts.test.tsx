import { act } from "@testing-library/react";
import { type Receipt } from "domainkit";

import { Cleanup, Provision } from "../src/index.ts";
import { attach, mount, run, scenario, until } from "./harness.tsx";

describe("Provision.useController", () => {
  it("plans, approves, and applies, handing the receipt to the host", async () => {
    const { domain, requirements, transport } = scenario();
    await attach(transport, domain);
    const applied: Array<Receipt.Model> = [];
    const view = mount(transport, () =>
      Provision.useController({
        domain,
        onApplied: (receipt) => applied.push(receipt),
        requirements,
      }),
    );
    await run(() => view.result.current.plan());
    await until(() => expect(view.result.current.state._tag).toBe("Planned"));
    expect(Provision.pendingPlan(view.result.current.state)?.operations).toHaveLength(2);
    await run(() => view.result.current.approve());
    await until(() => expect(applied).toHaveLength(1));
    expect(view.result.current.state._tag).toBe("Applied");
    // Once an apply has landed the rows read from an observation, not from the plan.
    expect(Provision.pendingPlan(view.result.current.state)).toBeNull();
    expect(Provision.planOf(view.result.current.state)).not.toBeNull();
  });

  it("declines a plan and reports the attempt as declined", async () => {
    const { domain, requirements, transport } = scenario();
    await attach(transport, domain);
    const view = mount(transport, () => Provision.useController({ domain, requirements }));
    await run(() => view.result.current.plan());
    await until(() => expect(view.result.current.state._tag).toBe("Planned"));
    await run(() => view.result.current.reject("not now"));
    await until(() => expect(view.result.current.state._tag).toBe("Rejected"));
    const state = view.result.current.state;
    if (state._tag !== "Rejected") throw new Error("The plan was not declined");
    expect(state.attempt.status).toBe("rejected");
  });

  it("abandons the attempt when the domain changes and keeps it when only the array does", async () => {
    const { domain, requirements, sibling, transport } = scenario();
    await attach(transport, domain);
    const view = mount(
      transport,
      ({ target }: { readonly target: string }) =>
        Provision.useController({ domain: target, requirements: [...requirements] }),
      { initialProps: { target: domain } },
    );
    await run(() => view.result.current.plan());
    await until(() => expect(view.result.current.state._tag).toBe("Planned"));

    // A fresh `requirements` array with the same records is the same attempt.
    act(() => view.rerender({ target: domain }));
    expect(view.result.current.state._tag).toBe("Planned");

    // A different domain is a different attempt, so the old plan can no longer be approved.
    act(() => view.rerender({ target: sibling }));
    expect(view.result.current.state._tag).toBe("Idle");
  });
});

describe("Cleanup.useController", () => {
  it("removes what an apply proved DomainKit created", async () => {
    const { domain, requirements, transport } = scenario();
    await attach(transport, domain);
    const provisioning = mount(transport, () => Provision.useController({ domain, requirements }));
    await run(() => provisioning.result.current.plan());
    await until(() => expect(provisioning.result.current.state._tag).toBe("Planned"));
    await run(() => provisioning.result.current.approve());
    await until(() => expect(provisioning.result.current.state._tag).toBe("Applied"));
    provisioning.unmount();

    const cleaned: Array<Receipt.Model> = [];
    const view = mount(transport, () =>
      Cleanup.useController({ domain, onCleaned: (receipt) => cleaned.push(receipt) }),
    );
    await run(() => view.result.current.plan());
    await until(() => expect(view.result.current.state._tag).toBe("Planned"));
    expect(Cleanup.planOf(view.result.current.state)?.operations.length).toBeGreaterThan(0);
    await run(() => view.result.current.approve());
    await until(() => expect(cleaned).toHaveLength(1));
  });

  it("fails with a rendered reason when the domain has no receipt to undo", async () => {
    const { domain, transport } = scenario();
    await attach(transport, domain);
    const view = mount(transport, () => Cleanup.useController({ domain }));
    await run(() => view.result.current.plan());
    await until(() => expect(view.result.current.state._tag).toBe("Failure"));
    const state = view.result.current.state;
    if (state._tag !== "Failure") throw new Error("The cleanup plan did not fail");
    expect(state.error.reason._tag).toBe("NotFound");
  });
});
