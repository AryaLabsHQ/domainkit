import type { DnsRecord } from "domainkit";
import {
  Cleanup,
  Connect,
  DomainKit,
  Messages,
  Provision,
  Records,
  Verify,
} from "@domainkit/react";

declare const requirements: ReadonlyArray<DnsRecord.Model>;

// #region hooks
/**
 * Compose the flow yourself from the same hooks `Domain.Flow` uses. Each takes one options object
 * and returns a controller whose `state` is a tagged union.
 */
export function DomainRow({ domain }: { readonly domain: string }) {
  const connection = Connect.useController({ domain });
  const provisioning = Provision.useController({ domain, requirements });
  const cleanup = Cleanup.useController({ domain });
  const verification = Verify.useController({ domain, polling: true });

  if (connection.state._tag !== "Connected") {
    return <Connect.Dialog controller={connection} />;
  }
  return (
    <section>
      <Records.Table readiness={verification.readiness} records={requirements} />
      <Provision.Actions controller={provisioning} />
      <Cleanup.Actions controller={cleanup} />
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
export function ReviewActions({ domain }: { readonly domain: string }) {
  const provisioning = Provision.useController({ domain, requirements });
  const state = provisioning.state;
  if (state._tag !== "Planned") return null;
  return (
    <div>
      <button onClick={() => provisioning.approve()} type="button">
        Approve {state.plan.operations.length} change(s)
      </button>
      <button onClick={() => provisioning.reject("Not now")} type="button">
        Decline
      </button>
    </div>
  );
}
// #endregion commands

// #region failure
/** A failure keeps the `DomainKit.Error`, so read `reason`, `category`, and `isRetryable`. */
export function ConnectionProblem({ domain }: { readonly domain: string }) {
  const { messages } = DomainKit.useDomainKit();
  const connection = Connect.useController({ domain });
  const state = connection.state;
  if (state._tag !== "Failure") return null;
  return (
    <p role="alert">
      {Messages.failure(state.error, messages)}
      {state.error.isRetryable ? (
        <button onClick={connection.retry} type="button">
          Try again
        </button>
      ) : null}
    </p>
  );
}
// #endregion failure

// #region capabilities
/** Read what the server actually mounted before offering a step it cannot serve. */
export function CleanupButton({ domain }: { readonly domain: string }) {
  const capabilities = DomainKit.useCapabilities();
  const cleanup = Cleanup.useController({ domain });
  if (!capabilities.includes("cleanup")) return null;
  return (
    <button onClick={cleanup.plan} type="button">
      Remove records
    </button>
  );
}
// #endregion capabilities
