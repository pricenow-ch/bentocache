import { is } from '@julr/utils/is'

import { Bus } from '../bus/bus.js'
import type { Logger } from '../logger.js'
import { TagSystem } from './tag_system.js'
import { UndefinedValueError } from '../errors.js'
import { LocalCache } from './facades/local_cache.js'
import { BaseDriver } from '../drivers/base_driver.js'
import { RemoteCache } from './facades/remote_cache.js'
import { cacheEvents } from '../events/cache_events.js'
import { cacheOperation } from '../tracing_channels.js'
import type { GetSetHandler } from './get_set/get_set_handler.js'
import type { BentoCacheOptions } from '../bento_cache_options.js'
import type { CacheOperationMessage } from '../types/tracing_channels.js'
import type { CacheEntryOptions } from './cache_entry/cache_entry_options.js'
import { createCacheEntryOptions } from './cache_entry/cache_entry_options.js'
import type { EntryValidation, GetCacheValueReturn } from '../types/internals/index.js'
import {
  type BusDriver,
  type BusOptions,
  type CacheEvent,
  type CacheStackDrivers,
  type CacheBusMessage,
  CacheBusMessageType,
} from '../types/main.js'

export class CacheStack extends BaseDriver {
  l1?: LocalCache
  l2?: RemoteCache
  bus?: Bus
  defaultOptions: ReturnType<typeof createCacheEntryOptions>
  logger: Logger
  #busDriver?: BusDriver
  #busOptions?: BusOptions
  #tagSystem: TagSystem
  #namespaceCache: Map<string, CacheStack> = new Map()
  #tagExpireOptions = createCacheEntryOptions({})

  constructor(
    public name: string,
    public options: BentoCacheOptions,
    drivers: CacheStackDrivers,
    bus?: Bus,
  ) {
    super(options)
    this.logger = options.logger.child({ cache: this.name })

    if (drivers.l1Driver)
      this.l1 = new LocalCache(
        drivers.l1Driver,
        this.logger,
        this.options.serializeL1 ? this.options.serializer : undefined,
      )
    if (drivers.l2Driver)
      this.l2 = new RemoteCache(drivers.l2Driver, this.logger, !!this.l1, this.options)

    this.bus = bus ? bus : this.#createBus(drivers.busDriver, drivers.busOptions)
    if (this.l1) this.bus?.manageCache(this.prefix, this.l1)

    this.#tagSystem = new TagSystem(this)
    this.defaultOptions = createCacheEntryOptions(this.options)
  }

  get emitter() {
    return this.options.emitter
  }

  #createBus(busDriver?: BusDriver, busOptions?: BusOptions) {
    if (!busDriver) return

    this.#busDriver = busDriver
    this.#busOptions = {
      retryQueue: { enabled: true, maxSize: undefined },
      ...busOptions,
    }

    return new Bus(
      this.name,
      this.#busDriver,
      this.logger,
      this.emitter,
      this.#busOptions,
      this.options.internalOperationWrapper,
    )
  }

  setTagSystemGetSetHandler(getSetHandler: GetSetHandler) {
    this.#tagSystem.setGetSetHandler(getSetHandler)
  }

  namespace(namespace: string): CacheStack {
    if (!this.#namespaceCache.has(namespace)) {
      this.#namespaceCache.set(
        namespace,
        new CacheStack(
          this.name,
          this.options.cloneWith({ prefix: this.createNamespacePrefix(namespace) }),
          {
            l1Driver: this.l1?.namespace(namespace),
            l2Driver: this.l2?.namespace(namespace),
          },
          this.bus,
        ),
      )
    }

    return <CacheStack>this.#namespaceCache.get(namespace)
  }

  /**
   * Publish a message to the bus channel
   *
   * @returns true if the message was published, false if not
   * and undefined if a bus is not part of the stack
   */
  async publish(
    message: CacheBusMessage,
    options?: CacheEntryOptions,
  ): Promise<boolean | undefined> {
    if (options?.skipBusNotify) return

    return this.bus?.publish({ ...message, namespace: this.prefix })
  }

  emit(event: CacheEvent) {
    return this.emitter.emit(event.name, event.data)
  }

  /**
   * Returns the full key with prefix applied
   */
  getFullKey(key: string) {
    return this.getItemKey(key)
  }

  /**
   * Returns the full keys with prefix applied
   */
  getFullKeys(keys: string[]) {
    return keys.map((key) => this.getItemKey(key))
  }

  /**
   * Write a value in the cache stack
   * - Set value in local cache
   * - Set value in remote cache
   * - Publish a message to the bus
   * - Emit a CacheWritten event
   */
  async set(key: string, value: any, options: CacheEntryOptions) {
    if (is.undefined(value)) throw new UndefinedValueError(key)

    const message: CacheOperationMessage = {
      operation: 'set',
      key: this.getFullKey(key),
      store: this.name,
    }

    return cacheOperation.tracePromise(async () => {
      const rawItem = {
        value,
        logicalExpiration: options.logicalTtlFromNow(),
        tags: options.tags,
        createdAt: Date.now(),
      }

      /**
       * Store raw or serialized value in the local cache based on the serializeL1 option
       */
      const l1Item = this.options.serializeL1 ? this.options.serializer.serialize(rawItem) : rawItem
      this.l1?.set(key, l1Item, options)

      /**
       * Store the serialized value in the remote cache
       */
      let l2Success = false
      if (this.l2 && options.skipL2Write !== true) {
        const l2Item = this.options.serializeL1
          ? l1Item
          : this.options.serializer.serialize(rawItem)
        l2Success = await this.l2?.set(key, l2Item as any, options)
      }

      /**
       * Publish only if the remote cache write was successful.
       */
      if ((this.l2 && l2Success) || !this.l2) {
        await this.publish({ type: CacheBusMessageType.Set, keys: [key] }, options)
      }

      this.emit(cacheEvents.written(key, value, this.name))
      return true
    }, message)
  }

  /**
   * Expire a key from the cache.
   * Entry will not be fully deleted but expired and
   * retained for the grace period if enabled.
   */
  async expire(key: string, options: CacheEntryOptions) {
    const message: CacheOperationMessage = {
      operation: 'expire',
      key: this.getFullKey(key),
      store: this.name,
    }

    return cacheOperation.tracePromise(async () => {
      this.l1?.logicallyExpire(key, options)
      await this.l2?.logicallyExpire(key, options)
      await this.publish({ type: CacheBusMessageType.Expire, keys: [key] })

      this.emit(cacheEvents.expire(key, this.name))
      return true
    }, message)
  }

  /**
   * Validate an item read from a cache layer.
   *
   * The item is valid if it is logically not expired ( not graced ) and
   * not expired by a tag. If it was deleted by a tag, it is removed from the
   * layer it was read from and dropped from the result, so that it is never
   * served, even as a graced value.
   */
  validateEntry(
    item: GetCacheValueReturn | undefined,
    layer: 'l1' | 'l2',
    options: CacheEntryOptions,
  ): EntryValidation | Promise<EntryValidation> {
    if (!item) return { isValid: false }
    if (item.entry.getTags().length === 0) {
      return item.isGraced ? { isValid: false, item } : { isValid: true, item }
    }

    return this.#tagSystem
      .getEntryTagState(item.entry)
      .then(async (state): Promise<EntryValidation> => {
        if (state === 'deleted') {
          await this.#deleteFromLayer(item.entry.getKey(), layer, options)
          return { isValid: false }
        }

        if (item.isGraced) return { isValid: false, item }

        if (state === 'expired') {
          await this.expire(item.entry.getKey(), this.#tagExpireOptions)
          return { isValid: false, item }
        }

        return { isValid: true, item }
      })
  }

  /**
   * Lazily delete an entry deleted by a tag from the layer it was read from.
   * The other layers and instances will do the same when they read it.
   */
  async #deleteFromLayer(key: string, layer: 'l1' | 'l2', options: CacheEntryOptions) {
    if (layer === 'l1') this.l1?.delete(key, options)
    else await this.l2?.delete(key, options)
  }

  /**
   * Create invalidation keys for a list of tags
   */
  async createTagInvalidations(tags: string[], options?: CacheEntryOptions) {
    return this.#tagSystem.createTagInvalidations(tags, options)
  }

  /**
   * Create deletion keys for a list of tags
   */
  async createTagDeletions(tags: string[], options?: CacheEntryOptions) {
    return this.#tagSystem.createTagDeletions(tags, options)
  }
}
