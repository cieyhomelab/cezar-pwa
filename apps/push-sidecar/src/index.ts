import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { readConfig } from './config.ts'
import { Pusher } from './push.ts'
import { SubscriptionStore } from './store.ts'
import { initVapid, loadVapid } from './vapid.ts'
import { Watcher } from './watcher.ts'

/**
 * `cezar-push` — the Web Push sidecar for Cezar Mobile (REQUIREMENTS § 6).
 *
 *   cezar-push init   create the VAPID key pair once (prints only the PUBLIC key)
 *   cezar-push        serve /m/push/ on loopback and watch Cezar's workspace stream
 *
 * Logs go to journald through stdout and never carry task content.
 */
const log = (message: string) => console.log(`cezar-push: ${message}`)

async function main(argv: string[]): Promise<void> {
  const config = readConfig()
  const vapidFile = join(config.stateDir, 'vapid.json')

  if (argv[0] === 'init') {
    const { keys, created } = await initVapid(vapidFile)
    log(`${created ? 'created' : 'kept the existing'} VAPID keys at ${vapidFile}`)
    log(`public key: ${keys.publicKey}`)
    return
  }

  const vapid = await loadVapid(vapidFile)
  const store = new SubscriptionStore(join(config.stateDir, 'subscriptions.json'))
  const rejected = await store.load()
  if (rejected > 0) log(`set aside ${rejected} invalid subscriptions in ${store.rejectedFile}`)
  const pusher = new Pusher({ store, vapid, subject: config.subject, log })
  const watcher = new Watcher({
    cezarUrl: config.cezarUrl,
    log,
    notify: async (payload) => {
      const deliveries = await pusher.sendToAll(payload)
      log(`transition pushed to ${deliveries.filter((d) => d === 'sent').length}/${deliveries.length} devices`)
    },
  })

  const app = createApp({ store, pusher, watcher, publicKey: vapid.publicKey, publicOrigin: config.publicOrigin })
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    log(`listening on ${info.address}:${info.port}, ${store.list().length} subscriptions`)
  })
  const watching = watcher.run()

  const shutdown = () => {
    watcher.stop()
    server.close()
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
  await watching
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`cezar-push: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
