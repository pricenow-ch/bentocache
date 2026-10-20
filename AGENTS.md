# AGENTS.md

Pricenow's fork of [Bentocache](https://github.com/Julien-R44/bentocache), a multi-tier cache for Node.js. Only the core package `packages/bentocache` is published, as `@pricenow/bentocache`. `packages/otel` and `packages/prometheus` are private companions kept for development; `docs/`, `playground/` and `benchmarks/` are unpublished workspace apps.

## Architecture

Core lives in `packages/bentocache/src`. A request flows top-down:

- `BentoCache` (`bento_cache.ts`) holds named stores and proxies to the default one. `bentostore()` (`bento_store.ts`) is the builder that declares a store's L1 driver, L2 driver and bus.
- `Cache` (`cache/cache.ts`) is the public API per store (`get`, `set`, `getOrSet`, `delete`, tags, `namespace`, …). It resolves options, logs, traces, then delegates.
- `CacheStack` (`cache/cache_stack.ts`) owns the tiers: `l1` (`LocalCache` facade), `l2` (`RemoteCache` facade), optional `bus`, and the `TagSystem`. `namespace()` returns a child stack sharing the same drivers.
- `GetSetHandler` routes `getOrSet` to `SingleTierHandler` or `TwoTierHandler` (`cache/get_set/`). These implement stampede protection (`Locks`, per-key mutexes), grace periods, soft/hard timeouts and background refresh via `FactoryRunner`.
- `Bus` (`bus/bus.ts`, on `@boringnode/bus`) syncs L1 caches across instances by broadcasting invalidations; it has a retry queue.
- Drivers (`drivers/`) extend `BaseDriver` and implement `L1CacheDriver` or `L2CacheDriver` from `types/driver.ts`. Each driver file exports a `xxxDriver(options)` factory returning `{ options, factory }`. SQL drivers share `drivers/database/database.ts` and plug in via adapters (knex, kysely, orchid).
- Cross-cutting: typed events (`events/`), `node:diagnostics_channel` tracing (`tracing_channels.ts`, consumed by `packages/otel`), `@poppinss/exception` errors with `E_*` codes (`errors.ts`), circuit breaker for L2 (`circuit_breaker/`).

Public entry points are the `exports` map in `packages/bentocache/package.json` and the matching `entry` list in `tsup.config.ts`. A new driver or subpath export needs both. `src/test_suite.ts` re-exports the shared driver test suite for third-party drivers, so changes to `tests/helpers/driver_test_suite.ts` are public API.

Behavioural docs (grace periods, stampede protection, tags, timeouts, extending drivers/plugins) live in `docs/content/docs/`. Read the relevant page before changing that behaviour, and update it in the same PR.

## Code style

Oxlint and Oxfmt use the `@julr/tooling-configs` presets. Run `pnpm lint:fix` for lint fixes and `pnpm format` for formatting; `pnpm checks` validates both and typechecks the workspace.

- ESM only. Relative imports carry the `.js` extension (`'./cache_stack.js'`). Type-only imports use `import type` / inline `type`.
- Files and directories are `snake_case`; classes `PascalCase`; driver factories `camelCase` ending in `Driver`.
- Private state uses `#private` fields and methods, not the `private` keyword.
- Public methods and non-obvious members get a short `/** … */` JSDoc; inline comments are rare.
- Errors are `Exception` subclasses in `src/errors.ts` with a static `code` (`E_…`) and `message`, exposed through the `errors` export.
- Use `@julr/utils` helpers (`is`, `sleep`, `bytes`) over hand-rolled equivalents.

## Testing

Tests use Japa (`test.group` / `test`, `assert` plugin) under `packages/*/tests`, as `*.spec.ts`. Build test setups with the factories in `packages/bentocache/factories/` (e.g. `new CacheFactory().withL1L2Config().create()`) and helpers in `tests/helpers/` (`NullDriver`, chaos drivers, `throwingFactory`, `slowFactory`). Driver tests call `registerCacheDriverTestSuite`.

Driver and two-tier tests need Redis, Valkey, DynamoDB, Postgres and MySQL: start them with `docker compose up -d` at the repo root (`.env.example` lists the connection vars). The bentocache package has `unit` and `drivers` suites; iterate with `pnpm -C packages/bentocache quick:test unit` (suite name) or `quick:test --files=<pattern>`. `pnpm test` runs lint first (via `pretest`) plus coverage.

Before handing work back, run `pnpm checks` and the tests touching your change. Run `pnpm -r build` first if typecheck complains about workspace packages, as CI does.

## Development workflow

- Package manager is pnpm (version pinned in `package.json`); install with `pnpm install --frozen-lockfile`.
- Workspace tooling and documentation use Node.js 24.11 or newer; the published core supports Node.js 22 or newer.
- Branch from `main` using a type prefix: `feature/`, `fix/`, `chore/` or `refactoring/`, e.g. `fix/l2-timeout-retry`.
- Commits follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`, `perf:`, `ci:`), optionally scoped (`fix(otel): …`).
- Every user-facing change to `@pricenow/bentocache` ships with a changeset (`pnpm changeset`): patch for fixes, minor for compatible additions, major for breaking changes. Commit it with the code.
- Prefer the GitHub CLI (`gh`) for pull requests, issues, reviews, workflow runs and releases whenever it is available.
- Releasing and merging from upstream follow `RELEASING.md`. Published versions are never reused, and the package name, public-core/private-companion split and release workflow are fork identity to preserve during upstream merges.
