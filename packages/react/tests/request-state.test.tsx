import { act, cleanup, render } from "@testing-library/react";
import { useLayoutEffect } from "react";

import * as RequestState from "../src/request-state.ts";

afterEach(cleanup);

describe("request state", () => {
  it("invalidates an active request before layout effects observe a new identity", () => {
    let controller: RequestState.Controller<string> | undefined;
    let committed: boolean | undefined;

    function Harness({ identity, request }: { identity: string; request?: number }) {
      const current = RequestState.useController(identity, "idle");
      controller = current;
      useLayoutEffect(() => {
        if (request !== undefined) committed = current.commit(request, "stale");
      }, [current, request]);
      return null;
    }

    const view = render(<Harness identity="records-a" />);
    let request = 0;
    act(() => {
      request = controller?.begin("applying") ?? 0;
    });

    view.rerender(<Harness identity="records-b" request={request} />);

    expect(committed).toBe(false);
    expect(controller?.state).toBe("idle");
  });
});
