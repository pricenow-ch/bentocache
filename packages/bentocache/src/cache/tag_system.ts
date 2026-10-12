import type { CacheStack } from './cache_stack.js'
import type { CacheEntry } from './cache_entry/cache_entry.js'
import type { GetSetFactoryContext } from '../types/helpers.js'
import type { EntryTagState } from '../types/internals/index.js'
import type { GetSetHandler } from './get_set/get_set_handler.js'
import {
  createCacheEntryOptions,
  type CacheEntryOptions,
} from './cache_entry/cache_entry_options.js'

export class TagSystem {
  #getSetHandler!: GetSetHandler

  /**
   * Prefix of the keys storing the last `expireByTag` timestamp of a tag
   */
  #kExpirePrefix = '___bc:t:'

  /**
   * Prefix of the keys storing the last `deleteByTag` timestamp of a tag
   */
  #kDeletePrefix = '___bc:td:'

  #getSetTagOptions = createCacheEntryOptions({
    ttl: '10d',
    grace: '10d',
  })

  constructor(private stack: CacheStack) {}

  setGetSetHandler(handler: GetSetHandler) {
    this.#getSetHandler = handler
  }

  /**
   * Get the cache key storing the expiration timestamp of a tag
   */
  getTagCacheKey(tag: string) {
    return this.#kExpirePrefix + tag
  }

  /**
   * Get the cache key storing the deletion timestamp of a tag
   */
  getTagDeletionCacheKey(tag: string) {
    return this.#kDeletePrefix + tag
  }

  /**
   * Check if a key is a tag key
   */
  isTagKey(key: string) {
    return key.startsWith(this.#kExpirePrefix) || key.startsWith(this.#kDeletePrefix)
  }

  /**
   * The GetSet factory when getting a tag from the cache.
   */
  #getTagFactory(ctx: GetSetFactoryContext) {
    const result = ctx.gracedEntry?.value ?? 0
    if (result === 0) ctx.setOptions({ skipBusNotify: true, skipL2Write: true })

    return result
  }

  /**
   * Returns the most recent timestamp stored for the given tag keys
   */
  async #getLatestTimestamp(keys: string[]) {
    const timestamps = await Promise.all(
      keys.map((key) =>
        this.#getSetHandler.handle(key, this.#getTagFactory, this.#getSetTagOptions.cloneWith({})),
      ),
    )

    return Math.max(0, ...timestamps.filter((timestamp) => typeof timestamp === 'number'))
  }

  /**
   * Resolve the state of an entry against its tags :
   * - `deleted` if it was created before a `deleteByTag` of one of its tags
   * - `expired` if it was created before an `expireByTag` of one of its tags
   * - `valid` otherwise
   *
   * Deletion takes precedence over expiration, whatever the order of the operations.
   */
  async getEntryTagState(entry: CacheEntry): Promise<EntryTagState> {
    if (this.isTagKey(entry.getKey())) return 'valid'

    const tags = entry.getTags()
    if (!tags.length) return 'valid'

    const [deletedAt, expiredAt] = await Promise.all([
      this.#getLatestTimestamp(tags.map((tag) => this.getTagDeletionCacheKey(tag))),
      this.#getLatestTimestamp(tags.map((tag) => this.getTagCacheKey(tag))),
    ])

    const createdAt = entry.getCreatedAt()
    if (createdAt <= deletedAt) return 'deleted'
    if (createdAt <= expiredAt) return 'expired'

    return 'valid'
  }

  /**
   * Write the current timestamp in the given tag keys
   */
  async #writeTagTimestamps(keys: string[], options?: CacheEntryOptions) {
    const now = Date.now()
    const writeOptions = this.#getSetTagOptions.cloneWith({
      suppressL2Errors: options?.suppressL2Errors,
    })

    for (const key of new Set(keys)) {
      await this.stack.set(key, now, writeOptions)
    }

    return true
  }

  /**
   * Create invalidation keys for a list of tags
   *
   * We write a `___bc:t:<tag>` key with the current timestamp as value.
   * When we check if a key is invalidated by a tag, we check if the key
   * was created before the tag key value.
   */
  async createTagInvalidations(tags: string[], options?: CacheEntryOptions) {
    return this.#writeTagTimestamps(
      tags.map((tag) => this.getTagCacheKey(tag)),
      options,
    )
  }

  /**
   * Create deletion keys for a list of tags
   *
   * Same as `createTagInvalidations`, but with a `___bc:td:<tag>` key. Entries
   * created before this timestamp are deleted lazily, the next time they are read.
   */
  async createTagDeletions(tags: string[], options?: CacheEntryOptions) {
    return this.#writeTagTimestamps(
      tags.map((tag) => this.getTagDeletionCacheKey(tag)),
      options,
    )
  }
}
