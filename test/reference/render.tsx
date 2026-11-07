import { createRoot } from 'react-dom/client'
import { ActivityPill, UsagePill } from './StatsPills'
import { TurnUsagePanel } from './TurnUsagePanel'
import { demos, type Demo } from '../../src/lib/mock'
import '../../src/components/dock.css'
import '../../src/styles/tokens.css'

const labels: Record<string, string> = {
  'number.thousand': '{value}K', 'number.million': '{value}M', 'number.groupSeparator': ',',
  'stats.counts': '{turns} 轮 {steps} 步', 'message.tokensPerSecond': '{tps} tok/s',
  'stats.cacheHit': '缓存命中 {percent}%', 'stats.dialog.title': '会话统计',
  'stats.dialog.usageTitle': 'Token 用量', 'stats.dialog.llmTime': '模型用时',
  'stats.dialog.toolTime': '工具调用用时', 'stats.dialog.ttft': '首 token 平均（TTFT）',
  'stats.dialog.speed': '输出速度（TPS）',
  'duration.compactSeconds': '{seconds} 秒', 'duration.compactMinutes': '{minutes} 分 {seconds} 秒',
  'message.turnUsage.count': '{count} tok', 'message.turnUsage.consumed': '用量 {total}',
  'message.turnUsage.title': '本轮用量', 'message.turnUsage.model': '提供方 / 模型',
  'message.turnUsage.cacheHit': '缓存命中', 'message.turnUsage.input': '未缓存输入',
  'message.turnUsage.cacheRead': '缓存读取', 'message.turnUsage.cacheWrite': '缓存写入',
  'message.turnUsage.output': '输出', 'message.turnUsage.reasoning': '（其中推理 {tokens}）',
}
function t(key: string, params: Record<string, number | string> = {}) {
  if (!(key in labels)) throw new Error(`Missing fixture translation ${key}`)
  return labels[key].replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
}
const demo: Demo = new URLSearchParams(location.search).get('demo') === 'turn' ? 'turn' : 'dock'
const data = demos[demo]
const projections = { sessionStats: data.activity, tokenUsage: data.usage }
const useProjection = (key: keyof typeof projections) => projections[key]
const props = {
  useProjection, useChat: () => [],
  usePerformanceUsage: (selector: (mode: string) => string) => selector('detailed'),
  t,
}
document.body.setAttribute('data-dsh-stats-surface', '')
createRoot(document.querySelector('[data-reference-dock]')!).render(
  <div className="codex-dsh-dock" data-composer-dock>
    <ActivityPill {...props} /><UsagePill {...props} />
  </div>,
)
const turn = data.turn
createRoot(document.querySelector('[data-reference-turn]')!).render(
  <TurnUsagePanel usage={{
    ...turn,
    cacheWriteTokens: turn.cacheWriteTokens || undefined,
    totalTokens: turn.uncachedInputTokens + turn.cacheReadTokens + turn.cacheWriteTokens + turn.outputTokens,
  }} t={t} />,
)

