import { test } from '@japa/runner'
import { createPool } from 'mysql2'
import { Kysely, MysqlDialect } from 'kysely'

import { createKyselyStore } from './helpers.js'
import { MYSQL_CREDENTIALS } from '../../helpers/index.js'
import { registerCacheDriverTestSuite } from '../../../src/test_suite.js'

test.group('Kysely | Mysql driver', (group) => {
  registerCacheDriverTestSuite({
    test,
    group,
    supportsMilliseconds: false,
    createDriver: (options) => {
      const db = new Kysely<any>({
        dialect: new MysqlDialect({
          pool: createPool({ ...MYSQL_CREDENTIALS }),
        }),
      })

      return createKyselyStore({
        connection: db,
        tableName: 'bentocache_kysely',
        prefix: 'japa',
        ...options,
      })
    },
  })

  test('prune removes expired entries and keeps unexpired entries', async ({ assert, cleanup }) => {
    const db = new Kysely<any>({
      dialect: new MysqlDialect({ pool: createPool(MYSQL_CREDENTIALS) }),
    })
    const store = createKyselyStore({
      connection: db,
      tableName: 'bentocache_kysely',
      prefix: 'japa',
    })
    cleanup(async () => {
      await store.clear()
      await store.disconnect()
    })

    await store.set('expired', 'expired value', -2000)
    await store.set('fresh', 'fresh value', 60_000)
    await store.set('forever', 'forever value')
    await store.prune()

    const rows = await db.selectFrom('bentocache_kysely').select('key').orderBy('key').execute()
    assert.deepEqual(
      rows.map((row) => row.key),
      ['japa:forever', 'japa:fresh'],
    )
  })
})
