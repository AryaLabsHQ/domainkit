---
packages:
  domainkit: patch
---

## Call the default fetch as a free function

`Transport.fromFetch` and `Resolver` resolve the default `fetch` from `globalThis` at call time and invoke it as a free function, so browsers no longer throw `Illegal invocation` when a host relies on the default fetch and a fetch polyfilled after construction is picked up.
