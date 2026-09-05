import { Connect } from "@domainkit/react";
import { useState } from "react";

// #region zones
/**
 * Every zone the workspace's accounts reach. A connection whose credential the provider turned
 * down is listed as `reconnect` and contributes no zones, so one dead account never costs the
 * customer the others.
 */
export function ZoneList() {
  const { connections, state, zones } = Connect.useZones();
  if (state._tag === "Loading") return <p>Loading zones</p>;
  return (
    <ul>
      {zones.map((zone) => (
        <li key={`${zone.connectionId}:${zone.zone}`}>
          {zone.zone} · {zone.label}
        </li>
      ))}
      {connections.length === 0 ? <li>No account connected yet</li> : null}
    </ul>
  );
}
// #endregion zones

// #region field
/**
 * One input over those zones. Arrow keys move the highlight, Tab or Enter finishes the name while
 * keeping whatever subdomain was typed in front of the zone, and `found` says which account the
 * records would go to.
 */
export function AddDomainField() {
  const [value, setValue] = useState("");
  const { zones } = Connect.useZones();
  const field = Connect.useDomainField({ onChange: setValue, value, zones });
  return (
    <div>
      <input {...field.inputProps} placeholder="app.example.com" />
      <ul {...field.listboxProps}>
        {field.suggestions.map((zone) => (
          <li key={`${zone.connectionId}:${zone.zone}`} {...field.optionProps(zone)}>
            {zone.zone}
          </li>
        ))}
      </ul>
      <p>{field.found === null ? "Not in a connected account" : field.found.zone.label}</p>
    </div>
  );
}
// #endregion field

// #region accounts
/**
 * Connecting an account names no domain: what the customer grants is the account itself. A token
 * method finishes in place; an interactive one redirects and comes back through the library's own
 * callback.
 */
export function ConnectAccount() {
  const accounts = Connect.useAccounts();
  const busy = accounts.state._tag === "Submitting" || accounts.state._tag === "Redirecting";
  return accounts.providers.map((provider) => {
    const methods = Connect.describeMethods(provider);
    const interactive = methods.interactive[0];
    if (interactive === undefined) return null;
    return (
      <button
        disabled={busy}
        key={provider.id}
        onClick={() => accounts.connect({ method: interactive.kind, provider: provider.id })}
        type="button"
      >
        Connect {provider.name}
      </button>
    );
  });
}
// #endregion accounts
