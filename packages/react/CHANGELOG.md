## @domainkit/react@0.7.0

### Compose lifecycle models

Expose Effect Atom models for every DNS lifecycle and add shared composable operation primitives.

### Make no-op provisioning explicit

Make provisioning review actions reflect no-op DNS plans and soften dialog focus styling.

### Align Effect package contracts

Align the Effect and Effect Atom peer contract, public installation guidance, and packed consumer
proof for the coordinated 0.3 release.

### Publish Shadcn registry primitives

Document the model-free DomainKit Shadcn registry alongside the installed lifecycle library.

## @domainkit/react@0.6.0

### Attach provider targets to domains

Keep provider account and zone targets explicit when one connection serves more than one customer
domain, so each attachment can be discovered and detached on its own.

### Load provider marks from integrations.sh

Use the shared integrations endpoint for known provider artwork and fall back to the provider's
initial when an image is unavailable. Hosts can still replace a mark through `DomainKit.Root`.

## @domainkit/react@0.5.0

### Adopt provider target attachments

Adopt credential-scoped provider connections, explicit provider-target attachments, and detached-domain lifecycle state.

## @domainkit/react@0.4.0

### Compose stable connected-domain actions

Compose review, cleanup, and disconnect actions into a stable connected-provider surface with host-owned semantic tokens.

### Add host theme presets

Add seven theme presets and token-complete workshop coverage for light and dark host integrations.

### Expose structured lifecycle events

Expose structured lifecycle events from `DomainKit.Root` after successful user-triggered mutations.

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
