import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { StatsDock } from './components/StatsDock'
import { TurnUsagePanel } from './components/TurnUsagePanel'
import { demos, type ActivityStats, type Demo, type Mode, type Usage } from './lib/mock'
import './styles/tokens.css'

const composerSelector = '[data-thread-find-composer="true"]'
const threadSelector = '[data-thread-find-target="conversation"]'
const actionSelector = '.turn-action-controls.justify-start'
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i

interface Options {
  demo: Demo | null
  mode: Mode
  liveId?: string
}

interface LiveStats {
  activity: ActivityStats
  usage: Usage | null
  turns: Record<string, Usage>
}

type Seat = { element: HTMLElement; root: Root }
type TurnSeat = Seat & { usage: Usage; id: string }
type Status = { composer: boolean; dock: boolean; turn: boolean; demo: Demo | null; mode: Mode }

declare global {
  interface Window {
    __codexDshStats?: {
      dispose(): void
      status(): Status
      setOptions(options: Options): Status
      getLiveThread(liveId: string): string | null | undefined
      setLiveStats(liveId: string, thread: string | null, stats: LiveStats | null): boolean | 'stale'
    }
    __codexDshStatsOptions?: Options
  }
}

function visible(element: HTMLElement): boolean {
  return element.getBoundingClientRect().width > 0
    && !element.closest('[hidden], [inert], [aria-hidden="true"]')
    && getComputedStyle(element).visibility !== 'hidden'
}

function findSeats() {
  const composer = Array.from(document.querySelectorAll<HTMLElement>(composerSelector)).find(visible)
  const thread = composer?.closest<HTMLElement>(threadSelector)
    ?? Array.from(document.querySelectorAll<HTMLElement>(threadSelector)).find(visible)
  const actions = thread ? Array.from(thread.querySelectorAll<HTMLElement>(actionSelector)).filter(visible) : []
  return { composer, actions }
}

function activeThread(): string | null {
  const key = document.querySelector('[data-app-action-sidebar-thread-id][aria-current="page"]')
    ?.getAttribute('data-app-action-sidebar-thread-id')
  const id = key?.startsWith('local:') ? key.slice(6) : ''
  return uuid.test(id) ? id : null
}

function actionTarget(row: HTMLElement): HTMLElement {
  // Use the same opacity and focus/hover state as the native action buttons.
  const group = Array.from(row.children).find(child => child instanceof HTMLElement && child.tagName === 'DIV'
    && !child.hasAttribute('data-codex-dsh-mount') && child.querySelector('button'))
  return group instanceof HTMLElement ? group : row
}

function turnId(row: HTMLElement, thread: string): string | null {
  const scope = row.closest<HTMLElement>('[data-response-annotation-conversation]')?.dataset.responseAnnotationConversation
  if (scope && scope !== thread && scope !== `local:${thread}`) return null
  const unit = row.closest<HTMLElement>('[data-content-search-unit-key]')?.dataset.contentSearchUnitKey?.split(':')[0]
  const key = row.closest<HTMLElement>('[data-turn-key]')?.dataset.turnKey?.match(/^history-content:turn:([\da-f-]+)$/i)?.[1]
  const id = unit && uuid.test(unit) ? unit : key
  return id && uuid.test(id) ? id : null
}

function createSeat(kind: 'dock' | 'turn', target: HTMLElement, mock: boolean): Seat {
  const element = document.createElement(kind === 'dock' ? 'div' : 'span')
  element.dataset.codexDshMount = kind
  element.setAttribute('data-dsh-stats-surface', '')
  if (mock) element.setAttribute('aria-label', '示例数据')
  const time = kind === 'turn' && target.querySelector('time, [data-assistant-message-sent-time], [data-message-timestamp]')
  let timeSeat = time || null
  while (timeSeat?.parentElement && timeSeat.parentElement !== target) timeSeat = timeSeat.parentElement
  target.insertBefore(element, timeSeat?.parentElement === target ? timeSeat : null)
  return { element, root: createRoot(element, { identifierPrefix: `codex-dsh-${kind}-` }) }
}

function removeSeat(seat?: Seat) {
  if (!seat) return
  seat.root.unmount()
  seat.element.remove()
}

export function installDesktop(initial: Options) {
  window.__codexDshStats?.dispose()
  const html = document.documentElement
  let options = initial
  let dock: Seat | undefined
  const turns = new Map<HTMLElement, TurnSeat>()
  let frame = 0
  let lastDockData: LiveStats | (typeof demos)[Demo] | null = null
  let lastDockMode: Mode | undefined
  let liveThread: string | null = null
  let liveStats: LiveStats | null = null

  function sync() {
    const { composer, actions } = findSeats()
    const theme = html.dataset.theme ?? document.body.dataset.theme
    const light = theme === 'light' || (theme !== 'dark' && (html.classList.contains('light')
      || (getComputedStyle(html).colorScheme === 'light' && !html.classList.contains('dark'))))
    const nextTheme = light ? 'light' : 'dark'
    if (html.dataset.dshStatsTheme !== nextTheme) html.dataset.dshStatsTheme = nextTheme

    const mock = options.demo === null ? null : demos[options.demo]
    const thread = mock ? null : activeThread()
    const real = thread && thread === liveThread ? liveStats : null
    const data = mock ?? real
    const showDock = composer && data && (data.activity.steps > 0 || data.usage)
    if (!showDock || dock?.element.parentElement !== composer) {
      removeSeat(dock)
      dock = showDock ? createSeat('dock', composer, Boolean(mock)) : undefined
      lastDockData = null
    }
    if (dock && data && (data !== lastDockData || options.mode !== lastDockMode)) {
      lastDockData = data
      lastDockMode = options.mode
      dock.root.render(<StatsDock activity={data.activity} usage={data.usage} mode={options.mode} />)
    }

    const desired = new Map<HTMLElement, { usage: Usage; id: string }>()
    if (options.mode === 'detailed') {
      const last = actions.at(-1)
      if (mock && last) desired.set(actionTarget(last), {usage: mock.turn, id: options.demo!})
      if (real && thread) {
        // In a turn with multiple assistant messages, the last action row owns the pill.
        const byTurn = new Map<string, HTMLElement>()
        for (const row of actions) {
          const id = turnId(row, thread)
          if (id && Object.hasOwn(real.turns, id)) byTurn.set(id, row)
        }
        for (const [id, row] of byTurn) desired.set(actionTarget(row), {usage: real.turns[id], id})
      }
    }
    for (const [target, seat] of turns) {
      if (desired.get(target)?.id === seat.id && seat.element.parentElement === target) continue
      removeSeat(seat)
      turns.delete(target)
    }
    for (const [target, next] of desired) {
      let seat = turns.get(target)
      if (!seat) {
        seat = { ...createSeat('turn', target, Boolean(mock)), ...next }
        turns.set(target, seat)
        seat.root.render(<TurnUsagePanel usage={next.usage} />)
      } else if (seat.usage !== next.usage) {
        seat.usage = next.usage
        seat.root.render(<TurnUsagePanel usage={next.usage} />)
      }
    }
  }

  const observer = new MutationObserver(records => {
    const external = records.some(record =>
      !(record.target instanceof Element && record.target.closest('[data-dsh-stats-surface]')))
    if (!external || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      sync()
    })
  })
  observer.observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['aria-label', 'aria-hidden', 'aria-current', 'hidden', 'inert', 'data-theme', 'class', 'data-content-search-unit-key', 'data-app-action-sidebar-thread-id'],
  })
  observer.observe(html, { attributes: true, attributeFilter: ['class', 'data-theme'] })

  const status = (): Status => ({
    composer: Boolean(findSeats().composer),
    dock: Boolean(dock?.element.isConnected),
    turn: [...turns.values()].some(seat => seat.element.isConnected),
    demo: options.demo,
    mode: options.mode,
  })

  window.__codexDshStats = {
    dispose() {
      observer.disconnect()
      cancelAnimationFrame(frame)
      removeSeat(dock)
      for (const seat of turns.values()) removeSeat(seat)
      delete html.dataset.dshStatsTheme
      document.querySelector('style[data-codex-dsh-stats]')?.remove()
      delete window.__codexDshStats
    },
    status,
    setOptions(next) {
      options = next
      flushSync(sync)
      return status()
    },
    getLiveThread(liveId) {
      return options.demo === null && options.liveId === liveId ? activeThread() : undefined
    },
    setLiveStats(liveId, thread, stats) {
      if (options.demo !== null || options.liveId !== liveId) return false
      if (thread !== activeThread()) return 'stale'
      liveThread = thread
      liveStats = stats
      flushSync(sync)
      return true
    },
  }
  flushSync(sync)
  return status()
}

