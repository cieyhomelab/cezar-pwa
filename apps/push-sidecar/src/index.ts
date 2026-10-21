import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { readConfig } from './config.ts'
import { GateAlerts, initGateToken } from './gate.ts'
import { claudeAdapter } from './limits/claude.ts'
import { codexAdapter } from './limits/codex.ts'
import { LimitAlerts } from './limit-alerts.ts'
import { LimitsCollector } from './limits/collector.ts'
import { Pusher } from './push.ts'
import { rejectedFileOf, SubscriptionStore } from './store.ts'
import { initVapid, loadVapid } from './vapid.ts'
import { Watcher } from './watcher.ts'

/**
 * `cezar-push` — the Web Push sidecar for Cezar Mobile (REQUIREMENTS § 6).
 *
 *   cezar-push init   create the VAPID key pair and the gate token once (prints only the PUBLIC key)
 *   cezar-push        serve /m/push/ on loopback and watch Cezar's workspace stream
 *
 * Logs go to journald through stdout and never carry task content.
 */
const log = (message: string) => console.log(`cezar-push: ${message}`)

async function main(argv: string[]): Promise<void> {
  const config = readConfig()
  const vapidFile = join(config.stateDir, 'vapid.json')
  const gateTokenFile = join(config.stateDir, 'gate-token')

  if (argv[0] === 'init') {
    const { keys, created } = await initVapid(vapidFile)
    log(`${created ? 'created' : 'kept the existing'} VAPID keys at ${vapidFile}`)
    log(`public key: ${keys.publicKey}`)
    const gate = await initGateToken(gateTokenFile)
    log(`${gate.created ? 'created' : 'kept the existing'} gate token at ${gateTokenFile}`)
    return
  }

  const vapid = await loadVapid(vapidFile)
  const subscriptionsFile = join(config.stateDir, 'subscriptions.json')
  const store = new SubscriptionStore(subscriptionsFile)
  const { rejected } = await store.load()
  if (rejected > 0) log(`set aside ${rejected} invalid subscriptions in ${rejectedFileOf(subscriptionsFile)}`)
  const pusher = new Pusher({ store, vapid, subject: config.subject, log })
  const watcher = new Watcher({
    cezarUrl: config.cezarUrl,
    log,
    notify: async (payload) => {
      const deliveries = await pusher.sendToAll(payload)
      log(`transition pushed to ${deliveries.filter((d) => d === 'sent').length}/${deliveries.length} devices`)
    },
  })

  const alerts = new LimitAlerts({
    file: join(config.stateDir, 'limit-alerts.json'),
    threshold: config.limits.notifyPercent,
    busy: () => watcher.hasActiveRuns(),
    log,
    notify: async (payload) => {
      const deliveries = await pusher.sendToAll(payload)
      log(`limit alert pushed to ${deliveries.filter((d) => d === 'sent').length}/${deliveries.length} devices`)
    },
  })
  await alerts.load()

  // Created on the first start when `init` predates it, so an upgrade needs no extra step.
  const gateToken = await initGateToken(gateTokenFile)
  if (gateToken.created) log(`created the gate token at ${gateTokenFile}`)
  const gateAlerts = new GateAlerts({
    file: join(config.stateDir, 'gate-alerts.json'),
    log,
    notify: async (payload) => {
      const deliveries = await pusher.sendToAll(payload)
      const sent = deliveries.filter((d) => d === 'sent').length
      log(`gate alert pushed to ${sent}/${deliveries.length} devices`)
      return sent
    },
  })
  await gateAlerts.load()

  const limits = new LimitsCollector({
    cezarUrl: config.cezarUrl,
    intervalMs: config.limits.intervalMs,
    log,
    onPoll: (providers) => alerts.check(providers),
    providers: {
      claude: config.limits.claude
        ? { adapter: claudeAdapter() }
        : { disabled: 'off in the sidecar config (LIMITS_CLAUDE)' },
      codex: config.limits.codex
        ? { adapter: codexAdapter({ command: config.limits.codexBin }) }
        : { disabled: 'off in the sidecar config (LIMITS_CODEX)' },
    },
  })

  const app = createApp({
    store,
    pusher,
    watcher,
    limits,
    publicKey: vapid.publicKey,
    publicOrigin: config.publicOrigin,
    gate: { token: gateToken.token, alerts: gateAlerts },
  })
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    log(`listening on ${info.address}:${info.port}, ${store.list().length} subscriptions`)
  })
  const watching = watcher.run()
  const collecting = limits.run()

  const shutdown = () => {
    watcher.stop()
    limits.stop()
    server.close()
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
  await Promise.all([watching, collecting])
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`cezar-push: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
