---
'@pricenow/bentocache': patch
---

Fix Kysely cache table creation and pruning on MySQL and PostgreSQL to use timestamps consistently with expiration writes. SQLite continues to store expiration as Unix milliseconds.
