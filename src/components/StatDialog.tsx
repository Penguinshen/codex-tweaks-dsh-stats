import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './StatDialog.module.css'

export function useStatDialog() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const id = useId().replace(/[^\w-]/g, '')
  const anchorName = `--codex-dsh-stat-${id}`

  useEffect(() => {
    if (!open) return
    const inside = (event: Event) => event.target instanceof Node
      && (rootRef.current?.contains(event.target) || panelRef.current?.contains(event.target))
    const dismissOutside = (event: Event) => {
      if (!inside(event)) setOpen(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Keep Escape in the open dialog so it does not cancel a running Codex task.
      event.preventDefault()
      event.stopImmediatePropagation()
      setOpen(false)
    }
    document.addEventListener('pointerdown', dismissOutside, true)
    document.addEventListener('click', dismissOutside, true)
    window.addEventListener('keydown', dismissOnEscape, true)
    // The desktop shell can consume keydown before this component hears it.
    window.addEventListener('keyup', dismissOnEscape, true)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true)
      document.removeEventListener('click', dismissOutside, true)
      window.removeEventListener('keydown', dismissOnEscape, true)
      window.removeEventListener('keyup', dismissOnEscape, true)
    }
  }, [open])

  return {
    open, setOpen, rootRef, panelRef,
    anchorStyle: { anchorName } as CSSProperties,
    panelStyle: { positionAnchor: anchorName } as CSSProperties,
  }
}

export function StatDialog({ seat, icon, title, value, children }: {
  seat: ReturnType<typeof useStatDialog>
  icon: ReactNode
  title: string
  value: string
  children: ReactNode
}) {
  if (!seat.open) return null
  return createPortal(
    <div ref={seat.panelRef} className={css.panel} data-dsh-stats-surface role="dialog"
      aria-label={title} style={seat.panelStyle}>
      <div className={css.title}>
        <span className={css.titleLabel}>{icon}{title}</span>
        <span className={css.titleValue}>{value}</span>
      </div>
      <div className={css.titleRule} aria-hidden />
      {children}
    </div>,
    document.body,
  )
}

