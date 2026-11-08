import { useEffect, type ReactNode, type RefObject } from 'react'
export { GaugeIcon as IconGaugeOutlineRegular, DatabaseIcon as IconDatabaseOutlineRegular } from '../../src/components/icons'

// Keep the upstream render tree. Hover tips are excluded from the visual captures.
export function Tooltip({ children }: { children: ReactNode }) { return children }
export function assistantStepReading(): never { throw new Error('Fixture requires a session stats projection') }
export function useDismissOnOutsidePointer(
  root: RefObject<HTMLElement>,
  enabled: boolean,
  onOpenChange: (open: boolean) => void,
  panel: RefObject<HTMLElement>,
) {
  useEffect(() => {
    if (!enabled) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !panel.current?.contains(event.target)) {
        onOpenChange(false)
      }
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [root, enabled, onOpenChange, panel])
}

