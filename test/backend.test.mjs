import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activate } from '../src/node.mjs'

test('后台拒绝无效聊天标识，停用后不再读取', async () => {
  let read
  const abort = new AbortController()
  const cleanup = activate({ rpc: { handle(name, fn) { assert.equal(name, 'read'); read = fn } }, signal: abort.signal })
  assert.equal(await read({ thread: '../../secret' }), null)
  assert.equal(await read({ thread: null }), null)
  abort.abort()
  assert.equal(await read({ thread: '11111111-1111-1111-1111-111111111111' }), null)
  cleanup()
})
