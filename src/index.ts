import { installDesktop } from './desktop'

type Host = { node?: { invoke(method: string, input: unknown): Promise<unknown> }; onCleanup(callback: () => void): void }

export function activate({ node, onCleanup }: Host) {
  if (!node) throw new Error('需要授权读取本地 Codex 日志')
  const liveId = 'ct-dsh-stats'
  const controller = installDesktop({ demo: null, mode: 'detailed', liveId })
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let previous = ''
  async function update() {
    if (stopped) return
    const thread = controller.getLiveThread(liveId) ?? null
    try {
      const data = thread ? await node!.invoke('read', { thread }) : null
      if (!stopped && thread === (controller.getLiveThread(liveId) ?? null)) {
        const serialized = JSON.stringify([thread, data])
        if (serialized !== previous) {
          controller.setLiveStats(liveId, thread, data as Parameters<typeof controller.setLiveStats>[2])
          previous = serialized
        }
      }
    } catch {
      if (!stopped && thread === (controller.getLiveThread(liveId) ?? null)) {
        controller.setLiveStats(liveId, thread, null)
        previous = ''
      }
    } finally {
      if (!stopped) timer = setTimeout(update, 1500)
    }
  }
  onCleanup(() => { stopped = true; if (timer) clearTimeout(timer); controller.dispose() })
  void update()
}
