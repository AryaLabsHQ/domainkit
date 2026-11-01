---
packages:
  "@domainkit/react":
    type: patch
---

## Suggest the zone that holds a typed name

`Connect.suggestionsFor` now offers a zone that already holds the typed name before anything else,
deepest first, compared on whole labels. `probe.example.com` offers `example.com`, and a zone that
only shares letters with the name, such as `shop.com` for `probe.example.sh`, is no longer offered.
When no zone holds the name, the field still completes a zone typed part way, either from its start
or after a subdomain, and a finished name that no connected zone holds offers nothing.
`Connect.completionOf` keeps the typed subdomain when it completes a name its zone already holds.
