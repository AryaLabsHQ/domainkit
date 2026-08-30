## @domainkit/react@0.3.1

### Keep the React package aligned with DomainKit core

Validate the packed React artifact against the current core version so releases cannot publish an
incompatible stale dependency range.

## @domainkit/react@0.3.0

### Compose connection rows with host controls

Separate the unstyled connection trigger from the packaged provider-marked recipe so applications
can use their own buttons, labels, and row layout without rebuilding the connection dialog.

### Run React lifecycle controllers through Effect Atom

Use the canonical `domainkit` transport service and an Effect layer at `DomainKit.Root`, replace
duplicated Promise transport models and manual request tracking with Effect Atom, and require React
19 for the 0.3 release.

## @domainkit/react@0.1.1

### Show exact DNS operation values

Display record values and optional priority in provisioning and cleanup reviews so users can inspect
the complete DNS mutation before authorizing it.

## @domainkit/react@0.1.0

### Publish the DomainKit React 0.1 contract

Ship accessible React flows for connecting DNS providers, reviewing and applying record plans,
verifying DNS, removing managed records, and disconnecting domains. Applications can compose the
semantic parts, provide their own theme and icons, or use the complete default flows.

The package also includes host-free DNS record tables, cards, copy controls, status presentation,
and zone-file export, with a workshop for testing the components and theme contract.
