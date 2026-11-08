import { watch } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i
const tokenFields = ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'reasoningTokens']
const nonnegative = n => Number.isSafeInteger(n) && n >= 0
const addUsage = (a, b) => Object.fromEntries(tokenFields.map(key => [key, (a?.[key] ?? 0) + b[key]]))
const subtractUsage = (a, b) => Object.fromEntries(tokenFields.map(key => [key, a[key] - (b?.[key] ?? 0)]))

export function normalizeUsage(raw) {
  if (!raw || !nonnegative(raw.input_tokens) || !nonnegative(raw.output_tokens)) return null
  const input = raw.input_tokens
  const output = raw.output_tokens
  const read = raw.cached_input_tokens ?? 0
  const write = raw.cache_write_input_tokens ?? 0
  const reasoning = raw.reasoning_output_tokens ?? 0
  if (![read, write, reasoning].every(nonnegative) || read + write > input || reasoning > output
    || (raw.total_tokens != null && raw.total_tokens !== input + output)) return null
  return {
    uncachedInputTokens: input - read - write,
    cacheReadTokens: read,
    cacheWriteTokens: write,
    outputTokens: output,
    reasoningTokens: reasoning,
  }
}

export function createRolloutAccumulator(threadId) {
  let sessionId
  let provider
  let current
  let total
  let recordTotal
  let lastEventTotal
  let fallbackTotal
  const rounds = new Map()
  const calls = new Map()
  const toolCalls = new Set()
  let toolMs = 0

  function selectTurn(payload) {
    const id = payload.turn_id
    if (!uuid.test(id ?? '')) return null
    const root = uuid.test(payload.root_turn_id ?? '') ? payload.root_turn_id : id
    if (!rounds.has(root)) rounds.set(root, {
      steps: new Set(), legacySteps: 0, legacyUsage: null, parts: new Map(), models: new Set(), done: false,
    })
    return { id, root, round: rounds.get(root) }
  }

  function ingest(line) {
    // Ignore unrelated envelopes before decoding large tool outputs.
    if (!/"(?:session_meta|turn_context|token_usage_record|event_msg|response_item)"/.test(line)) return
    let record
    try { record = JSON.parse(line) } catch { return }
    const p = record?.payload
    if (!p || typeof p !== 'object') return
    if (record.type === 'session_meta') {
      sessionId = p.id
      provider = typeof p.model_provider === 'string' ? p.model_provider : undefined
    } else if (record.type === 'turn_context' || (record.type === 'event_msg' && p.type === 'task_started')) {
      current = selectTurn(p) ?? current
      if (current && typeof p.model === 'string' && p.model) current.round.models.add(p.model)
    } else if (record.type === 'token_usage_record') {
      if (p.thread_id && p.thread_id !== threadId) return
      const seat = selectTurn(p)
      const step = normalizeUsage(p.usage)
      if (!seat || !step || typeof p.response_id !== 'string' || !p.response_id) return
      const { id, round } = seat
      if (round.steps.has(p.response_id)) return
      round.steps.add(p.response_id)
      round.parts.set(id, normalizeUsage(p.turn_token_usage) ?? addUsage(round.parts.get(id), step))
      fallbackTotal = addUsage(fallbackTotal, step)
      recordTotal = normalizeUsage(p.thread_token_usage) ?? recordTotal
    } else if (record.type === 'event_msg' && p.type === 'token_count') {
      const next = normalizeUsage(p.info?.total_token_usage)
      if (!next) return
      const delta = subtractUsage(next, lastEventTotal)
      total = next
      lastEventTotal = next
      if (current && Object.values(delta).every(nonnegative) && Object.values(delta).some(Boolean)) {
        current.round.legacySteps++
        current.round.legacyUsage = addUsage(current.round.legacyUsage, delta)
      }
    } else if (record.type === 'event_msg' && p.type === 'task_complete') {
      const seat = selectTurn(p)
      if (!seat) return
      seat.round.done = true
      seat.round.duration = nonnegative(p.duration_ms) ? p.duration_ms : undefined
      seat.round.ttft = nonnegative(p.time_to_first_token_ms) ? p.time_to_first_token_ms : undefined
      if (current?.root === seat.root) current = null
    } else if (record.type === 'response_item' && typeof p.call_id === 'string') {
      const at = Date.parse(record.timestamp)
      if (!Number.isFinite(at)) return
      if (p.type === 'function_call' || p.type === 'custom_tool_call') {
        if (!toolCalls.has(p.call_id) && !calls.has(p.call_id)) calls.set(p.call_id, at)
      } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
        const start = calls.get(p.call_id)
        if (start == null) return
        calls.delete(p.call_id)
        toolCalls.add(p.call_id)
        toolMs += Math.max(0, at - start)
      }
    }
  }

  function snapshot() {
    if (sessionId !== threadId) return null
    const activity = { turns: rounds.size, steps: 0, llmMs: 0, toolMs, taskMs: 0, ttftMs: 0,
      ttftSteps: 0, decodeMs: 0, decodeTokens: 0, estimated: true }
    const turns = {}
    for (const [id, round] of rounds) {
      activity.steps += round.steps.size || round.legacySteps
      let usage = round.legacyUsage
      if (round.parts.size) usage = [...round.parts.values()].reduce(addUsage, null)
      if (!round.done) continue
      if (round.duration != null) activity.taskMs += round.duration
      if (round.ttft != null) {
        activity.ttftSteps++
        activity.ttftMs += round.ttft
      }
      if (usage && round.duration != null && round.ttft != null && round.duration > round.ttft) {
        activity.decodeMs += round.duration - round.ttft
        activity.decodeTokens += usage.outputTokens
      }
      if (usage && tokenFields.some(key => usage[key] > 0)) {
        const routes = provider ? [...round.models].map(model => ({provider, model})) : undefined
        const detail = { ...usage, routes }
        turns[id] = detail
        for (const part of round.parts.keys()) turns[part] = detail
      }
    }
    return { activity, usage: total ?? recordTotal ?? fallbackTotal ?? null, turns }
  }
  return { ingest, snapshot }
}

export async function locateRollout(id, codexDir = process.env.CODEX_HOME || join(homedir(), '.codex')) {
  if (!uuid.test(id)) return null
  for (const directory of ['sessions', 'archived_sessions']) {
    const files = await readdir(join(codexDir, directory), {recursive: true, withFileTypes: true}).catch(error => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const matches = files.filter(entry => entry.isFile() && entry.name.startsWith('rollout-')
      && entry.name.endsWith(`-${id}.jsonl`))
    if (matches.length > 1) return null
    if (matches.length === 1) return join(matches[0].parentPath, matches[0].name)
  }
  return null
}

export function openRollout(file, threadId) {
  let parser = createRolloutAccumulator(threadId)
  let offset = 0
  let partial = Buffer.alloc(0)
  let stamp
  let dirty = true
  let cached = null
  let watcher
  try {
    watcher = watch(file, {persistent: false}, () => { dirty = true })
    watcher.on('error', () => { dirty = true; watcher?.close(); watcher = undefined })
  } catch { /* A stat check also detects changes when the watch is unavailable. */ }
  let nextCheck = 0

  async function read() {
    if (!dirty && Date.now() < nextCheck) return cached
    const handle = await open(file, 'r')
    try {
      const info = await handle.stat()
      nextCheck = Date.now() + 4000
      dirty = false
      if (stamp && info.ino === stamp.ino && info.mtimeMs === stamp.mtimeMs && info.size === offset) return cached
      if (stamp && (info.ino !== stamp.ino || info.size < offset || (info.size === offset && info.mtimeMs !== stamp.mtimeMs))) {
        parser = createRolloutAccumulator(threadId)
        offset = 0
        partial = Buffer.alloc(0)
      }
      stamp = info
      const buffer = Buffer.allocUnsafe(256 * 1024)
      while (offset < info.size) {
        const {bytesRead} = await handle.read(buffer, 0, Math.min(buffer.length, info.size - offset), offset)
        if (!bytesRead) break
        offset += bytesRead
        const chunk = Buffer.concat([partial, buffer.subarray(0, bytesRead)])
        let start = 0
        for (let end; (end = chunk.indexOf(10, start)) !== -1; start = end + 1) {
          parser.ingest(chunk.toString('utf8', start, end))
        }
        partial = chunk.subarray(start)
      }
      cached = parser.snapshot()
      return cached
    } finally {
      await handle.close()
    }
  }

  return { read, close: () => watcher?.close() }
}

