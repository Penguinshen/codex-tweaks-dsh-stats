import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTokens, formatExactTokens, formatCacheHitPercent } from '../src/lib/token-format.ts'
import { formatTokensPerSecond } from '../src/lib/message-chrome.ts'

const t = (key, { value } = {}) => ({
  'number.thousand': `${value}K`,
  'number.million': `${value}M`,
  'number.groupSeparator': ',',
})[key]

test('紧凑 token 格式遵循缩放阈值和 DSH 进位', () => {
  const cases = [[0, '0'], [517, '517'], [999, '999'], [1000, '1K'], [12249, '12.2K'],
    [12250, '12.3K'], [99950, '100K'], [100499, '100K'], [100500, '101K'],
    [297300, '297K'], [517499, '517K'], [999999, '1000K'], [1000000, '1M'],
    [1200000, '1.2M'], [2857686, '2.9M'], [100500000, '101M']]
  for (const [input, expected] of cases) assert.equal(formatTokens(input, t), expected, String(input))
})

test('精确 token 格式保留全部数字并使用语言分隔符', () => {
  assert.equal(formatExactTokens(0, t), '0')
  assert.equal(formatExactTokens(2857686, t), '2,857,686')
  assert.equal(formatExactTokens(Number.MAX_SAFE_INTEGER, t), '9,007,199,254,740,991')
  assert.equal(formatExactTokens(2857686, () => ' '), '2 857 686')
})

test('会话与单轮按各自精度显示同一组缓存计数', () => {
  assert.equal(formatCacheHitPercent(2830976, 2848547), '99')
  assert.equal(formatCacheHitPercent(2830976, 2848547, 1), '99.4')
  assert.equal(formatCacheHitPercent(875, 1000), '88')
  assert.equal(formatCacheHitPercent(875, 1000, 1), '87.5')
  assert.equal(formatCacheHitPercent(870, 1000, 1), '87')
  assert.equal(formatCacheHitPercent(0, 1000), '0')
  assert.equal(formatCacheHitPercent(0, 0), null)
})

test('缓存只在精确全命中时显示 100，极大计数也保持区分', () => {
  for (const precision of [0, 1]) {
    assert.equal(formatCacheHitPercent(1000, 1000, precision), '100')
    assert.equal(formatCacheHitPercent(996, 1000, precision), '99.6')
    assert.equal(formatCacheHitPercent(99996, 100000, precision), '99.996')
    assert.match(formatCacheHitPercent(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER, precision), /^99\.9+[1-9]$/)
  }
})

test('每秒 token 在 10 处换精度并钳制负数', () => {
  const cases = [[-1, '0'], [0, '0'], [1, '1'], [8.24, '8.2'], [8.25, '8.3'],
    [9.94, '9.9'], [9.95, '10'], [10.49, '10'], [10.5, '11'], [289.8, '290']]
  for (const [input, expected] of cases) assert.equal(formatTokensPerSecond(input), expected, String(input))
})

