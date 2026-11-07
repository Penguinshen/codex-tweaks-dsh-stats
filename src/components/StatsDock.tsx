import type { ActivityStats, Mode, Usage } from '../lib/mock'
import { ActivityPill, UsagePill } from './StatsPills'
import './dock.css'

export function StatsDock({ activity, usage, mode }: {
  activity: ActivityStats
  usage: Usage | null
  mode: Mode
}) {
  return (
    <div className="codex-dsh-dock" data-composer-dock>
      <ActivityPill key={`activity-${mode}`} stats={activity} mode={mode} />
      {usage && <UsagePill key={`usage-${mode}`} usage={usage} mode={mode} />}
    </div>
  )
}

