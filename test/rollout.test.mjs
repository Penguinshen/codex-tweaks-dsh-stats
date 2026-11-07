import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, appendFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createRolloutAccumulator, normalizeUsage, openRollout } from '../scripts/rollout.mjs'

const thread = '11111111-1111-1111-1111-111111111111'
const first = '22222222-2222-2222-2222-222222222222'
const second = '33333333-3333-3333-3333-333333333333'
const counts = (input, cache, output, write = 0) => ({
  input_tokens: input, cached_input_tokens: cache, cache_write_input_tokens: write,
  output_tokens: output, total_tokens: input + output,
})
const row = (type, payload, timestamp) => JSON.stringify({ type, payload, timestamp })
const header = row('session_meta', { id: thread, model_provider: 'openai' })
const start = (turn_id, model = 'gpt-6.1-sol') => row('turn_context', {turn_id, model})
const complete = (turn_id, duration_ms = 5000, time_to_first_token_ms = 1000) =>
  row('event_msg', {type:'task_complete', turn_id, duration_ms, time_to_first_token_ms})
const step = (turn_id, response_id, usage, turn_token_usage, thread_token_usage) =>
  row('token_usage_record', {thread_id:thread, turn_id, response_id, usage, turn_token_usage, thread_token_usage})
const aggregate = total_token_usage => row('event_msg', {type:'token_count', info:{total_token_usage}})

test('缓存读取和写入都包含在输入，推理包含在输出', () => {
  assert.deepEqual(normalizeUsage({...counts(1000, 870, 30, 20), reasoning_output_tokens: 4}),
    {uncachedInputTokens: 110, cacheReadTokens: 870, cacheWriteTokens: 20, outputTokens: 30, reasoningTokens: 4})
  assert.equal(normalizeUsage(counts(100, 99, 30, 2)), null)
  assert.equal(normalizeUsage({...counts(100, 90, 30), reasoning_output_tokens: 31}), null)
})

test('会话累计和已完成单轮分开，旧事件与新记录不会重复计算', () => {
  const p = createRolloutAccumulator(thread)
  const a = counts(100, 90, 4)
  const b = counts(200, 150, 8)
  const sum = counts(300, 240, 12)
  const duplicate = step(first, 'a', a, a, a)
  const foreign = row('token_usage_record', {thread_id:'wrong', turn_id:first, response_id:'c',
    usage:counts(900,0,0), turn_token_usage:counts(900,0,0)})
  const at = sec => `2026-11-07T00:00:0${sec}.000Z`
  ;[header,start(first),duplicate,duplicate,aggregate(a),aggregate(a),foreign,
    row('response_item',{type:'function_call',call_id:'tool-a'},at(1)),
    row('response_item',{type:'function_call_output',call_id:'tool-a'},at(3)),
    complete(first), start(second), step(second,'b',b,b,sum),aggregate(sum),'{bad'].forEach(p.ingest)
  const v = p.snapshot()
  assert.equal(v.activity.steps, 2)
  assert.equal(v.activity.turns, 2)
  assert.equal(v.activity.toolMs, 2000)
  assert.equal(v.activity.decodeMs, 4000)
  assert.equal(v.activity.decodeTokens, 4)
  assert.equal(v.usage.cacheReadTokens, 240)
  assert.equal(v.turns[first].outputTokens, 4)
  assert.deepEqual(v.turns[first].routes, [{provider:'openai',model:'gpt-6.1-sol'}])
  assert.equal(v.turns[second], undefined)
  // A trailing per-response record may arrive before its cumulative event.
  p.ingest(step(second,'c',counts(10,0,1),counts(210,150,9),counts(310,240,13)))
  assert.equal(p.snapshot().usage.outputTokens, 12)
  p.ingest(aggregate(counts(310,240,13)))
  assert.equal(p.snapshot().usage.outputTokens, 13)
  p.ingest(complete(second, 1200, null))
  assert.equal(p.snapshot().turns[second].outputTokens, 9)
  assert.equal(p.snapshot().activity.decodeMs, 4000)
})

test('旧版累计事件只取变化量并按已知轮次归属', () => {
  const p = createRolloutAccumulator(thread)
  const a = counts(100, 90, 4)
  const b = counts(250, 180, 9)
  ;[header,start(first),aggregate(a),aggregate(a),complete(first),
    start(second),aggregate(b),complete(second)].forEach(p.ingest)
  assert.equal(p.snapshot().activity.steps, 2)
  assert.equal(p.snapshot().turns[second].outputTokens, 5)
  assert.equal(p.snapshot().turns[second].uncachedInputTokens, 60)
  const wrong = createRolloutAccumulator(second)
  wrong.ingest(header)
  assert.equal(wrong.snapshot(), null)
})

test('增量读取等待半行，文件截断后丢弃旧数据', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-rollout-test-'))
  const file = join(dir, 'test.jsonl')
  const data = [header, start(first), aggregate(counts(50,25,6)), complete(first)].join('\n')
  await writeFile(file, data)
  const reader = openRollout(file, thread)
  try {
    const firstRead = await reader.read()
    assert.equal(firstRead.usage.outputTokens, 6)
    assert.equal(firstRead.turns[first], undefined)
    await appendFile(file, '\n')
    let secondRead
    for (let i=0;i<50;i++) {
      secondRead = await reader.read()
      if (secondRead.turns[first]) break
      await delay(100)
    }
    assert.equal(secondRead.turns[first]?.outputTokens, 6)
    await writeFile(file, header + '\n')
    let thirdRead
    for (let i=0;i<50;i++) {
      thirdRead = await reader.read()
      if (!thirdRead.usage) break
      await delay(100)
    }
    assert.equal(thirdRead.usage, null)
    assert.deepEqual(thirdRead.turns, {})
  } finally {
    reader.close()
    await unlink(file)
    await rmdir(dir)
  }
})



test('切换模型后缓存命中按各轮输入和会话总输入分别计算', () => {
  const parser = createRolloutAccumulator(thread)
  const a = counts(100, 90, 4)
  const b = counts(300, 120, 8)
  const sum = counts(400, 210, 12)
  ;[header, start(first, 'model-a'), step(first, 'a', a, a, a), aggregate(a), complete(first),
    start(second, 'model-b'), step(second, 'b', b, b, sum), aggregate(sum), complete(second)].forEach(parser.ingest)
  const stats = parser.snapshot()
  assert.equal(stats.turns[first].cacheReadTokens / (stats.turns[first].uncachedInputTokens + stats.turns[first].cacheReadTokens), 0.9)
  assert.equal(stats.turns[second].cacheReadTokens / (stats.turns[second].uncachedInputTokens + stats.turns[second].cacheReadTokens), 0.4)
  assert.equal(stats.usage.cacheReadTokens / (stats.usage.uncachedInputTokens + stats.usage.cacheReadTokens), 0.525)
  assert.equal(stats.turns[first].routes[0].model, 'model-a')
  assert.equal(stats.turns[second].routes[0].model, 'model-b')
})
