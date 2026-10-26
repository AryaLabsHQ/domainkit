import { Connect, DomainKit } from "@domainkit/react";

// #region recovery
/** Mount inside DomainKit.Root on the page an interactive connection returns to. */
export function ConnectionRecovery() {
  const recovery = Connect.useRecovery();
  const accounts = Connect.useAccounts();
  const messages = DomainKit.useMessages();
  const readOnly = DomainKit.useReadOnly();
  const outcome = recovery.outcome;
  if (outcome === null) return null;

  const provider = accounts.providers.find((entry) => entry.id === outcome.provider);
  const name = provider?.name ?? outcome.provider;
  const words =
    outcome.kind === "cancelled"
      ? messages.recoveryCancelled(name)
      : outcome.kind === "restart"
        ? messages.recoveryRestart(name)
        : messages.recoveryInspect(name);
  const method =
    provider === undefined ? undefined : Connect.describeMethods(provider).interactive[0];
  const busy = accounts.state._tag === "Submitting" || accounts.state._tag === "Redirecting";

  return (
    <div role="alert">
      <strong>{words.title}</strong>
      <p>{words.description}</p>
      {outcome.kind === "inspect" || method === undefined || readOnly ? null : (
        <button
          disabled={busy}
          onClick={() => {
            recovery.dismiss();
            accounts.connect({ provider: outcome.provider, method: method.kind });
          }}
          type="button"
        >
          {messages.retry}
        </button>
      )}
      <button onClick={recovery.dismiss} type="button">
        {messages.dismissRecovery}
      </button>
    </div>
  );
}
// #endregion recovery
