import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { formatCacheHitPercent, formatExactTokens, formatTokens } from '../lib/token-format'
import { formatTokensPerSecond } from '../lib/message-chrome'
import { tokenLocale } from '../lib/locale'
import type { ActivityStats, Mode, Usage } from '../lib/mock'
import { DatabaseIcon, GaugeIcon } from './icons'
import { StatDialog, useStatDialog } from './StatDialog'
import css from './StatsPills.module.css'
import dialogCss from './StatDialog.module.css'

export const compactCount = (value: number) => `${formatTokens(value, tokenLocale)} tok`
export const exactCount = (value: number) => `${formatExactTokens(value, tokenLocale)} tok`
export const billedInputTokens = (usage: Usage) =>
  usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens

function formatDuration(ms: number): string {
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10} 秒`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)} 分 ${whole % 60} 秒`
}

function Reading({ first, second, open }: { first: string; second?: string; open: boolean }) {
  const label = useRef<HTMLSpanElement>(null)
  const [clipped, setClipped] = useState(false)
  useEffect(() => {
    const element = label.current
    if (!element) return
    const check = () => setClipped(element.scrollWidth > element.clientWidth)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(element)
    return () => observer.disconnect()
  }, [first, second])
  return (
    <span className={css.label} ref={label}
      title={clipped && !open ? [first, second].filter(Boolean).join(' · ') : undefined}>
      {first}{second && <><span className={css.sep} aria-hidden>·</span>{second}</>}
    </span>
  )
}

function Pill({ id, first, second, icon, dialog }: {
  id: 'activity' | 'usage'
  first: string
  second?: string
  icon: ReactNode
  dialog?: { title: string; value: string; details: ReactNode }
}) {
  const seat = useStatDialog()
  return (
    <span ref={seat.rootRef} style={seat.anchorStyle} className={css.anchor} data-composer-stat={id}>
      {dialog ? (
        <button type="button" className={css.pill} aria-haspopup="dialog"
          aria-label={[first, second].filter(Boolean).join(' · ')} aria-expanded={seat.open}
          onClick={() => seat.setOpen(!seat.open)}>
          {icon}<Reading first={first} second={second} open={seat.open} />
        </button>
      ) : (
        <span className={css.pill}>{icon}<Reading first={first} second={second} open={false} /></span>
      )}
      {dialog && <StatDialog seat={seat} icon={icon} title={dialog.title} value={dialog.value}>
        <dl className={dialogCss.details}>{dialog.details}</dl>
      </StatDialog>}
    </span>
  )
}

export function ActivityPill({ stats, mode }: { stats: ActivityStats; mode: Mode }) {
  const speed = stats.decodeMs > 0 && stats.decodeTokens > 0
    ? `${stats.estimated ? '约 ' : ''}${formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000))} tok/s`
    : undefined
  const icon = <GaugeIcon />
  if (mode === 'compact') return speed ? <Pill id="activity" first={speed} icon={icon} /> : null
  if (stats.steps === 0) return null
  const counts = `${stats.turns} 轮 ${stats.steps} 步`
  const details = (
    <>
      {stats.llmMs > 0 && <><dt>模型用时</dt><dd>{formatDuration(stats.llmMs)}</dd></>}
      {Boolean(stats.taskMs) && <><dt>轮次总耗时</dt><dd>{formatDuration(stats.taskMs!)}</dd></>}
      {stats.toolMs > 0 && <><dt>{stats.estimated ? '工具调用累计用时' : '工具调用用时'}</dt><dd>{formatDuration(stats.toolMs)}</dd></>}
      {stats.ttftSteps > 0 && <><dt>首 token 平均（TTFT）</dt><dd>{formatDuration(stats.ttftMs / stats.ttftSteps)}</dd></>}
      {speed && <><dt>{stats.estimated ? '输出速度（估算）' : '输出速度（TPS）'}</dt><dd>{speed}</dd></>}
    </>
  )
  const hasDetails = stats.llmMs > 0 || Boolean(stats.taskMs) || stats.toolMs > 0 || stats.ttftSteps > 0 || speed
  return <Pill id="activity" first={counts} second={speed} icon={icon}
    dialog={hasDetails ? { title: '会话统计', value: counts, details } : undefined} />
}

export function UsagePill({ usage, mode }: { usage: Usage; mode: Mode }) {
  const input = billedInputTokens(usage)
  const total = input + usage.outputTokens
  if (total === 0) return null
  const cacheHit = formatCacheHitPercent(usage.cacheReadTokens, input)
  const hitText = cacheHit === null ? undefined : `缓存命中 ${cacheHit}%`
  const icon = <DatabaseIcon />
  if (mode === 'compact') return hitText ? <Pill id="usage" first={hitText} icon={icon} /> : null
  const details = (
    <>
      {cacheHit !== null && <><dt>缓存命中</dt><dd>{cacheHit}%</dd></>}
      <dt>未缓存输入</dt><dd>{exactCount(usage.uncachedInputTokens)}</dd>
      <dt>缓存读取</dt><dd>{exactCount(usage.cacheReadTokens)}</dd>
      {usage.cacheWriteTokens !== 0 && <><dt>缓存写入</dt><dd>{exactCount(usage.cacheWriteTokens)}</dd></>}
      <dt>输出</dt><dd>{exactCount(usage.outputTokens)}</dd>
    </>
  )
  return <Pill id="usage" first={compactCount(total)} second={hitText} icon={icon}
    dialog={{ title: 'Token 用量', value: exactCount(total), details }} />
}

