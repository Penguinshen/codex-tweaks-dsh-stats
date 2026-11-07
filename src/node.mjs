import { locateRollout, openRollout, uuid } from '../scripts/rollout.mjs'

export function activate({ rpc, signal }) {
  const readers = new Map()
  let closed = false
  function cleanup() {
    if (closed) return
    closed = true
    for (const item of readers.values()) item.reader.close()
    readers.clear()
  }
  signal.addEventListener('abort', cleanup, { once: true })
  rpc.handle('read', async ({ thread } = {}) => {
    if (closed || typeof thread !== 'string' || !uuid.test(thread)) return null
    let item = readers.get(thread)
    if (!item) {
      const file = await locateRollout(thread)
      if (closed || !file) return null
      item = readers.get(thread)
      if (!item) {
        if (readers.size >= 8) {
          const oldest = readers.keys().next().value
          readers.get(oldest).reader.close()
          readers.delete(oldest)
        }
        item = { reader: openRollout(file, thread) }
        readers.set(thread, item)
      }
    }
    try { return await item.reader.read() } catch (error) {
      item.reader.close()
      readers.delete(thread)
      if (['ENOENT', 'EPERM', 'EACCES', 'EBUSY'].includes(error.code)) return null
      throw error
    }
  })
  return cleanup
}
