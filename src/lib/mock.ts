export type Mode = 'detailed' | 'compact'

export interface ActivityStats {
  turns: number
  steps: number
  llmMs: number
  taskMs?: number
  estimated?: boolean
  toolMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
}

export interface Usage {
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens?: number
  routes?: { provider: string; model: string }[]
}

const small: Usage = {
  uncachedInputTokens: 37_570,
  cacheReadTokens: 251_430,
  cacheWriteTokens: 0,
  outputTokens: 8_300,
}
const large: Usage = {
  uncachedInputTokens: 17_571,
  cacheReadTokens: 2_830_976,
  cacheWriteTokens: 0,
  outputTokens: 9_139,
  reasoningTokens: 2_167,
  routes: [{ provider: 'openai', model: 'gpt-6.1-sol' }],
}

export const activity: ActivityStats = {
  turns: 1, steps: 5, llmMs: 45_200, toolMs: 162_000,
  ttftMs: 6_000, ttftSteps: 5, decodeMs: 30_000, decodeTokens: 8_700,
}

export const demos = {
  dock: {
    usage: small,
    turn: { ...small, reasoningTokens: 1_342, routes: large.routes },
    activity: { ...activity, decodeMs: 28_600, decodeTokens: small.outputTokens },
  },
  turn: {
    usage: large,
    turn: large,
    activity: { ...activity, decodeMs: 31_500, decodeTokens: large.outputTokens },
  },
}

export type Demo = keyof typeof demos

