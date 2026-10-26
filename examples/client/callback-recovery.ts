import { CallbackRecovery } from "domainkit/client";

// #region codec
const destination = new URL("https://app.example.com/settings/domains?tab=dns#accounts");
export const recoveryUrl = CallbackRecovery.write(destination, {
  kind: "cancelled",
  provider: "cloudflare",
});
export const recovery = CallbackRecovery.read(recoveryUrl);
export const dismissedUrl = CallbackRecovery.write(recoveryUrl, null);
// #endregion codec
