import { test } from '@japa/runner'
import { sleep } from '@julr/utils/misc'

import type { L2CacheDriver } from '../src/types/main.js'
import { BaseDriver } from '../src/drivers/base_driver.js'
import { CacheFactory } from '../factories/cache_factory.js'
import { createCacheEntryOptions } from '../src/cache/cache_entry/cache_entry_options.js'

/**
 * In-memory L2 driver honoring TTLs against a clock that tests can move forward
 */
class ClockedL2Driver extends BaseDriver implements L2CacheDriver {
  type = 'l2' as const
  now = Date.now()
  #items = new Map<string, { value: string; expiresAt?: number }>()

  constructor() {
    super({})
  }

  advance(ms: number) {
    this.now += ms
  }

  namespace() {
    return this as any
  }

  async get(key: string) {
    const item = this.#items.get(key)
    if (!item) return
    if (item.expiresAt !== undefined && item.expiresAt <= this.now) {
      this.#items.delete(key)
      return
    }

    return item.value
  }

  async pull(key: string) {
    const value = await this.get(key)
    this.#items.delete(key)
    return value
  }

  async set(key: string, value: string, ttl?: number) {
    this.#items.set(key, { value, expiresAt: ttl ? this.now + ttl : undefined })
    return true
  }

  async clear() {
    this.#items.clear()
  }

  async delete(key: string) {
    return this.#items.delete(key)
  }

  async deleteMany(keys: string[]) {
    for (const key of keys) this.#items.delete(key)
    return true
  }

  async disconnect() {}
}

/**
 * Returns a promise to resolve manually, and a promise resolved once it is awaited
 */
function createGate() {
  let open!: () => void
  let reached!: () => void
  const opened = new Promise<void>((resolve) => (open = resolve))
  const wasReached = new Promise<void>((resolve) => (reached = resolve))

  return {
    open,
    wasReached,
    wait: () => {
      reached()
      return opened
    },
  }
}

test.group('Tagging | Internals', () => {
  test('expireByTag should store invalidated tags with timestamps', async ({ assert }) => {
    const { cache } = new CacheFactory().withL1L2Config().create()
    await cache.expireByTag({ tags: ['tag1', 'tag2'] })
    const r1 = await cache.get({ key: '___bc:t:tag1' })
    const r2 = await cache.get({ key: '___bc:t:tag1' })

    assert.isNotNull(r1)
    assert.isNotNull(r2)
  })

  test('set should store value with tags', async ({ assert }) => {
    const { cache, local, remote } = new CacheFactory().withL1L2Config().create()

    await cache.set({ key: 'key1', value: 'value1', tags: ['tag1', 'tag2'] })

    const r1 = local.get('key1', createCacheEntryOptions())
    const r2 = await remote.get('key1', createCacheEntryOptions())

    assert.deepEqual(r1?.entry.getTags(), ['tag1', 'tag2'])
    assert.deepEqual(r2?.entry.getTags(), ['tag1', 'tag2'])
  })
})

test.group('Tagging | expireByTag', () => {
  test('basic', async ({ assert }) => {
    const { cache } = new CacheFactory().withL1L2Config().create()

    await cache.set({ key: 'key1', value: 'value1', tags: ['tag1'] })
    await cache.expireByTag({ tags: ['tag1'] })

    const r1 = await cache.get({ key: 'key1' })
    assert.deepEqual(r1, undefined)
  })

  test('can remove by tag', async ({ assert }) => {
    const { cache } = new CacheFactory().withL1L2Config().create()

    await cache.set({ key: 'foo', value: 1, tags: ['x', 'y'] })
    await cache.set({ key: 'bar', value: 2, tags: ['y', 'z'] })
    await cache.getOrSet({ key: 'baz', factory: () => 3, tags: ['x', 'z'] })

    const r1 = await cache.getOrSet({ key: 'foo', factory: () => 11, tags: ['x', 'y'] })
    const r2 = await cache.getOrSet({ key: 'bar', factory: () => 22, tags: ['y', 'z'] })
    const r3 = await cache.getOrSet({
      key: 'baz',
      factory: (ctx) => {
        ctx.setTags(['x', 'z'])
        return 33
      },
    })

    assert.deepEqual(r1, 1)
    assert.deepEqual(r2, 2)
    assert.deepEqual(r3, 3)

    await cache.expireByTag({ tags: ['x'] })

    const r4 = await cache.get({ key: 'foo' })
    const r5 = await cache.getOrSet({ key: 'bar', factory: () => 222, tags: ['y', 'z'] })
    const r6 = await cache.getOrSet({ key: 'baz', factory: () => 333, tags: ['x', 'z'] })

    assert.isUndefined(r4)
    assert.deepEqual(r5, 2)
    assert.deepEqual(r6, 333)

    await cache.expireByTag({ tags: ['y'] })

    const r7 = await cache.getOrSet({ key: 'foo', factory: () => 1111, tags: ['x', 'y'] })
    const r8 = await cache.getOrSet({ key: 'bar', factory: () => 2222, tags: ['y', 'z'] })
    const r9 = await cache.getOrSet({ key: 'baz', factory: () => 3333, tags: ['x', 'z'] })

    assert.deepEqual(r7, 1111)
    assert.deepEqual(r8, 2222)
    assert.deepEqual(r9, 333)
  })

  test('can remove multiple tags', async ({ assert }) => {
    const { cache } = new CacheFactory().withL1L2Config().create()

    await cache.set({ key: 'foo', value: 1, tags: ['x', 'y'] })
    await cache.set({ key: 'bar', value: 2, tags: ['y'] })
    await cache.getOrSet({ key: 'baz', factory: () => 3, tags: ['z'] })

    const foo1 = await cache.get({ key: 'foo' })
    const bar1 = await cache.get({ key: 'bar' })
    const baz1 = await cache.get({ key: 'baz' })

    assert.deepEqual(foo1, 1)
    assert.deepEqual(bar1, 2)
    assert.deepEqual(baz1, 3)

    await cache.expireByTag({ tags: ['x', 'z'] })

    const foo2 = await cache.get({ key: 'foo' })
    const bar2 = await cache.get({ key: 'bar' })
    const baz2 = await cache.get({ key: 'baz' })

    assert.isUndefined(foo2)
    assert.deepEqual(bar2, 2)
    assert.isUndefined(baz2)

    await cache.expireByTag({ tags: [] })

    const foo4 = await cache.get({ key: 'foo' })
    const bar4 = await cache.get({ key: 'bar' })
    const baz4 = await cache.get({ key: 'baz' })

    assert.isUndefined(foo4)
    assert.deepEqual(bar4, 2)
    assert.isUndefined(baz4)

    await cache.expireByTag({ tags: ['y', 'non-existing'] })

    const foo5 = await cache.get({ key: 'foo' })
    const bar5 = await cache.get({ key: 'bar' })
    const baz5 = await cache.get({ key: 'baz' })

    assert.isUndefined(foo5)
    assert.isUndefined(bar5)
    assert.isUndefined(baz5)
  })

  test('remove by tags with bus', async ({ assert }) => {
    const [cache1] = new CacheFactory().withL1L2Config().create()
    const [cache2] = new CacheFactory().withL1L2Config().create()
    const [cache3] = new CacheFactory().withL1L2Config().create()

    await cache1.set({ key: 'foo', value: 1, tags: ['x', 'y'] })
    await cache2.set({ key: 'bar', value: 2, tags: ['y', 'z'] })
    await cache3.getOrSet({ key: 'baz', factory: () => 3, tags: ['x', 'z'] })

    const foo1 = await cache1.getOrSet({ key: 'foo', factory: () => 11, tags: ['x', 'y'] })
    const bar1 = await cache2.getOrSet({ key: 'bar', factory: () => 22, tags: ['y', 'z'] })
    const baz1 = await cache3.getOrSet({ key: 'baz', factory: () => 33, tags: ['x', 'z'] })

    assert.deepEqual(foo1, 1)
    assert.deepEqual(bar1, 2)
    assert.deepEqual(baz1, 3)

    await cache1.expireByTag({ tags: ['x'] })

    const foo2 = await cache1.get({ key: 'foo' })
    const bar2 = await cache2.getOrSet({ key: 'bar', factory: () => 222, tags: ['y', 'z'] })
    const baz2 = await cache3.getOrSet({ key: 'baz', factory: () => 333, tags: ['x', 'z'] })

    assert.isUndefined(foo2)
    assert.deepEqual(bar2, 2)
    assert.deepEqual(baz2, 333)

    await cache2.expireByTag({ tags: ['y'] })

    const foo3 = await cache1.getOrSet({ key: 'foo', factory: () => 1111, tags: ['x', 'y'] })
    const bar3 = await cache2.getOrSet({ key: 'bar', factory: () => 2222, tags: ['y', 'z'] })
    const baz3 = await cache3.getOrSet({ key: 'baz', factory: () => 3333, tags: ['x', 'z'] })

    assert.deepEqual(foo3, 1111)
    assert.deepEqual(bar3, 2222)
    assert.deepEqual(baz3, 333)
  })

  test('remove multiple tags with bus', async ({ assert }) => {
    const [cache1] = new CacheFactory().withL1L2Config().create()
    const [cache2] = new CacheFactory().withL1L2Config().create()
    const [cache3] = new CacheFactory().withL1L2Config().create()

    await cache1.set({ key: 'foo', value: 1, tags: ['x', 'y'] })
    await cache2.set({ key: 'bar', value: 2, tags: ['y'] })
    await cache3.getOrSet({ key: 'baz', factory: () => 3, tags: ['z'] })

    const cache1foo1 = await cache1.get({ key: 'foo' })
    const cache1bar1 = await cache1.get({ key: 'bar' })
    const cache1baz1 = await cache1.get({ key: 'baz' })

    assert.deepEqual(cache1foo1, 1)
    assert.deepEqual(cache1bar1, 2)
    assert.deepEqual(cache1baz1, 3)

    const cache2foo1 = await cache2.get({ key: 'foo' })
    const cache2bar1 = await cache2.get({ key: 'bar' })
    const cache2baz1 = await cache2.get({ key: 'baz' })

    assert.deepEqual(cache2foo1, 1)
    assert.deepEqual(cache2bar1, 2)
    assert.deepEqual(cache2baz1, 3)

    const cache3foo1 = await cache3.get({ key: 'foo' })
    const cache3bar1 = await cache3.get({ key: 'bar' })
    const cache3baz1 = await cache3.get({ key: 'baz' })

    assert.deepEqual(cache3foo1, 1)
    assert.deepEqual(cache3bar1, 2)
    assert.deepEqual(cache3baz1, 3)

    await cache1.expireByTag({ tags: ['x', 'z'] })

    const cache2foo2 = await cache2.get({ key: 'foo' })
    const cache2bar2 = await cache2.get({ key: 'bar' })
    const cache2baz2 = await cache2.get({ key: 'baz' })

    assert.isUndefined(cache2foo2)
    assert.deepEqual(cache2bar2, 2)
    assert.isUndefined(cache2baz2)

    const cache3foo2 = await cache3.get({ key: 'foo' })
    const cache3bar2 = await cache3.get({ key: 'bar' })
    const cache3baz2 = await cache3.get({ key: 'baz' })

    assert.isUndefined(cache3foo2)
    assert.deepEqual(cache3bar2, 2)
    assert.isUndefined(cache3baz2)

    await cache3.expireByTag({ tags: ['y', 'non-existing'] })

    const cache1foo3 = await cache1.get({ key: 'foo' })
    const cache1bar3 = await cache1.get({ key: 'bar' })
    const cache1baz3 = await cache1.get({ key: 'baz' })

    assert.isUndefined(cache1foo3)
    assert.isUndefined(cache1bar3)
    assert.isUndefined(cache1baz3)

    const cache2foo3 = await cache2.get({ key: 'foo' })
    const cache2bar3 = await cache2.get({ key: 'bar' })
    const cache2baz3 = await cache2.get({ key: 'baz' })

    assert.isUndefined(cache2foo3)
    assert.isUndefined(cache2bar3)
    assert.isUndefined(cache2baz3)

    const cache3foo3 = await cache3.get({ key: 'foo' })
    const cache3bar3 = await cache3.get({ key: 'bar' })
    const cache3baz3 = await cache3.get({ key: 'baz' })

    assert.isUndefined(cache3foo3)
    assert.isUndefined(cache3bar3)
    assert.isUndefined(cache3baz3)
  })

  test('tags and namespaces', async ({ assert }) => {
    const [cache1] = new CacheFactory().withL1L2Config().create()

    const users = cache1.namespace('users')
    const posts = cache1.namespace('posts')

    await users.set({ key: 'foo', value: 1, tags: ['x'] })
    await cache1.set({ key: 'bar', value: 2, tags: ['x'] })
    await posts.set({ key: 'baz', value: 3, tags: ['x'] })

    await posts.expireByTag({ tags: ['x'] })

    const userFoo1 = await users.get({ key: 'foo' })
    const postFoo1 = await posts.get({ key: 'baz' })
    const cacheFoo1 = await cache1.get({ key: 'bar' })

    assert.deepEqual(userFoo1, 1)
    assert.isUndefined(postFoo1)
    assert.deepEqual(cacheFoo1, 2)

    await cache1.expireByTag({ tags: ['x'] })

    const usersFoo2 = await users.get({ key: 'foo' })
    const postsFoo2 = await posts.get({ key: 'baz' })
    const cacheFoo2 = await cache1.get({ key: 'bar' })

    assert.deepEqual(usersFoo2, 1)
    assert.isUndefined(postsFoo2)
    assert.isUndefined(cacheFoo2)

    await users.expireByTag({ tags: ['x'] })

    const usersFoo3 = await users.get({ key: 'foo' })
    const postsFoo3 = await posts.get({ key: 'baz' })
    const cacheFoo3 = await cache1.get({ key: 'bar' })

    assert.isUndefined(usersFoo3)
    assert.isUndefined(postsFoo3)
    assert.isUndefined(cacheFoo3)
  })

  test('key created after tag invalidation should not be invalidated', async ({ assert }) => {
    const [cache] = new CacheFactory().withMemoryL1().create()

    await cache.set({ key: 'foo', value: 1, tags: ['x'] })
    await cache.expireByTag({ tags: ['x', 'foo'] })
    await sleep(10)
    await cache.set({ key: 'bar', value: 2, tags: ['x'] })

    const r1 = await cache.get({ key: 'foo' })
    const r2 = await cache.get({ key: 'bar' })

    assert.isUndefined(r1)
    assert.deepEqual(r2, 2)
  })

  test('has shouldnt return true for invalidated tags', async ({ assert }) => {
    const { cache } = new CacheFactory().withL1L2Config().create()

    await cache.set({ key: 'foo', value: 1, tags: ['x'] })

    const r1 = await cache.has({ key: 'foo' })
    await cache.expireByTag({ tags: ['x'] })
    const r2 = await cache.has({ key: 'foo' })

    assert.isTrue(r1)
    assert.isFalse(r2)
  })
})

test.group('Tagging | deleteByTag', () => {
  test('basic deleteByTag should mark entries for deletion', async ({ assert }) => {
    const { cache } = new CacheFactory().withL1L2Config().create()

    await cache.set({ key: 'key1', value: 'value1', tags: ['tag1'] })
    await cache.deleteByTag({ tags: ['tag1'] })

    const r1 = await cache.get({ key: 'key1' })
    assert.deepEqual(r1, undefined)
  })

  test('deleteByTag should store deletion timestamps', async ({ assert }) => {
    const now = Date.now()

    await sleep(10)

    const { cache } = new CacheFactory().withL1L2Config().create()
    await cache.deleteByTag({ tags: ['tag1', 'tag2'] })

    const r1 = await cache.get({ key: '___bc:td:tag1' })
    const r2 = await cache.get({ key: '___bc:td:tag2' })
    const expireMarker = await cache.get({ key: '___bc:t:tag1' })

    assert.isAbove(r1, now)
    assert.isAbove(r2, now)
    assert.isUndefined(expireMarker)
  })

  test('deleteByTag should delete entries with matching tags', async ({ assert }) => {
    const { cache } = new CacheFactory().withL1L2Config().create()

    await cache.set({ key: 'foo', value: 1, tags: ['x', 'y'] })
    await cache.set({ key: 'bar', value: 2, tags: ['y', 'z'] })
    await cache.set({ key: 'baz', value: 3, tags: ['z'] })

    await cache.deleteByTag({ tags: ['x'] })

    const r1 = await cache.get({ key: 'foo' })
    const r2 = await cache.get({ key: 'bar' })
    const r3 = await cache.get({ key: 'baz' })

    assert.isUndefined(r1) // has tag 'x', should be deleted
    assert.deepEqual(r2, 2) // doesn't have tag 'x', should remain
    assert.deepEqual(r3, 3) // doesn't have tag 'x', should remain
  })

  test('deleteByTag should delete entries with multiple matching tags', async ({ assert }) => {
    const { cache } = new CacheFactory().withL1L2Config().create()

    await cache.set({ key: 'foo', value: 1, tags: ['x', 'y'] })
    await cache.set({ key: 'bar', value: 2, tags: ['y'] })
    await cache.set({ key: 'baz', value: 3, tags: ['z'] })

    await cache.deleteByTag({ tags: ['x', 'z'] })

    const r1 = await cache.get({ key: 'foo' })
    const r2 = await cache.get({ key: 'bar' })
    const r3 = await cache.get({ key: 'baz' })

    assert.isUndefined(r1) // has tag 'x', should be deleted
    assert.deepEqual(r2, 2) // doesn't have tags 'x' or 'z', should remain
    assert.isUndefined(r3) // has tag 'z', should be deleted
  })

  test('deleteByTag should work with getOrSet', async ({ assert }) => {
    const { cache } = new CacheFactory().withL1L2Config().create()

    await cache.set({ key: 'foo', value: 1, tags: ['x'] })
    await cache.deleteByTag({ tags: ['x'] })

    const r1 = await cache.getOrSet({
      key: 'foo',
      factory: () => 'new-value',
      tags: ['x'],
    })

    assert.deepEqual(r1, 'new-value')
  })

  test('deleteByTag should work with has method', async ({ assert }) => {
    const { cache } = new CacheFactory().withL1L2Config().create()

    await cache.set({ key: 'foo', value: 1, tags: ['x'] })

    const r1 = await cache.has({ key: 'foo' })
    await cache.deleteByTag({ tags: ['x'] })
    const r2 = await cache.has({ key: 'foo' })

    assert.isTrue(r1)
    assert.isFalse(r2)
  })

  test('entries created after deleteByTag should not be deleted', async ({ assert }) => {
    const { cache } = new CacheFactory().withMemoryL1().create()

    await cache.set({ key: 'foo', value: 1, tags: ['x'] })
    await cache.deleteByTag({ tags: ['x'] })
    await sleep(10)
    await cache.set({ key: 'bar', value: 2, tags: ['x'] })

    const r1 = await cache.get({ key: 'foo' })
    const r2 = await cache.get({ key: 'bar' })

    assert.isUndefined(r1)
    assert.deepEqual(r2, 2)
  })

  test('deleteByTag should work with bus notifications', async ({ assert }) => {
    const [cache1] = new CacheFactory().withL1L2Config().create()
    const [cache2] = new CacheFactory().withL1L2Config().create()
    const [cache3] = new CacheFactory().withL1L2Config().create()

    await cache1.set({ key: 'foo', value: 1, tags: ['x', 'y'] })
    await cache2.set({ key: 'bar', value: 2, tags: ['y', 'z'] })
    await cache3.set({ key: 'baz', value: 3, tags: ['x', 'z'] })

    // Delete from cache1 should affect all caches
    await cache1.deleteByTag({ tags: ['x'] })

    const r1 = await cache1.get({ key: 'foo' })
    const r2 = await cache2.get({ key: 'bar' })
    const r3 = await cache3.get({ key: 'baz' })

    assert.isUndefined(r1) // cache1: 'foo' has tag 'x', should be deleted
    assert.deepEqual(r2, 2) // cache2: 'bar' doesn't have tag 'x', should remain
    assert.isUndefined(r3) // cache3: 'baz' has tag 'x', should be deleted
  })

  test('deleteByTag should work with namespaces', async ({ assert }) => {
    const [cache1] = new CacheFactory().withL1L2Config().create()

    const users = cache1.namespace('users')
    const posts = cache1.namespace('posts')

    await users.set({ key: 'foo', value: 1, tags: ['x'] })
    await cache1.set({ key: 'bar', value: 2, tags: ['x'] })
    await posts.set({ key: 'baz', value: 3, tags: ['x'] })

    // Delete from posts namespace should only affect posts
    await posts.deleteByTag({ tags: ['x'] })

    const userFoo = await users.get({ key: 'foo' })
    const cacheFoo = await cache1.get({ key: 'bar' })
    const postFoo = await posts.get({ key: 'baz' })

    assert.deepEqual(userFoo, 1) // users namespace unaffected
    assert.deepEqual(cacheFoo, 2) // main cache unaffected
    assert.isUndefined(postFoo) // posts namespace affected
  })

  test('deleteByTag should handle empty tags array', async ({ assert }) => {
    const { cache } = new CacheFactory().withL1L2Config().create()

    await cache.set({ key: 'foo', value: 1, tags: ['x'] })

    const result = await cache.deleteByTag({ tags: [] })
    const r1 = await cache.get({ key: 'foo' })

    assert.isTrue(result)
    assert.deepEqual(r1, 1) // should remain unaffected
  })

  test('deleteByTag should handle non-existing tags', async ({ assert }) => {
    const { cache } = new CacheFactory().withL1L2Config().create()

    await cache.set({ key: 'foo', value: 1, tags: ['x'] })

    const result = await cache.deleteByTag({ tags: ['non-existing'] })
    const r1 = await cache.get({ key: 'foo' })

    assert.isTrue(result)
    assert.deepEqual(r1, 1) // should remain unaffected
  })

  test('reading a deleted entry frees the local cache only', async ({ assert }) => {
    const { cache, local, remote, stack } = new CacheFactory().withL1L2Config().create()

    await cache.set({ key: 'foo', value: 1, tags: ['x'] })
    await cache.deleteByTag({ tags: ['x'] })

    const r1 = await cache.get({ key: 'foo' })
    const inL1 = local.get('foo', stack.defaultOptions)
    const inL2 = await remote.get('foo', stack.defaultOptions)
    const r2 = await cache.get({ key: 'foo' })

    assert.isUndefined(r1)
    assert.isUndefined(inL1)
    assert.equal(inL2?.entry.getValue(), 1)
    assert.isUndefined(r2)
  })

  test('should not return a deleted entry as a graced value with get', async ({ assert }) => {
    const { cache } = new CacheFactory().withL1L2Config().merge({ grace: '6h' }).create()

    await cache.set({ key: 'foo', value: 1, tags: ['x'] })
    await cache.deleteByTag({ tags: ['x'] })

    const r1 = await cache.get({ key: 'foo' })

    assert.isUndefined(r1)
  })

  test('should not return a deleted entry as a graced value when the factory fails', async ({
    assert,
  }) => {
    const { cache } = new CacheFactory().withL1L2Config().merge({ grace: '6h' }).create()

    await cache.set({ key: 'foo', value: 1, tags: ['x'] })
    await cache.deleteByTag({ tags: ['x'] })

    let gracedEntry: unknown = 'not called'
    const r1 = cache.getOrSet({
      key: 'foo',
      tags: ['x'],
      factory: (ctx) => {
        gracedEntry = ctx.gracedEntry
        throw new Error('factory error')
      },
    })

    await assert.rejects(() => r1, 'Factory has thrown an error')
    assert.isUndefined(gracedEntry)
  })

  test('should not return a deleted entry as a graced value with a single tier', async ({
    assert,
  }) => {
    const { cache } = new CacheFactory().withRedisL2().merge({ grace: '6h' }).create()

    await cache.set({ key: 'foo', value: 1, tags: ['x'] })
    await cache.deleteByTag({ tags: ['x'] })

    const r1 = cache.getOrSet({
      key: 'foo',
      tags: ['x'],
      factory: () => {
        throw new Error('factory error')
      },
    })

    await assert.rejects(() => r1, 'Factory has thrown an error')
  })

  test('should not return a deleted entry that was already logically expired', async ({
    assert,
  }) => {
    const { cache } = new CacheFactory().withL1L2Config().merge({ ttl: 10, grace: '6h' }).create()

    await cache.set({ key: 'foo', value: 1, tags: ['x'] })
    await sleep(20)
    await cache.deleteByTag({ tags: ['x'] })

    const r1 = await cache.get({ key: 'foo' })

    assert.isUndefined(r1)
  })

  test('still returns an expired entry as a graced value', async ({ assert }) => {
    const { cache } = new CacheFactory().withL1L2Config().merge({ grace: '6h' }).create()

    await cache.set({ key: 'foo', value: 1, tags: ['x'] })
    await cache.expireByTag({ tags: ['x'] })

    const r1 = await cache.getOrSet({
      key: 'foo',
      tags: ['x'],
      factory: () => {
        throw new Error('factory error')
      },
    })

    assert.equal(r1, 1)
  })

  test('expireByTag after deleteByTag should not downgrade the deletion', async ({ assert }) => {
    const { cache } = new CacheFactory().withL1L2Config().merge({ grace: '6h' }).create()

    await cache.set({ key: 'foo', value: 1, tags: ['x'] })
    await cache.deleteByTag({ tags: ['x'] })
    await cache.expireByTag({ tags: ['x'] })

    const r1 = await cache.get({ key: 'foo' })

    assert.isUndefined(r1)
  })

  test('deletion takes precedence over expiration across tags', async ({ assert }) => {
    const { cache } = new CacheFactory().withL1L2Config().merge({ grace: '6h' }).create()

    await cache.set({ key: 'foo', value: 1, tags: ['x', 'y'] })
    await cache.deleteByTag({ tags: ['y'] })
    await cache.expireByTag({ tags: ['x'] })

    const r1 = await cache.get({ key: 'foo' })

    assert.isUndefined(r1)
  })

  test('should not emit events or bus messages when reading a deleted entry', async ({
    assert,
    cleanup,
  }) => {
    const { cache, stack } = new CacheFactory().withL1L2Config().create()

    await cache.set({ key: 'foo', value: 1, tags: ['x'] })
    await cache.deleteByTag({ tags: ['x'] })

    const events: string[] = []
    const onDeleted = () => events.push('cache:deleted')
    const onPublished = () => events.push('bus:message:published')
    stack.emitter.on('cache:deleted', onDeleted)
    stack.emitter.on('bus:message:published', onPublished)
    cleanup(() => {
      stack.emitter.off('cache:deleted', onDeleted)
      stack.emitter.off('bus:message:published', onPublished)
    })

    await cache.get({ key: 'foo' })
    await cache.get({ key: 'foo' })

    assert.deepEqual(events, [])
  })

  test('expire keys keep the 1.x format', async ({ assert }) => {
    const { cache, stack } = new CacheFactory().withL1L2Config().create()

    const legacyTimestamp = Date.now()
    await stack.set('___bc:t:legacy', legacyTimestamp, stack.defaultOptions)
    await sleep(10)
    await cache.set({ key: 'old', value: 1, tags: ['legacy'] })

    assert.equal(await cache.get({ key: 'old' }), 1)

    await cache.expireByTag({ tags: ['legacy'] })

    assert.isUndefined(await cache.get({ key: 'old' }))
    assert.isNumber(await cache.get({ key: '___bc:t:legacy' }))
  })

  test('a deleted entry stays deleted after the tag ttl', async ({ assert }) => {
    const driver = new ClockedL2Driver()
    const { cache } = new CacheFactory().merge({ l2Driver: driver }).create()

    await cache.setForever({ key: 'foo', value: 1, tags: ['x'] })
    await cache.deleteByTag({ tags: ['x'] })
    driver.advance(11 * 24 * 60 * 60 * 1000)

    const r1 = await cache.get({ key: 'foo' })

    assert.isUndefined(r1)
  })

  test('keeps an L2 replacement written while a deleted entry was checked', async ({ assert }) => {
    const { cache, local, remote, stack } = new CacheFactory().withL1L2Config().create()

    await cache.set({ key: 'foo', value: 'old', tags: ['x'] })
    await cache.deleteByTag({ tags: ['x'] })
    local.delete('foo')
    local.delete('___bc:td:x')

    const gate = createGate()
    const get = remote.get.bind(remote)
    remote.get = async (key, options) => {
      if (key === '___bc:td:x') await gate.wait()
      return get(key, options)
    }

    const r1 = cache.get({ key: 'foo' })
    await gate.wasReached
    await sleep(5)
    await cache.set({ key: 'foo', value: 'new', tags: ['y'] })
    gate.open()

    assert.isUndefined(await r1)
    const inL2 = await get('foo', stack.defaultOptions)
    assert.equal(inL2?.entry.getValue(), 'new')
    assert.equal(await cache.get({ key: 'foo' }), 'new')
  })

  test('keeps an L1 replacement written while a deleted entry was checked', async ({ assert }) => {
    const { cache, local, remote, stack } = new CacheFactory().withL1L2Config().create()

    await cache.set({ key: 'foo', value: 'old', tags: ['x'] })
    await cache.deleteByTag({ tags: ['x'] })
    local.delete('___bc:td:x')

    const gate = createGate()
    const get = remote.get.bind(remote)
    remote.get = async (key, options) => {
      if (key === '___bc:td:x') await gate.wait()
      return get(key, options)
    }

    // `has` does not refill L1 from L2, unlike `get`
    const r1 = cache.has({ key: 'foo' })
    await gate.wasReached
    await sleep(5)
    await cache.set({ key: 'foo', value: 'new', tags: ['y'] })
    gate.open()

    assert.isTrue(await r1)
    assert.equal(local.get('foo', stack.defaultOptions)?.entry.getValue(), 'new')
  })
})

test.group('Tagging | locks', () => {
  test('two tier getOrSet releases the lock when the remote read fails', async ({ assert }) => {
    const { cache, remote } = new CacheFactory().withL1L2Config().create()

    const get = remote.get.bind(remote)
    let failures = 1
    remote.get = async (key, options) => {
      if (key === 'foo' && failures-- > 0) throw new Error('l2 down')
      return get(key, options)
    }

    const r1 = cache.getOrSet({ key: 'foo', suppressL2Errors: false, factory: () => 1 })
    await assert.rejects(() => r1)

    const r2 = await cache.getOrSet({ key: 'foo', factory: () => 2, timeout: 0 })
    assert.equal(r2, 2)
  }).timeout(2000)

  test('single tier getOrSet releases the lock when the remote read fails', async ({ assert }) => {
    const { cache, remote } = new CacheFactory().withRedisL2().create()

    const get = remote.get.bind(remote)
    let calls = 0
    remote.get = async (key, options) => {
      if (key === 'foo' && ++calls === 2) throw new Error('l2 down')
      return get(key, options)
    }

    const r1 = cache.getOrSet({ key: 'foo', suppressL2Errors: false, factory: () => 1 })
    await assert.rejects(() => r1)

    const r2 = await cache.getOrSet({ key: 'foo', factory: () => 2 })
    assert.equal(r2, 2)
  }).timeout(2000)
})
