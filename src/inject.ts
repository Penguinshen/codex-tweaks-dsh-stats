import { installDesktop } from './desktop'

export default installDesktop(window.__codexDshStatsOptions ?? { demo: 'dock', mode: 'detailed' })

