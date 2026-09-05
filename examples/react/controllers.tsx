import type { DnsRecord } from "domainkit";
import { Cleanup, Connect, DomainKit, Outcome, Provision, Verify } from "@domainkit/react";

declare const requirements: ReadonlyArray<DnsRecord.Model>;

// #region hooks
/**
 * Compose the surface yourself from the same hooks `Domain.useFlow` runs. Each takes one options
 * object and returns a controller whose `state` is a tagged union.
 */
export function DomainRow({ domain }: { readonly domain: string }) {
  const connection = Connect.useController({ domain });
  const provisioning = Provision.useController({ domain, requirements });
  const cleanup = Cleanup.useController({ domain });
  const verification = Verify.useController({ domain, polling: true });

  if (!Connect.holdsConnection(connection)) {
    return <ConnectButton controller={connection} />;
  }
  return (
    <section>
      <RecordRows readiness={verification.readiness} records={requirements} />
      <ReviewActions controller={provisioning} />
      <RemoveButton controller={cleanup} />
    </section>
  );
}
// #endregion hooks

// #region commands
/**
 * `approve` authorizes the digest and applies it in one action. `reject` records the refusal and
 * is terminal. `retry` re-plans when the reason says the old plan is gone and re-runs the failed
 * step otherwise.
 */
export function ReviewActions({ controller }: { readonly controller: Provision.Controller }) {
  const state = controller.state;
  if (state._tag !== "Planned") return null;
  return (
    <div>
      <button onClick={() => controller.approve()} type="button">
        Approve {state.plan.operations.length} change(s)
      </button>
      <button onClick={() => controller.reject("Not now")} type="button">
        Decline
      </button>
    </div>
  );
}
// #endregion commands

// #region failure
/** A failure keeps the `DomainKit.Error`, so read `reason`, `category`, and `isRetryable`. */
export function ConnectionProblem({ domain }: { readonly domain: string }) {
  const describe = Outcome.useDescribe();
  const connection = Connect.useController({ domain });
  const state = connection.state;
  if (state._tag !== "Failure") return null;
  const words = describe(state.error, {
    ...(state.attempt === null
      ? {}
      : { provider: Connect.displayName(connection, state.attempt.provider) }),
  });
  return (
    <div role="alert">
      <strong>{words.title}</strong>
      <p>{words.description}</p>
      {state.error.isRetryable ? (
        <button onClick={connection.retry} type="button">
          Try again
        </button>
      ) : null}
    </div>
  );
}
// #endregion failure

// #region capabilities
/** Read what the server actually mounted before offering a step it cannot serve. */
export function RemoveButton({ controller }: { readonly controller: Cleanup.Controller }) {
  const capabilities = DomainKit.useCapabilities();
  if (!capabilities.includes("cleanup")) return null;
  return (
    <button onClick={controller.plan} type="button">
      Remove records
    </button>
  );
}
// #endregion capabilities

declare function ConnectButton(props: {
  readonly controller: Connect.Controller;
}): React.ReactElement;
declare function RecordRows(props: {
  readonly readiness: Verify.Readiness | null;
  readonly records: ReadonlyArray<DnsRecord.Model>;
}): React.ReactElement;
