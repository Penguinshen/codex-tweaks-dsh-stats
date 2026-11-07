import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.DSH_STATS_CHROMIUM || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test/fixture.html`)
  const result = await page.evaluate(async () => {
    const thread = '11111111-1111-1111-1111-111111111111'
    const sidebar = document.createElement('div')
    sidebar.setAttribute('data-app-action-sidebar-thread-id', `local:${thread}`)
    sidebar.setAttribute('aria-current', 'page')
    document.body.append(sidebar)
    const { activate } = await import('/src/index.ts')
    let cleanup
    const stats = { activity: { turns: 1, steps: 1, llmMs: 0, toolMs: 0, taskMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0, estimated: true }, usage: { uncachedInputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 20 }, turns: {} }
    activate({ node: { invoke: async () => stats }, onCleanup: fn => { cleanup = fn } })
    await new Promise(resolve => setTimeout(resolve, 100))
    const shown = document.querySelector('[data-composer-dock]')?.textContent
    cleanup()
    return { shown, remaining: document.querySelectorAll('[data-codex-dsh-mount]').length }
  })
  assert.match(result.shown, /缓存命中\s*90%/)
  assert.equal(result.remaining, 0)
  console.log('渲染器挂载、数据展示及停用清理通过')
} finally { await browser.close(); await server.close() }
