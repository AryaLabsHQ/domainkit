---
packages:
  domainkit: patch
---

## A provider offers what a customer clicks through first

`Provider.describeMethods` returns a definition's methods in the order a UI presents them: OAuth,
then the integration, then the token. `Provider.methods` reads its kinds from the same list, so the
two never disagree, and a surface that renders the descriptor in order leads with the method a
customer clicks through and leaves the token they have to go and fetch for last.
