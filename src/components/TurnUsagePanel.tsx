import type { Usage } from '../lib/mock'
import { formatCacheHitPercent } from '../lib/token-format'
import { DatabaseIcon } from './icons'
import { billedInputTokens, compactCount, exactCount } from './StatsPills'
import { StatDialog, useStatDialog } from './StatDialog'
import css from './TurnUsagePanel.module.css'
import dialogCss from './StatDialog.module.css'

export function TurnUsagePanel({ usage }: { usage: Usage }) {
  const seat = useStatDialog()
  const input = billedInputTokens(usage)
  const total = input + usage.outputTokens
  if (total === 0) return null
  const hit = formatCacheHitPercent(usage.cacheReadTokens, input, 1)
  const routes = usage.routes?.map(route => `${route.provider}/${route.model}`).join(', ')
  const label = `用量 ${compactCount(total)}`
  return (
    <span ref={seat.rootRef} style={seat.anchorStyle} className={css.root}>
      <button type="button" className={css.trigger} aria-haspopup="dialog" aria-label={label}
        aria-expanded={seat.open} onClick={() => seat.setOpen(!seat.open)}>
        <DatabaseIcon /><span className={css.label}>{label}</span>
      </button>
      <StatDialog seat={seat} icon={<DatabaseIcon />} title="本轮用量" value={exactCount(total)}>
        <dl className={dialogCss.details}>
          {routes && <><dt>提供方 / 模型</dt><dd className={dialogCss.route}>{routes}</dd></>}
          {hit !== null && <><dt>缓存命中</dt><dd>{hit}%</dd></>}
          <dt>未缓存输入</dt><dd>{exactCount(usage.uncachedInputTokens)}</dd>
          <dt>缓存读取</dt><dd>{exactCount(usage.cacheReadTokens)}</dd>
          {usage.cacheWriteTokens !== 0 && <><dt>缓存写入</dt><dd>{exactCount(usage.cacheWriteTokens)}</dd></>}
          <dt>输出</dt>
          <dd>{exactCount(usage.outputTokens)}{Boolean(usage.reasoningTokens) &&
            <span className={dialogCss.reasoning}>（其中推理 {exactCount(usage.reasoningTokens!)}）</span>}
          </dd>
        </dl>
      </StatDialog>
    </span>
  )
}

