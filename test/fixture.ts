import { artwork } from '../src/components/artwork'

for (const icon of document.querySelectorAll<HTMLElement>('[data-artwork]')) {
  const svg = artwork[icon.dataset.artwork as keyof typeof artwork].svg
  icon.innerHTML = svg.replace('<svg ', '<svg width="17" height="17" aria-hidden="true" ')
}
if (new URLSearchParams(location.search).has('reference')) {
  const dock = document.createElement('div')
  dock.dataset.referenceDock = ''
  document.querySelector('[data-thread-find-composer]')?.append(dock)
  const turn = document.createElement('span')
  turn.dataset.referenceTurn = ''
  document.querySelector('.turn-action-controls')?.insertBefore(turn, document.querySelector('time'))
  await import('./reference/render.tsx')
}
document.body.dataset.fixtureReady = 'true'

