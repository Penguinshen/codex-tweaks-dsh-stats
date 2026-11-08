import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { openCdp } from './cdp.mjs'
import { locateRollout, openRollout, uuid } from './rollout.mjs'

export function createLiveFeed(connection, liveId) {
  const token = JSON.stringify(liveId)
  let active
  let reader
  let lookupAfter = 0
  let lastData

  return {
    async tick() {
      const next = await connection.evaluate(`window.__codexDshStats?.getLiveThread?.(${token})`)
      if (next === undefined) return false
      const thread = typeof next === 'string' && uuid.test(next) ? next : null
      if (thread !== active) {
        reader?.close()
        reader = undefined
        active = thread
        lookupAfter = 0
        lastData = undefined
      }
      if (thread && !reader && Date.now() >= lookupAfter) {
        lookupAfter = Date.now() + 4000
        const file = await locateRollout(thread)
        if (file) reader = openRollout(file, thread)
      }

      let data = null
      if (reader) {
        try { data = await reader.read() } catch (error) {
          if (!['ENOENT', 'EPERM', 'EBUSY'].includes(error.code)) throw error
          if (error.code !== 'ENOENT') return true
          reader.close()
          reader = undefined
        }
      }
      const serialized = JSON.stringify(data)
      if (lastData !== serialized) {
        const accepted = await connection.evaluate(
          `window.__codexDshStats?.setLiveStats?.(${token}, ${JSON.stringify(thread)}, ${serialized})`,
        )
        if (!accepted) return false
        if (accepted === true) lastData = serialized
      }
      return true
    },
    close() { reader?.close() },
  }
}

async function run(address, liveId) {
  const connection = await openCdp(address)
  const feed = createLiveFeed(connection, liveId)
  let failures = 0
  try {
    while (failures < 3) {
      try {
        if (!await feed.tick()) return
        failures = 0
      } catch {
        failures++
      }
      await delay(1500)
    }
  } finally {
    feed.close()
    connection.close()
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run(process.argv[2], process.argv[3]).catch(() => { process.exitCode = 1 })
}

