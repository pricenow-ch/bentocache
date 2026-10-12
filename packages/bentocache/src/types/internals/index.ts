import type { CacheEntry } from '../../cache/cache_entry/cache_entry.js'

export type GetCacheValueReturn = {
  entry: CacheEntry
  isGraced: boolean
}

/**
 * State of a cache entry regarding the tag operations
 */
export type EntryTagState = 'valid' | 'expired' | 'deleted'

/**
 * Result of the validation of an item read from a cache layer.
 *
 * `item` is unset when the item was deleted by a tag : it must not
 * be served, even as a graced value.
 */
export type EntryValidation =
  | { isValid: true; item: GetCacheValueReturn }
  | { isValid: false; item?: GetCacheValueReturn }
