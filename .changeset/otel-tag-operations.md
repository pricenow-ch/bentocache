---
'@bentocache/otel': patch
---

Trace `expireByTag` and `deleteByTag` operations. Their tags are added as the `cache.tags` attribute when `includeKeys` is enabled.
