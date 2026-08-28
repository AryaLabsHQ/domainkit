# Releases

DomainKit uses Tegami and npm trusted publishing. GitHub Actions receives a short-lived OIDC
credential for each publication; the repository does not store an npm automation token.

Every change intended for a release includes a Tegami changelog entry. A push to `main` turns
pending entries into the `tegami/version-packages` pull request. Merging that version pull request
publishes the audited package, pushes its `v<version>` tag, and creates the matching GitHub Release.

The initial release line is `beta`, so prerelease versions publish under the npm `beta` dist-tag.
Graduating the package to stable removes the `prerelease` setting from `scripts/tegami.mts`; stable
versions then publish under npm's default `latest` tag.

Before enabling publication, the saved npm trusted publisher must match:

- owner: `AryaLabsHQ`
- repository: `domainkit`
- workflow: `publish.yml`

Useful local checks:

```bash
bun run release:check
bun run tegami pr preview
```

To exercise the complete publish path on a disposable branch with a pending `.tegami` changelog,
draft the publish lock and then validate it without touching npm or GitHub:

```bash
bun run tegami version
bun run tegami publish --dry-run
```
