# @pricenow/bentocache

This repository maintains Pricenow's fork of [Bentocache](https://github.com/Julien-R44/bentocache).
The core package is published privately to npm as `@pricenow/bentocache`.
The initial fork version is `1.6.1`. The OpenTelemetry and Prometheus workspace
packages are retained for development and are not published by this fork.

```sh
pnpm add @pricenow/bentocache
```

```ts
import { BentoCache, bentostore } from '@pricenow/bentocache'
import { memoryDriver } from '@pricenow/bentocache/drivers/memory'
```

Installing requires npm access to the private package. Use the upstream API
documentation below with `@pricenow/bentocache` in place of `bentocache` imports.

## Releases

The package version in `packages/bentocache/package.json` is the release version.
Publishing does not increment it. Only the core package is publishable.

For the first publication, keep `1.6.1`, merge the fork setup into `main`, then:

```sh
git switch main
git pull --ff-only
npm login --registry=https://registry.npmjs.org/ --auth-type=web
pnpm install --frozen-lockfile
pnpm release:pack
pnpm release:verify
npm publish ./dist/bentocache.tgz --access restricted --provenance=false
gh release create '@pricenow/bentocache@1.6.1' \
  --target "$(git rev-parse HEAD)" \
  --title '@pricenow/bentocache@1.6.1' \
  --notes 'Initial private Pricenow release, based on Bentocache 1.6.1.'
```

When the first subsequent release is ready, configure a GitHub Actions trusted
publisher in npm's package settings:

- Organization: `pricenow-ch`
- Repository: `bentocache`
- Workflow filename: `publish.yml`
- Environment: leave empty
- Allowed actions: enable direct `npm publish`

Complete the first successful trusted publication within two days of configuring
the publisher, or npm requires deleting and recreating that configuration.
See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

The publishing workflow requires no npm write-token secret. Applications that
install the private package in CI need their own read credentials. Give the
appropriate Pricenow npm teams access to the package after its first publish.

For subsequent changes:

1. Make improvements on a branch and add a changeset with `pnpm changeset`.
   Select `@pricenow/bentocache`; choose patch for fixes, minor for compatible
   additions, or major for breaking changes. Commit the changeset with the code.
2. Merge the improvement PRs. On a release branch, run `pnpm changeset version`
   and `pnpm install --lockfile-only`, then review the core version and changelog
   in a PR. Keep dependency versions unchanged unless the changes require an update.
3. Merge the release PR. In GitHub Actions, select **Publish @pricenow/bentocache**,
   choose `main`, and enter the exact version from the package manifest.
4. The workflow runs CI, builds and verifies the tarball, publishes it privately,
   and creates a GitHub release tagged `@pricenow/bentocache@<version>`.

Never reuse a published version. If publishing succeeded but recording the
GitHub release failed, create the missing tag/release for the workflow's commit;
do not publish that version again. A failed validation before publishing can be retried.

## Merging upstream improvements

```sh
git remote add upstream https://github.com/Julien-R44/bentocache.git # once
git fetch upstream
git switch -c update/upstream main
git merge upstream/main
```

Resolve conflicts while keeping the Pricenow package identity, restricted
publishing, private companions, release workflow, and scoped workspace imports.
Keep upstream code and dependency improvements. Preserve the fork's version
until Changesets produces the next release; upstream versions do not determine
the next Pricenow version. Reinstall dependencies, run CI, add a core changeset,
and merge the PR before preparing the next release.

## Upstream documentation

![image](https://github.com/Julien-R44/bentocache/assets/8337858/4aa1023f-7a4f-4d73-8400-05baafbc899a)

<p align="center">
  <br/>
  <a href="https://bentocache.dev/">Bentocache</a> is a robust multi-tier caching solution for Node.js applications
  <br/>
</p>

## Features

- 🗄️ Multi-tier caching
- 🔄 Synchronization of local cache via Bus
- 🚀 Many drivers (Redis, Upstash, In-memory, Postgres, Sqlite and others)
- 🛡️ Grace period and timeouts. Serve stale data when the store is dead or slow
- 🤓 SWR-like caching strategy
- 🗂️ Namespaces. Group your keys by categories.
- 🏷️ Tagging. Easy invalidations.
- 🛑 Cache stampede protection.
- 🏷️ Named caches
- 📖 Well documented + handy JSDoc annotations
- 📊 Events. Useful for monitoring and metrics
- 🧭 OpenTelemetry instrumentation package for distributed tracing
- 📝 Easy Prometheus integration and ready-to-use Grafana dashboard
- 🧩 Easily extendable with your own driver

See documentation at [bentocache.dev](https://bentocache.dev/docs/introduction)

## Why Bentocache ?

There are already caching libraries for Node: [`keyv`](https://keyv.org/), [`cache-manager`](https://github.com/node-cache-manager/node-cache-manager#readme), or [`unstorage`](https://unstorage.unjs.io/). However, I think that we could rather consider these libraries as bridges that allow different stores to be used via a unified API, rather than true caching solutions as such.

Not to knock them, on the contrary, they have their use cases and cool. Some are even "marketed" as such and are still very handy for simple caching system.

Bentocache, on the other hand, is a **full-featured caching solution**. We indeed have this notion of unified access to differents drivers, but in addition to that, we have a ton of features that will allow you to do robust caching.

## Quick presentation

Bentocache is a caching solution aimed at combining performance and flexibility. If you are looking for a caching system that can transition from basic use to advanced multi-level configuration, you are in the right place. Here's what you need to know :

### One-level

The one-level mode is a standard caching method. Choose from a variety of drivers such as **Redis**, **In-Memory**, **Filesystem**, **DynamoDB**, and more, and you're ready to go.

In addition to this, you benefit from many features that allow you to efficiently manage your cache, such as **cache stampede protection**, **grace periods**, **timeouts**, **namespaces**, etc.

### Two-levels
For those looking to go further, you can use the two-levels caching system. Here's basically how it works:

- **L1: Local Cache**: First level cache. Data is stored in memory with an LRU algorithm for quick access
- **L2: Distributed Cache**: If the data is not in the in-memory cache, it is searched in the distributed cache (Redis, for example)
- **Synchronization via Bus**: In a multi-instance context, you can synchronize different local in-memory caches of your instances via a Bus like Redis or RabbitMQ. This method maintains cache integrity across multiple instances

Here is a simplified diagram of the flow :

![Bentocache Flow](./assets/bentocache_flow.png)

All of this is managed invisibly for you via Bentocache. The only thing to do is to set up a bus in your infrastructure. But if you need multi-level cache, you're probably already using Redis rather than your database as a distributed cache. So you can leverage it to synchronize your local caches

The major benefit of multi-tier caching, is that it allows for responses between 2,000x and 5,000x faster. While Redis is fast, accessing RAM is REALLY MUCH faster.

In fact, it's a quite common pattern : to quote an example, it's [what Stackoverflow does](https://nickcraver.com/blog/2019/08/06/stack-overflow-how-we-do-app-caching/#layers-of-cache-at-stack-overflow).


To give some perspective, here's a simple benchmark that shows the difference between a simple distributed cache ( using Redis ) vs a multi-tier cache ( using Redis + In-memory cache ) :

![Redis vs Multi-tier caching](./assets/redis_vs_mtier.png)

## Features

Below is a list of the main features of BentoCache. If you want to know more, you can read each associated documentation page.

### Multi layer caching

Multi-layer caching allows you to combine the speed of in-memory caching with the persistence of a distributed cache. Best of both worlds.

### Lot of drivers

Many drivers available to suit all situations: Redis, Upstash, Database (MySQL, SQLite, PostgreSQL), DynamoDB, Filesystem, In-memory (LRU Cache), Vercel KV...

See the [drivers documentation](https://bentocache.dev/docs/cache-drivers) for list of available drivers. Also, it is very easy to extend the library and [add your own driver](https://bentocache.dev/docs/custom-cache-driver)

### Resiliency

- [Grace period](https://bentocache.dev/docs/grace-periods): Keep your application running smoothly with the ability to temporarily use expired cache entries when your database is down, or when a factory is failing.

- [Cache stampede prevention](https://bentocache.dev/docs/stampede-protection): Ensuring that only one factory is executed at the same time.

- [Retry queue](https://bentocache.dev/docs/multi-tier#retry-queue-strategy) : When an application fails to publish something to the bus, it is added to a queue and retried later.

### Timeouts

If your factory is taking too long to execute, you can just return a little bit of stale data while keeping the factory running in the background. Next time the entry is requested, it will be already computed and served immediately.

### Tagging

Allows associating a cache entry with one or more tags to simplify invalidation. Instead of managing individual keys, entries can be grouped under multiple tags and invalidated in a single operation.

```ts
await bento.getOrSet({
  key: 'foo',
  factory: getFromDb(),
  tags: ['tag-1', 'tag-2']
});

await bento.deleteByTag({ tags: ['tag-1'] });
```

### Namespaces

Another way to group your keys is to use namespaces. This allows you to invalidate everything at once later :

```ts
const users = bento.namespace('users')

users.set({ key: '32', value: { name: 'foo' } })
users.set({ key: '33', value: { name: 'bar' } })

users.clear()
```

### Events

Events are emitted by Bentocache throughout its execution, allowing you to collect metrics and monitor your cache.

```ts
bento.on('cache:hit', () => {})
bento.on('cache:miss', () => {})
// ...
```

See the [events documentation](https://bentocache.dev/docs/events) for more information.

### OpenTelemetry

Bentocache ships with an official OpenTelemetry package: `@bentocache/otel`.
It lets you instrument cache operations as spans and integrate with any OpenTelemetry-compatible tracing system (Jaeger, Zipkin, Datadog, New Relic, etc.). You can track cache hits, misses, evictions, and more in your distributed tracing setup.

See the [telemetry documentation](https://bentocache.dev/docs/telemetry) for setup and examples.

### Friendly TTLs

All TTLs can be passed in a human-readable string format. We use [lukeed/ms](https://github.com/lukeed/ms) under the hood. (this is optional, and you can pass a `number` in milliseconds if you prefer)

```ts
bento.getOrSet({
  key: 'foo',
  ttl: '2.5h',
  factory: () => getFromDb(),
})
```

### Logging

You can pass a logger to Bentocache, and it will log everything that happens. Can be useful for debugging or monitoring.

```ts
import { pino } from 'pino'

const bento = new BentoCache({
  logger: pino()
})
```

See the [logging documentation](https://bentocache.dev/docs/logging) for more information.

## Sponsors

If you like this project, [please consider supporting it by sponsoring it](https://github.com/sponsors/Julien-R44/). It will help a lot to maintain and improve it. Thanks a lot !

![](https://github.com/julien-r44/static/blob/main/sponsorkit/sponsors.png?raw=true)
