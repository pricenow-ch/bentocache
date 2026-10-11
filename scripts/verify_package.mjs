import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'

const tarball = resolve(process.argv[2] ?? 'dist/bentocache.tgz')
const expected = JSON.parse(
  await readFile(new URL('../packages/bentocache/package.json', import.meta.url), 'utf8'),
)
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'pricenow-bentocache-'))

try {
  const unpackedDirectory = join(temporaryDirectory, 'unpacked')
  await mkdir(unpackedDirectory)
  execFileSync('tar', ['-xzf', tarball, '-C', unpackedDirectory])
  const packageDirectory = join(unpackedDirectory, 'package')
  const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'))

  assert.equal(manifest.name, '@pricenow/bentocache')
  assert.equal(manifest.version, expected.version)
  assert.equal(manifest.publishConfig.access, 'restricted')
  assert.equal(manifest.publishConfig.registry, 'https://registry.npmjs.org/')
  assert.notEqual(manifest.private, true)
  assert.equal(manifest.repository.url, 'git+https://github.com/pricenow-ch/bentocache.git')
  assert.equal(
    await readFile(join(packageDirectory, 'LICENSE.md'), 'utf8'),
    await readFile(new URL('../LICENSE.md', import.meta.url), 'utf8'),
  )

  for (const target of Object.values(manifest.exports)) {
    if (target.includes('*')) continue
    await readFile(join(packageDirectory, target))
    await readFile(join(packageDirectory, target.replace(/\.js$/, '.d.ts')))
  }

  const consumerDirectory = join(temporaryDirectory, 'consumer')
  await mkdir(consumerDirectory)
  await writeFile(
    join(consumerDirectory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  )
  execFileSync(
    'npm',
    [
      'install',
      tarball,
      '--ignore-scripts',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
      '--registry=https://registry.npmjs.org/',
      '--cache',
      join(temporaryDirectory, 'npm-cache'),
    ],
    { cwd: consumerDirectory, stdio: 'inherit' },
  )

  await writeFile(
    join(consumerDirectory, 'smoke.mjs'),
    `
import assert from 'node:assert/strict'
import { BentoCache, bentostore } from '@pricenow/bentocache'
import { memoryDriver } from '@pricenow/bentocache/drivers/memory'

const cache = new BentoCache({
  default: 'memory',
  stores: { memory: bentostore().useL1Layer(memoryDriver({})) },
})
try {
  await cache.set({ key: 'release-check', value: { published: true } })
  assert.deepEqual(await cache.get({ key: 'release-check' }), { published: true })
  assert.equal(await cache.getOrSet({ key: 'factory-check', factory: () => 42 }), 42)
} finally {
  await cache.disconnectAll()
}
`,
  )
  execFileSync(process.execPath, ['smoke.mjs'], { cwd: consumerDirectory, stdio: 'inherit' })
  console.log(
    `Verified ${manifest.name}@${manifest.version}: metadata, license, exports, and installed cache operations`,
  )
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
