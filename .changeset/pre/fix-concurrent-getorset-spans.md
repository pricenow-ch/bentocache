---
'@bentocache/otel': patch
---

Fix concurrent `getOrSet` calls with the same key producing deeply nested spans instead of siblings
