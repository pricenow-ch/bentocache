# Upstream synchronization

[Pull](https://github.com/wei/pull) uses [pull.yml](pull.yml) to periodically open
PRs from `Julien-R44/bentocache:main` into `pricenow-ch/bentocache:main`.

- Sync PRs receive the `upstream-sync` label.
- Pull merges with a merge commit, retaining upstream history and fork changes.
- `mergeUnstable: false` permits merging only when GitHub reports a clean PR.
  Require the existing GitHub Actions checks `lint`, `typecheck`, `build`, and
  `tests` on `main` so pending or failed CI blocks merging. Keep required approvals
  disabled to allow conflict-free sync PRs to merge automatically.
- On merge conflicts, Pull adds `merge-conflict` and requests review from `yss14`.
  Resolve the conflicts manually before merging.
- Pull rechecks PRs on scheduled runs, so automatic merging can lag CI completion.

## Activation

1. Merge this configuration into the default branch, `main`, **before installing
   Pull**. Without configuration, Pull defaults to a hard reset, which can discard
   fork changes.
2. Confirm the four required checks above in
   [branch settings](https://github.com/pricenow-ch/bentocache/settings/branches).
   Require checks from GitHub Actions and allow the upstream branch to remain
   behind `main`; requiring it to be up to date would block syncs as the fork moves
   ahead. Pull itself performs automatic merging, so GitHub's separate auto-merge
   option is not required.
3. [Install Pull](https://github.com/apps/pull/installations/new) for `pricenow-ch`,
   selecting only `bentocache`.
4. [Validate the live configuration](https://pull.git.ci/check/pricenow-ch/bentocache)
   after it reaches `main`.

To request a sync immediately, use the
[manual trigger](https://pull.git.ci/process/pricenow-ch/bentocache).
