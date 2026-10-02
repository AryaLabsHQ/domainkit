---
packages:
  domainkit:
    type: minor
---

## Require stable Effect 4

DomainKit and its React and CapsuleDB integrations require Effect 4.0.0 or later within major 4.
The HTTP, SQL, and reactivity imports use the stable Effect exports.

`@domainkit/capsuledb` requires CapsuleDB 0.5.x, which supports stable Effect 4. Install
`capsuledb@0.5.0` alongside the integration package.
