# Upstream synchronization

[Upstream sync](workflows/upstream_sync.yml) checks
`Julien-R44/bentocache:main` every six hours and opens one `upstream-sync` PR into
`pricenow-ch/bentocache:main` when upstream has new commits. Existing sync PRs track
the upstream branch automatically. You can also run the workflow manually from
[GitHub Actions](https://github.com/pricenow-ch/bentocache/actions/workflows/upstream_sync.yml).

The workflow uses the built-in `GITHUB_TOKEN`. No third-party app or token secret
is needed. GitHub Actions must be allowed to create PRs in repository settings;
this is already enabled for this fork.

## Validation and merging

The sync workflow calls the existing CI workflow directly to test the PR's exact
merge commit. It reports the actual `lint`, `typecheck`, `build`, `docs`, `tests`, and
`upstream-sync-tests` job results as checks on that commit. This lets scheduled
syncs run unattended even when GitHub requires approval for the ordinary CI run
on a PR created using `GITHUB_TOKEN`.

CI jobs have read-only access. Separate jobs create PRs, report check results,
and merge. Automatic merging requires all six validation jobs to pass and the
PR's head, base, and merge commit to remain unchanged during CI. GitHub branch
protection still applies. Required checks must come from GitHub Actions, and
required approvals and the requirement for the upstream branch to be up to date
must remain disabled. GitHub's separate auto-merge setting is not needed.

Syncs use merge commits to retain upstream history and fork changes. They do not
publish npm packages. Before the next release, add a core changeset covering
imported user-facing changes, as described in [RELEASING.md](../RELEASING.md).

## Manual review

- Merge conflicts add `merge-conflict` and request review from `yss14`.
- Changes to the core package name, version, public publishing configuration,
  private companion packages, or publishing workflow add `fork-identity` and
  request review from `yss14`. These PRs require manual resolution.
- Pending, failed, cancelled, or skipped validation leaves the PR open. The next
  scheduled run retries validation. Branch changes during CI also wait for a
  new run.
- Sync PRs are exempt from automatic stale closure. A manually created PR from
  the same upstream branch is left for its author rather than auto-merged.

To resolve conflicts, follow the manual upstream merge steps in
[RELEASING.md](../RELEASING.md) on a branch in this fork and merge the resolved PR.
The original sync PR will become merged or obsolete once the upstream commits
are included in `main`.

To pause syncing, disable **Upstream sync** in GitHub Actions. Scheduled workflows
run only after this setup reaches the default branch and GitHub can disable them
after 60 days of repository inactivity; re-enable the workflow if needed.
