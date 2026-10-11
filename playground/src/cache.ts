import { pino } from 'pino'
import { BentoCache, bentostore } from '@pricenow/bentocache'
import { redisDriver } from '@pricenow/bentocache/drivers/redis'
import { prometheusPlugin } from '@bentocache/plugin-prometheus'
import { memoryDriver } from '@pricenow/bentocache/drivers/memory'

export const bento = new BentoCache({
  default: 'memoryAndRedis',
  logger: pino({
    level: 'debug',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  }),
  plugins: [prometheusPlugin()],
  stores: {
    memory: bentostore().useL1Layer(memoryDriver({})),

    redis: bentostore().useL2Layer(redisDriver({ connection: { host: 'localhost', port: 6379 } })),

    memoryAndRedis: bentostore()
      .useL1Layer(memoryDriver({}))
      .useL2Layer(redisDriver({ connection: { host: 'localhost', port: 6379 } })),
  },
})
