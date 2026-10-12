---
'@pricenow/bentocache': major
---

**Breaking:** `deleteByTag` now deletes the tagged entries instead of expiring them. Deleted entries are never returned as graced values, like with `delete`. The previous behavior is available as the new `expireByTag` method:

```ts
// Before
await bento.deleteByTag({ tags: ['products'] })

// After, same behavior
await bento.expireByTag({ tags: ['products'] })
```

If a tag is both deleted and expired, deletion wins, whatever the order of the calls. Deleted entries are freed from L1 when read and stay in L2 until their TTL ends, without ever being served. The `___bc:td:<tag>` keys never expire, so entries stored for longer than 10 days or with `setForever` stay deleted.

`expireByTag` keeps the 1.x storage format (`___bc:t:<tag>` keys), so 1.x and 2.x instances sharing a cache agree on expirations during a rolling deploy. `deleteByTag` stores its timestamps in new `___bc:td:<tag>` keys that 1.x instances ignore: avoid calling `deleteByTag` until every instance runs 2.x.

`expireByTag` and `deleteByTag` are now reported on the `bentocache.cache.operation` tracing channel, with their `tags`.

Also fixes `getOrSet` keeping its lock forever when reading or validating a cache layer fails after the lock is acquired (for example an L2 error with `suppressL2Errors: false`): later calls for the same key no longer hang.
