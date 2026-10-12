const upstream = { owner: 'Julien-R44', repo: 'bentocache', branch: 'main' }
const repository = { owner: 'pricenow-ch', repo: 'bentocache' }
const syncLabel = 'upstream-sync'
const conflictLabel = 'merge-conflict'
const identityLabel = 'fork-identity'
const reviewer = 'yss14'
const prMarker = '<!-- upstream-sync:pricenow-ch/bentocache -->'

export const checkNames = ['lint', 'typecheck', 'build', 'tests', 'upstream-sync-tests']

function isManaged(pr) {
  return (
    pr.state === 'open' &&
    !pr.draft &&
    pr.user.login === 'github-actions[bot]' &&
    pr.base.repo.full_name === `${repository.owner}/${repository.repo}` &&
    pr.base.ref === 'main' &&
    pr.head.repo?.full_name === `${upstream.owner}/${upstream.repo}` &&
    pr.head.ref === upstream.branch &&
    pr.body?.includes(prMarker)
  )
}

async function ensureLabel(github, name, color, description) {
  try {
    await github.rest.issues.getLabel({ ...repository, name })
  } catch (error) {
    if (error.status !== 404) throw error
    await github.rest.issues.createLabel({ ...repository, name, color, description })
  }
}

async function requestReview(github, pr, label) {
  if (
    !pr.labels.some((entry) => entry.name === label) &&
    !pr.requested_reviewers.some((entry) => entry.login === reviewer)
  ) {
    await github.rest.pulls.requestReviewers({
      ...repository,
      pull_number: pr.number,
      reviewers: [reviewer],
    })
  }
  await github.rest.issues.addLabels({
    ...repository,
    issue_number: pr.number,
    labels: [label],
  })
}

async function readContent(github, path, ref) {
  const { data } = await github.rest.repos.getContent({ ...repository, path, ref })
  if (typeof data.content !== 'string') {
    throw new SyntaxError(`Expected a file at ${path}`)
  }
  return Buffer.from(data.content, 'base64').toString('utf8')
}

async function getMergeability(github, number, sleep) {
  let pr
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data } = await github.rest.pulls.get({ ...repository, pull_number: number })
    pr = data
    if (pr.mergeable !== null && pr.mergeable_state !== 'unknown') break
    await sleep(2000)
  }
  return pr
}

async function preservesIdentity(github, pr) {
  const corePath = 'packages/bentocache/package.json'
  const releasePath = '.github/workflows/publish.yml'
  const [baseCore, mergedCore, baseRelease, mergedRelease, otel, prometheus] = await Promise.all([
    readContent(github, corePath, pr.base.sha),
    readContent(github, corePath, pr.merge_commit_sha),
    readContent(github, releasePath, pr.base.sha),
    readContent(github, releasePath, pr.merge_commit_sha),
    readContent(github, 'packages/otel/package.json', pr.merge_commit_sha),
    readContent(github, 'packages/prometheus/package.json', pr.merge_commit_sha),
  ])
  const base = JSON.parse(baseCore)
  const merged = JSON.parse(mergedCore)
  return (
    merged.name === '@pricenow/bentocache' &&
    merged.version === base.version &&
    merged.private !== true &&
    merged.publishConfig?.access === 'public' &&
    merged.publishConfig?.registry === 'https://registry.npmjs.org/' &&
    merged.publishConfig?.provenance !== false &&
    merged.repository?.url === 'git+https://github.com/pricenow-ch/bentocache.git' &&
    JSON.parse(otel).private === true &&
    JSON.parse(prometheus).private === true &&
    baseRelease === mergedRelease
  )
}

/** Create or inspect a sync PR and pin the merge commit that CI must validate. */
export async function prepareSync({ github, core, runUrl, sleep }) {
  const { data: comparison } = await github.rest.repos.compareCommitsWithBasehead({
    ...repository,
    basehead: `main...${upstream.owner}:${upstream.branch}`,
    per_page: 1,
  })
  if (comparison.total_commits === 0) {
    core.notice('No upstream commits to synchronize.')
    return null
  }

  const { data: pulls } = await github.rest.pulls.list({
    ...repository,
    base: 'main',
    head: `${upstream.owner}:${upstream.branch}`,
    state: 'open',
    per_page: 100,
  })
  let pr = pulls.find((entry) => entry.head.repo?.full_name === 'Julien-R44/bentocache')
  if (pr && !isManaged(pr)) {
    core.notice(`PR #${pr.number} is managed manually; leaving it for its owner.`)
    return null
  }

  await ensureLabel(github, syncLabel, '1d76db', 'Automated upstream synchronization')
  await ensureLabel(github, conflictLabel, 'd73a4a', 'Upstream sync needs conflict resolution')
  await ensureLabel(
    github,
    identityLabel,
    'e4e669',
    'Upstream changes affect Pricenow fork identity',
  )

  if (!pr) {
    const { data } = await github.rest.pulls.create({
      ...repository,
      base: 'main',
      head: `${upstream.owner}:${upstream.branch}`,
      maintainer_can_modify: false,
      title: 'chore: sync upstream main',
      body: [
        prMarker,
        'Synchronizes `Julien-R44/bentocache:main` into this fork using a merge commit.',
        '',
        'The Upstream sync workflow tests the exact merge commit and merges only after CI passes.',
        'Conflicts or changes to fork identity request review from `yss14`.',
        '',
        'See [.github/UPSTREAM_SYNC.md](https://github.com/pricenow-ch/bentocache/blob/main/.github/UPSTREAM_SYNC.md) for manual resolution.',
      ].join('\n'),
    })
    pr = data
  }
  if (!pr.labels.some((label) => label.name === syncLabel)) {
    await github.rest.issues.addLabels({
      ...repository,
      issue_number: pr.number,
      labels: [syncLabel],
    })
  }
  pr = await getMergeability(github, pr.number, sleep)
  if (!isManaged(pr)) return null
  if (pr.mergeable === false) {
    await requestReview(github, pr, conflictLabel)
    core.notice(`PR #${pr.number} has merge conflicts; requested review from ${reviewer}.`)
    return null
  }
  if (!pr.mergeable || !pr.merge_commit_sha) {
    core.notice(`PR #${pr.number} mergeability is not ready; retrying on the next run.`)
    return null
  }
  let identityPreserved = false
  try {
    identityPreserved = await preservesIdentity(github, pr)
  } catch (error) {
    if (error.status !== 404 && !(error instanceof SyntaxError)) throw error
  }
  if (!identityPreserved) {
    await requestReview(github, pr, identityLabel)
    core.notice(`PR #${pr.number} changes fork identity; requested review from ${reviewer}.`)
    return null
  }

  for (const label of [conflictLabel, identityLabel]) {
    if (!pr.labels.some((entry) => entry.name === label)) continue
    await github.rest.issues.removeLabel({ ...repository, issue_number: pr.number, name: label })
  }
  const checks = {}
  for (const name of checkNames) {
    const { data } = await github.rest.checks.create({
      ...repository,
      name,
      head_sha: pr.merge_commit_sha,
      status: 'in_progress',
      details_url: runUrl,
      output: {
        title: `Validating ${name}`,
        summary: `Testing merge commit ${pr.merge_commit_sha}.`,
      },
    })
    checks[name] = data.id
  }
  return {
    number: pr.number,
    head: pr.head.sha,
    base: pr.base.sha,
    merge: pr.merge_commit_sha,
    checks,
  }
}

/** Attach the real CI job results to the tested PR merge commit. */
export async function reportChecks({ github, checks, results, runUrl }) {
  for (const name of checkNames) {
    const result = results[name]
    await github.rest.checks.update({
      ...repository,
      check_run_id: checks[name],
      status: 'completed',
      conclusion:
        result === 'success' ? 'success' : result === 'cancelled' ? 'cancelled' : 'failure',
      details_url: runUrl,
      output: {
        title: `${name}: ${result}`,
        summary: `CI job result: ${result}. [Workflow run](${runUrl})`,
      },
    })
  }
  return checkNames.every((name) => results[name] === 'success')
}

/** Merge only a managed PR whose commits still match the successfully tested plan. */
export async function mergeSync({ github, core, plan, sleep }) {
  const pr = await getMergeability(github, plan.number, sleep)
  if (
    !isManaged(pr) ||
    pr.mergeable !== true ||
    pr.head.sha !== plan.head ||
    pr.base.sha !== plan.base ||
    pr.merge_commit_sha !== plan.merge
  ) {
    core.notice('The PR changed during CI; leaving it for the next sync run.')
    return false
  }
  for (const name of checkNames) {
    const { data: check } = await github.rest.checks.get({
      ...repository,
      check_run_id: plan.checks[name],
    })
    if (
      check.head_sha !== plan.merge ||
      check.name !== name ||
      check.app.slug !== 'github-actions' ||
      check.status !== 'completed' ||
      check.conclusion !== 'success'
    ) {
      core.notice('Required sync validation is incomplete or failed; leaving the PR open.')
      return false
    }
  }
  const { data } = await github.rest.pulls.merge({
    ...repository,
    pull_number: pr.number,
    sha: plan.head,
    merge_method: 'merge',
  })
  if (!data.merged) throw new Error(data.message)
  core.notice(`Merged upstream sync PR #${pr.number}.`)
  return true
}
