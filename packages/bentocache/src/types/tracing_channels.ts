/**
 * Message emitted by the cache operation tracing channel.
 *
 * @experimental This API is experimental and may change in future versions.
 */
export interface CacheOperationMessage {
  /**
   * Operation type
   */
  operation:
    | 'get'
    | 'set'
    | 'getOrSet'
    | 'factory'
    | 'delete'
    | 'deleteMany'
    | 'clear'
    | 'expire'
    | 'expireByTag'
    | 'deleteByTag'

  /**
   * Cache key with full prefix (e.g., 'users:123' for namespaced keys)
   */
  key?: string

  /**
   * Multiple keys for deleteMany (with full prefix)
   */
  keys?: string[]

  /**
   * Tags for expireByTag and deleteByTag
   */
  tags?: string[]

  /**
   * Store name
   */
  store: string

  /**
   * Hit or miss (only for 'get')
   */
  hit?: boolean

  /**
   * Which tier served the value: l1, l2 (only for 'get' hits)
   */
  tier?: 'l1' | 'l2'

  /**
   * Value came from grace period (only for 'get')
   */
  graced?: boolean
}
