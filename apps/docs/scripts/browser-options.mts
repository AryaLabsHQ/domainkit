/** Use Playwright's pinned Chromium unless a contributor explicitly selects another browser. */
export const browserOptions = (environment: Readonly<Record<string, string | undefined>>) => {
  const channel = environment.DOMAINKIT_BROWSER_CHANNEL?.trim();
  const executablePath = environment.DOMAINKIT_BROWSER_EXECUTABLE_PATH?.trim();
  if (channel && executablePath) {
    throw new Error(
      "Set only one of DOMAINKIT_BROWSER_CHANNEL and DOMAINKIT_BROWSER_EXECUTABLE_PATH",
    );
  }
  if (executablePath) return { launchOptions: { executablePath } };
  return channel ? { channel } : {};
};
