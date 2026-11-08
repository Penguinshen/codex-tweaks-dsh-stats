import { artwork } from './artwork'

export function DshIcon({ name }: { name: keyof typeof artwork }) {
  // The only input is the bundled, pinned DSH SVG artwork.
  const svg = artwork[name].svg.replace('<svg ', '<svg width="16" height="16" aria-hidden="true" focusable="false" ')
  return <span className="codex-dsh-icon" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />
}

export const GaugeIcon = () => <DshIcon name="gauge-outline" />
export const DatabaseIcon = () => <DshIcon name="database-outline" />

