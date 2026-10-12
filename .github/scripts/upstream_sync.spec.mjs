import { test } from 'node:test'
import assert from 'node:assert/strict'

import { checkNames, mergeSync, prepareSync, reportChecks } from './upstream_sync.mjs'

const runUrl = 'https://github.com/pricenow-ch/bentocache/actions/runs/123'

function fixture() {
  const pr = {
    number: 10,
    state: 'open',
    draft: false,
    body: '<!-- upstream-sync:pricenow-ch/bentocache -->',
    user: { login: 'github-actions[bot]' },
    base: { ref: 'main', sha: 'base-sha', repo: { full_name: 'pricenow-ch/bentocache' } },
    head: { ref: 'main', sha: 'head-sha', repo: { full_name: 'Julien-R44/bentocache' } },
    mergeable: true,
    mergeable_state: 'clean',
    merge_commit_sha: 'merge-sha',
    labels: [{ name: 'upstream-sync' }],
    requested_reviewers: [],
  }
  const manifest = {
    name: '@pricenow/bentocache',
    version: '1.6.1',
    publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
    repository: { url: 'git+https://github.com/pricenow-ch/bentocache.git' },
  }
  const state = {
    pr,
    manifest,
    ahead: 1,
    existing: true,
    contents: {},
    calls: [],
    notices: [],
    checks: {},
  }
  const write = (method, params) => state.calls.push({ method, ...params })
  const github = {
    rest: {
      repos: {
        compareCommitsWithBasehead: async () => ({ data: { total_commits: state.ahead } }),
        getContent: async ({ path, ref }) => {
          const content =
            state.contents[`${ref}:${path}`] ??
            (path.endsWith('publish.yml')
              ? 'trusted publishing workflow'
              : JSON.stringify(path.includes('/bentocache/') ? manifest : { private: true }))
          return { data: { content: Buffer.from(content).toString('base64') } }
        },
      },
      issues: {
        getLabel: async () => ({}),
        createLabel: async (params) => write('createLabel', params),
        addLabels: async (params) => {
          write('addLabels', params)
          pr.labels.push(...params.labels.map((name) => ({ name })))
        },
        removeLabel: async (params) => write('removeLabel', params),
      },
      pulls: {
        list: async () => ({ data: state.existing ? [pr] : [] }),
        create: async (params) => {
          write('create', params)
          state.existing = true
          return { data: pr }
        },
        get: async () => ({ data: pr }),
        requestReviewers: async (params) => {
          write('review', params)
          pr.requested_reviewers.push(...params.reviewers.map((login) => ({ login })))
        },
        merge: async (params) => {
          write('merge', params)
          return { data: { merged: true } }
        },
      },
      checks: {
        create: async (params) => {
          write('check', params)
          const id = Object.keys(state.checks).length + 1
          state.checks[id] = { ...params, id, app: { slug: 'github-actions' } }
          return { data: { id } }
        },
        update: async (params) => {
          write('updateCheck', params)
          Object.assign(state.checks[params.check_run_id], params)
        },
        get: async ({ check_run_id: id }) => ({ data: state.checks[id] }),
      },
    },
  }
  const core = { notice: (message) => state.notices.push(message) }
  return { state, github, core, runUrl, sleep: async () => {} }
}

test('no upstream commits causes no repository writes', async () => {
  const setup = fixture()
  setup.state.ahead = 0
  assert.equal(await prepareSync(setup), null)
  assert.deepEqual(setup.state.calls, [])
})

test('creates one upstream PR and tests its exact merge commit', async () => {
  const setup = fixture()
  setup.state.existing = false
  const plan = await prepareSync(setup)
  assert.equal(plan.merge, 'merge-sha')
  const creation = setup.state.calls.find((call) => call.method === 'create')
  assert.equal(creation.head, 'Julien-R44:main')
  assert.equal(creation.base, 'main')
  assert.ok(Object.values(setup.state.checks).every((check) => check.head_sha === plan.merge))
  await prepareSync(setup)
  assert.equal(setup.state.calls.filter((call) => call.method === 'create').length, 1)
})

test('reuses an existing managed PR', async () => {
  const setup = fixture()
  const plan = await prepareSync(setup)
  assert.equal(plan.number, 10)
  assert.ok(!setup.state.calls.some((call) => call.method === 'create'))
})

test('conflicts request yss14 once and never start validation', async () => {
  const setup = fixture()
  setup.state.pr.mergeable = false
  setup.state.pr.mergeable_state = 'dirty'
  assert.equal(await prepareSync(setup), null)
  assert.equal(await prepareSync(setup), null)
  assert.deepEqual(
    setup.state.calls.filter((call) => call.method === 'review').map((call) => call.reviewers),
    [['yss14']],
  )
  assert.ok(setup.state.pr.labels.some((label) => label.name === 'merge-conflict'))
  assert.ok(!setup.state.calls.some((call) => call.method === 'check'))
})

test('a manual upstream PR is never taken over', async () => {
  const setup = fixture()
  setup.state.pr.user.login = 'yss14'
  assert.equal(await prepareSync(setup), null)
  assert.deepEqual(setup.state.calls, [])
})

test('an unrelated bot PR is never taken over', async () => {
  const setup = fixture()
  setup.state.pr.body = 'Created by another workflow'
  assert.equal(await prepareSync(setup), null)
  assert.deepEqual(setup.state.calls, [])
})

test('recovers a managed PR whose label update was interrupted', async () => {
  const setup = fixture()
  setup.state.pr.labels = []
  assert.ok(await prepareSync(setup))
  assert.ok(setup.state.pr.labels.some((label) => label.name === 'upstream-sync'))
  assert.ok(!setup.state.calls.some((call) => call.method === 'create'))
})

test('unknown mergeability leaves the PR open without requesting conflict review', async () => {
  const setup = fixture()
  setup.state.pr.mergeable = null
  setup.state.pr.mergeable_state = 'unknown'
  assert.equal(await prepareSync(setup), null)
  assert.ok(!setup.state.calls.some((call) => ['review', 'check'].includes(call.method)))
})

test('an upstream version bump requests review and blocks automatic merging', async () => {
  const setup = fixture()
  setup.state.contents['merge-sha:packages/bentocache/package.json'] = JSON.stringify({
    ...setup.state.manifest,
    version: '1.7.0',
  })
  assert.equal(await prepareSync(setup), null)
  assert.ok(setup.state.pr.labels.some((label) => label.name === 'fork-identity'))
  assert.ok(setup.state.calls.some((call) => call.method === 'review'))
  assert.ok(!setup.state.calls.some((call) => call.method === 'check'))
})

test('changes to publishing or companion visibility require manual review', async () => {
  for (const [path, content] of [
    ['.github/workflows/publish.yml', 'upstream publishing workflow'],
    ['packages/otel/package.json', '{"private":false}'],
  ]) {
    const setup = fixture()
    setup.state.contents[`merge-sha:${path}`] = content
    assert.equal(await prepareSync(setup), null)
    assert.ok(setup.state.pr.labels.some((label) => label.name === 'fork-identity'))
  }
})

test('missing or invalid fork metadata requests review rather than merging', async () => {
  for (const error of [
    Object.assign(new Error('Not Found'), { status: 404 }),
    new SyntaxError('Invalid package metadata'),
  ]) {
    const setup = fixture()
    setup.github.rest.repos.getContent = async () => {
      throw error
    }
    assert.equal(await prepareSync(setup), null)
    assert.ok(setup.state.calls.some((call) => call.method === 'review'))
    assert.ok(!setup.state.calls.some((call) => call.method === 'check'))
  }
})

test('failed, cancelled, skipped or missing CI results never authorize a merge', async () => {
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    const setup = fixture()
    const plan = await prepareSync(setup)
    const results = Object.fromEntries(checkNames.map((name) => [name, 'success']))
    results.tests = result
    assert.equal(await reportChecks({ ...setup, checks: plan.checks, results }), false)
    assert.equal(await mergeSync({ ...setup, plan }), false)
    assert.ok(!setup.state.calls.some((call) => call.method === 'merge'))
  }
})

test('a successful validation merges with an explicit head SHA and merge commit', async () => {
  const setup = fixture()
  const plan = await prepareSync(setup)
  const results = Object.fromEntries(checkNames.map((name) => [name, 'success']))
  assert.equal(await reportChecks({ ...setup, checks: plan.checks, results }), true)
  assert.equal(await mergeSync({ ...setup, plan }), true)
  const merge = setup.state.calls.find((call) => call.method === 'merge')
  assert.equal(merge.sha, plan.head)
  assert.equal(merge.merge_method, 'merge')
})

test('head, base or merge commit changes during CI prevent merging', async () => {
  for (const change of [
    (pr) => {
      pr.head.sha = 'new-head'
    },
    (pr) => {
      pr.base.sha = 'new-base'
    },
    (pr) => {
      pr.merge_commit_sha = 'new-merge'
    },
  ]) {
    const setup = fixture()
    const plan = await prepareSync(setup)
    const results = Object.fromEntries(checkNames.map((name) => [name, 'success']))
    await reportChecks({ ...setup, checks: plan.checks, results })
    change(setup.state.pr)
    assert.equal(await mergeSync({ ...setup, plan }), false)
    assert.ok(!setup.state.calls.some((call) => call.method === 'merge'))
  }
})

test('pending checks and results from a different commit or app prevent merging', async () => {
  for (const change of [
    (check) => {
      check.status = 'in_progress'
    },
    (check) => {
      check.head_sha = 'another-commit'
    },
    (check) => {
      check.app.slug = 'another-app'
    },
  ]) {
    const setup = fixture()
    const plan = await prepareSync(setup)
    const results = Object.fromEntries(checkNames.map((name) => [name, 'success']))
    await reportChecks({ ...setup, checks: plan.checks, results })
    change(setup.state.checks[plan.checks.tests])
    assert.equal(await mergeSync({ ...setup, plan }), false)
    assert.ok(!setup.state.calls.some((call) => call.method === 'merge'))
  }
})
