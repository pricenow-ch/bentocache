# @pricenow/bentocache

This repository maintains Pricenow's fork of [Bentocache](https://github.com/Julien-R44/bentocache).
The core package is published publicly to npm as `@pricenow/bentocache`.
The initial fork version is `1.6.1`. The OpenTelemetry and Prometheus workspace
packages are retained for development and are not published by this fork.

```sh
pnpm add @pricenow/bentocache
```

```ts
import { BentoCache, bentostore } from '@pricenow/bentocache'
import { memoryDriver } from '@pricenow/bentocache/drivers/memory'
```

Installing this public package does not require npm credentials. Use the upstream API
documentation with `@pricenow/bentocache` in place of `bentocache` imports.

## Releases

The package version in `packages/bentocache/package.json` is the release version.
Publishing does not increment it. Only the core package is publishable.

For the first publication, keep `1.6.1`, merge the fork setup into `main`, then:

```sh
git switch main
git pull --ff-only
npm login --registry=https://registry.npmjs.org/ --auth-type=web
pnpm install --frozen-lockfile
pnpm release:pack
pnpm release:verify
npm publish ./dist/bentocache.tgz --access public
gh release create '@pricenow/bentocache@1.6.1' \
  --target "$(git rev-parse HEAD)" \
  --title '@pricenow/bentocache@1.6.1' \
  --notes 'Initial public Pricenow release, based on Bentocache 1.6.1.'
```

When the first subsequent release is ready, configure a GitHub Actions trusted
publisher in npm's package settings:

- Organization: `pricenow-ch`
- Repository: `bentocache`
- Workflow filename: `publish.yml`
- Environment: leave empty
- Allowed actions: enable direct `npm publish`

Complete the first successful trusted publication within two days of configuring
the publisher, or npm requires deleting and recreating that configuration.
See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

The publishing workflow requires no npm write-token secret. Anyone can install
`@pricenow/bentocache` without npm credentials. Public access is configured only
for this core package; other private packages under `@pricenow` keep their
existing visibility and still require their own read credentials.

The initial local publication does not include a provenance attestation.
Subsequent GitHub Actions releases publish with `--access public --provenance`
from this public repository, using the job's `id-token: write` permission.
The package manifest does not disable provenance, so npm trusted publishing can
also generate it automatically. See [npm's provenance documentation](https://docs.npmjs.com/generating-provenance-statements/).
After the first successful CI publication, verify the version's provenance link
on npm. A local dry run does not verify the OIDC exchange or generate provenance.

For subsequent changes:

1. Make improvements on a branch and add a changeset with `pnpm changeset`.
   Select `@pricenow/bentocache`; choose patch for fixes, minor for compatible
   additions, or major for breaking changes. Commit the changeset with the code.
2. Merge the improvement PRs. On a release branch, run `pnpm changeset version`
   and `pnpm install --lockfile-only`, then review the core version and changelog
   in a PR. Keep dependency versions unchanged unless the changes require an update.
3. Merge the release PR. In GitHub Actions, select **Publish @pricenow/bentocache**,
   choose `main`, and enter the exact version from the package manifest.
4. The workflow runs CI, builds and verifies the tarball, publishes it publicly with provenance,
   and creates a GitHub release tagged `@pricenow/bentocache@<version>`.

Never reuse a published version. If publishing succeeded but recording the
GitHub release failed, create the missing tag/release for the workflow's commit;
do not publish that version again. A failed validation before publishing can be retried.

## Merging upstream improvements

The [Upstream sync workflow](.github/UPSTREAM_SYNC.md) automatically opens and
validates upstream PRs, merges successful syncs, and requests review for conflicts
or changes to fork identity. Before releasing imported user-facing changes, add
a core changeset. Use the manual steps below when a sync needs review.

```sh
git remote add upstream https://github.com/Julien-R44/bentocache.git # once
git fetch upstream
git switch -c update/upstream main
git merge upstream/main
```

Resolve conflicts while keeping the Pricenow package identity, public core
publishing, private companions, release workflow, and scoped workspace imports.
Keep upstream code and dependency improvements. Preserve the fork's version
until Changesets produces the next release; upstream versions do not determine
the next Pricenow version. Reinstall dependencies, run CI, add a core changeset,
and merge the PR before preparing the next release.
