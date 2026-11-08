import assert from 'node:assert/strict'
import { openCdp } from './cdp.mjs'
import { formatExactTokens } from '../src/lib/token-format.ts'
import { setTimeout as delay } from 'node:timers/promises'
import { locateRollout, openRollout } from './rollout.mjs'

const port = Number(process.argv[2] ?? 49239)
const pages = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
  .filter(t => t.type === 'page' && t.url.startsWith('app://'))
let connection
for (const page of pages) {
  let probe
  try {
    probe = await openCdp(page.webSocketDebuggerUrl)
    const selected = await probe.evaluate("window.__codexDshStats?.status().demo === null && window.__codexDshStats.status().dock")
    if (selected) { connection = probe; break }
  } catch { /* Probe the other local renderer. */ } finally {
    if (probe && probe !== connection) probe.close()
  }
}
assert.ok(connection, '未找到已挂载的真实数据桌面窗口')
let reader
let forcedNode
try {
  const state = await connection.evaluate(`(() => {
    const selected = document.querySelector('[data-app-action-sidebar-thread-id][aria-current="page"]');
    const active = selected?.getAttribute('data-app-action-sidebar-thread-id')?.slice(6);
    const seats = Array.from(document.querySelectorAll('[data-codex-dsh-mount="turn"]'), seat => ({
      groupOpacity: getComputedStyle(seat.parentElement).opacity,
      nativeButtons: seat.parentElement.querySelectorAll('button').length > 1,
      title: seat.querySelector('button')?.innerText,
      id: seat.closest('[data-content-search-unit-key]')?.dataset.contentSearchUnitKey?.split(':')[0],
    }));
    return {active,seats,demo:window.__codexDshStats.status().demo};
  })()`)
  assert.equal(state.demo,null)
  assert.ok(state.active)
  assert.ok(state.seats.length)
  assert.ok(state.seats.every(seat => seat.nativeButtons && seat.id && seat.title.startsWith('用量 ')))
  const file = await locateRollout(state.active)
  assert.ok(file)
  reader = openRollout(file,state.active)
  const snapshot = await reader.read()
  assert.ok(snapshot.usage)
  assert.ok(state.seats.every(seat => Object.hasOwn(snapshot.turns,seat.id)))

  const exactSelector = '[data-codex-dsh-mount="dock"] [data-composer-stat="usage"] button'
  await connection.evaluate(`document.querySelector(${JSON.stringify(exactSelector)}).click(); new Promise(r=>setTimeout(r,100))`)
  const details = await connection.evaluate("document.querySelector('[data-dsh-stats-surface][role=dialog]')?.innerText")
  const exactCount = data => {
    const total = data.uncachedInputTokens + data.cacheReadTokens + data.cacheWriteTokens + data.outputTokens
    return formatExactTokens(total, () => ',')
  }
  const updated = await reader.read()
  assert.ok(details?.includes(exactCount(snapshot.usage)) || details?.includes(exactCount(updated.usage)),
    '桌面会话明细应与本机日志累计一致')
  await connection.evaluate("for(const type of ['keydown','keyup'])window.dispatchEvent(new KeyboardEvent(type,{key:'Escape',bubbles:true,cancelable:true})); new Promise(r=>setTimeout(r,100))")
  assert.equal(await connection.evaluate("document.querySelectorAll('[data-dsh-stats-surface][role=dialog]').length"),0)

  await connection.send('DOM.enable')
  await connection.send('CSS.enable')
  const {root} = await connection.send('DOM.getDocument', {depth: 0})
  const getOpacity = () => connection.evaluate(`getComputedStyle(document.querySelector('[data-codex-dsh-mount="turn"]').parentElement).opacity`)
  const originalOpacity = await getOpacity()
  assert.ok(['0','1'].includes(originalOpacity))
  if (originalOpacity === '0') {
    // Force the exact Codex message group, without moving the user's mouse.
    await connection.evaluate("document.querySelector('[data-codex-dsh-mount=turn]')?.closest('.group')?.setAttribute('data-dsh-audit-hover','')")
    const {nodeId} = await connection.send('DOM.querySelector', {nodeId:root.nodeId,selector:'[data-dsh-audit-hover]'})
    forcedNode = nodeId
    assert.ok(forcedNode)
    await connection.send('CSS.forcePseudoState', {nodeId:forcedNode,forcedPseudoClasses:['hover']})
    await delay(250)
    assert.equal(await getOpacity(),'1')
    await connection.send('CSS.forcePseudoState', {nodeId:forcedNode,forcedPseudoClasses:[]})
    forcedNode = undefined
    await delay(250)
    assert.equal(await getOpacity(),'0')
  }
  console.log({真实单轮数:state.seats.length, 会话累计与日志一致:true,
    使用原生图标组:true, 真实窗口悬停复验:originalOpacity === '0', Escape关闭:true})
} finally {
  if (forcedNode) await connection.send('CSS.forcePseudoState', {nodeId:forcedNode,forcedPseudoClasses:[]}).catch(()=>{})
  await connection.evaluate(`document.querySelector('[data-dsh-audit-hover]')?.removeAttribute('data-dsh-audit-hover')`).catch(()=>{})
  reader?.close()
  connection.close()
}

