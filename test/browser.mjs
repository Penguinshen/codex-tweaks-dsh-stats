import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { PNG } from 'pngjs'

const directory = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const output = process.argv[2] ? resolve(process.argv[2]) : resolve(directory, 'test-results')
await mkdir(output, { recursive: true })
const payload = await readFile(new URL('../dist/desktop-payload.js', import.meta.url), 'utf8')
const server = await createServer({ root: directory, server: { host: '127.0.0.1', port: 0 } })
await server.listen()
let browser
try {
  const base = `http://127.0.0.1:${server.httpServer.address().port}/test/fixture.html`
  browser = await chromium.launch({
    executablePath: process.env.DSH_STATS_CHROMIUM,
    headless: true,
  })
  const context = await browser.newContext({ viewport: { width: 580, height: 406 }, deviceScaleFactor: 1 })
  const failures = []
  async function fixture({ reference = false, demo = 'dock' } = {}) {
    const page = await context.newPage()
    page.on('pageerror', error => failures.push(error.message))
    await page.goto(`${base}?demo=${demo}${reference ? '&reference' : ''}`)
    await page.waitForSelector('[data-fixture-ready="true"]')
    if (!reference) {
      const status = await page.evaluate(`window.__codexDshStatsOptions = { demo: '${demo}', mode: 'detailed' }; ${payload}`)
      assert.equal(status.dock, true)
      assert.equal(status.turn, true)
    }
    await page.getByRole('button', { name: /tok\/s/ }).waitFor()
    return page
  }

  const main = await fixture()
  const source = await fixture({ reference: true })
  const activity = page => page.getByRole('button', { name: /轮 5 步/ })
  const session = page => page.getByRole('button', { name: /tok · 缓存命中/ })
  const turn = page => page.getByRole('button', { name: /^用量 / })
  const mainDock = main.locator('[data-composer-dock]')
  const panel = page => page.getByRole('dialog')
  const quietMouse = page => page.mouse.move(4, 4)

  assert.equal(await mainDock.innerText(), '1 轮 5 步·290 tok/s\n297K tok·缓存命中 87%')
  assert.equal(await main.locator('.turn-action-controls').evaluate(row => {
    const nodes = [...row.children]
    return nodes.at(-2).matches('[data-codex-dsh-mount="turn"]') && nodes.at(-1).tagName === 'TIME'
  }), true)
  assert.deepEqual(await activity(main).evaluate(button => {
    const style = getComputedStyle(button)
    const svg = button.querySelector('svg').getBoundingClientRect()
    const sep = getComputedStyle(button.querySelector('[aria-hidden]:not(svg):not(.codex-dsh-icon)'))
    return [style.padding, style.borderRadius, svg.width, svg.height, sep.marginLeft, sep.marginRight]
  }), ['1px 8px', '8px', 14, 14, '6px', '6px'])
  assert.equal(await mainDock.getByRole('button').count(), 2)
  assert.equal(await main.getByRole('button', { name: /上下文已用/ }).count(), 0)
  for (const selector of ['[data-thread-find-composer]', '[data-composer-dock]']) {
    const before = await source.locator(selector).boundingBox()
    const after = await main.locator(selector).boundingBox()
    assert.equal(after.y - before.y, 8)
    assert.equal(after.height, before.height)
  }

  function diff(left, right) {
    const a = PNG.sync.read(left)
    const b = PNG.sync.read(right)
    assert.deepEqual([a.width, a.height], [b.width, b.height])
    let pixels = 0
    let beyondRounding = 0
    for (let i = 0; i < a.data.length; i += 4) {
      const rgbDelta = Math.max(...[0, 1, 2].map(channel => Math.abs(a.data[i + channel] - b.data[i + channel])))
      const alphaChanged = a.data[i + 3] !== b.data[i + 3]
      if (rgbDelta || alphaChanged) pixels++
      if (rgbDelta > 1 || alphaChanged) beyondRounding++
    }
    return { different: pixels, beyondRounding, compared: a.width * a.height }
  }
  const dockDiff = diff(await source.locator('[data-composer-dock]').screenshot(), await mainDock.screenshot())
  const turnDiff = diff(await turn(source).screenshot(), await turn(main).screenshot())
  console.log('控件像素差异', { dock: dockDiff, turn: turnDiff })
  // Moving the dock 8 px can shift Chromium antialiasing by one RGB level at a single pixel.
  assert.equal(dockDiff.beyondRounding, 0, 'dock 不应出现超过抗锯齿舍入的差异')
  assert.ok(dockDiff.different <= 1, 'dock 最多允许 1 个像素的 RGB 舍入差')
  assert.equal(turnDiff.different, 0, '本轮用量按钮的同环境渲染应逐像素相同')

  const shots = []
  async function capture(label, left, right) {
    await quietMouse(left)
    await quietMouse(right)
    const pair = await Promise.all([left.screenshot({ animations: 'disabled' }), right.screenshot({ animations: 'disabled' })])
    shots.push({ label, pair })
  }
  await capture('输入框下统计行与消息尾部用量', source, main)

  for (const page of [source, main]) {
    await activity(page).click()
    await panel(page).waitFor()
    assert.match(await panel(page).innerText(), /45\.2 秒[\s\S]*2 分 42 秒[\s\S]*1\.2 秒[\s\S]*290 tok\/s/)
    const [buttonBox, panelBox] = await Promise.all([activity(page).boundingBox(), panel(page).boundingBox()])
    assert.ok(Math.abs(buttonBox.y - panelBox.y - panelBox.height - 8) <= 1)
    assert.equal(await panel(page).evaluate(element => getComputedStyle(element).zIndex), '1100')
    await page.keyboard.press('Escape')
    await panel(page).waitFor({ state: 'hidden' })
    await session(page).click()
    await panel(page).waitFor()
    assert.match(await panel(page).innerText(), /297,300 tok[\s\S]*87%/)
    assert.doesNotMatch(await panel(page).innerText(), /缓存写入/)
    await activity(page).click()
    await page.getByRole('dialog', { name: '会话统计' }).waitFor()
    assert.equal(await panel(page).count(), 1)
  }
  await capture('会话统计面板', source, main)
  await main.mouse.click(4, 4)
  await panel(main).waitFor({ state: 'hidden' })

  const large = await fixture({ demo: 'turn' })
  const largeSource = await fixture({ reference: true, demo: 'turn' })
  for (const page of [largeSource, large]) {
    assert.match(await session(page).innerText(), /2\.9M tok.*99%/)
    await turn(page).click()
    await panel(page).waitFor()
    assert.match(await panel(page).innerText(), /2,857,686 tok[\s\S]*openai\/gpt-6\.1-sol[\s\S]*99\.4%[\s\S]*2,167 tok/)
  }
  await capture('本轮用量明细 · 99.4%', largeSource, large)
  await large.setViewportSize({ width: 375, height: 520 })
  await large.keyboard.press('Escape')
  await panel(large).waitFor({ state: 'hidden' })
  assert.equal(await turn(large).innerText(), '')
  assert.equal((await turn(large).boundingBox()).width, 28)
  await turn(large).click()
  const narrow = await panel(large).boundingBox()
  assert.ok(narrow.x >= 11 && narrow.x + narrow.width <= 364)

  await main.evaluate(() => window.__codexDshStats.setOptions({ demo: 'dock', mode: 'compact' }))
  await turn(main).waitFor({ state: 'hidden' })
  assert.match(await mainDock.innerText(), /^290 tok\/s\n缓存命中 87%$/)
  assert.equal(await mainDock.getByRole('button').count(), 0)
  await main.evaluate(() => window.__codexDshStats.setOptions({ demo: 'dock', mode: 'detailed' }))

  await main.evaluate(() => {
    const old = document.querySelector('[data-thread-find-composer]')
    const replacement = old.cloneNode(true)
    replacement.querySelector('[data-codex-dsh-mount]')?.remove()
    old.replaceWith(replacement)
    const userRow = document.createElement('div')
    userRow.className = 'turn-action-controls'
    userRow.textContent = '用户操作'
    document.querySelector('[data-thread-find-target]').append(userRow)
  })
  await main.getByRole('button', { name: /轮 5 步/ }).waitFor()
  assert.equal(await main.locator('[data-codex-dsh-mount="dock"]').count(), 1)
  assert.equal(await main.locator('.turn-action-controls:not(.justify-start) [data-codex-dsh-mount]').count(), 0)

  await turn(main).click()
  await panel(main).waitFor()
  await main.evaluate(() => window.__codexDshStats.dispose())
  assert.equal(await main.locator('[data-codex-dsh-mount], style[data-codex-dsh-stats], [role="dialog"]').count(), 0)
  assert.equal(await main.locator('[data-thread-scroll-footer]').evaluate(el => getComputedStyle(el).paddingBottom), '16px')
  assert.deepEqual(failures, [])

  // A real-data update must bind to this chat and inherit native action visibility.
  const threadA = '11111111-1111-1111-1111-111111111111'
  const threadB = '22222222-2222-2222-2222-222222222222'
  const turnId = '33333333-3333-3333-3333-333333333333'
  const liveId = 'browser-regression'
  const liveData = {
    activity: {turns:1,steps:2,llmMs:0,taskMs:45000,toolMs:0,ttftMs:1100,
      ttftSteps:1,decodeMs:1200,decodeTokens:900,estimated:true},
    usage: {uncachedInputTokens:200,cacheReadTokens:8800,cacheWriteTokens:0,outputTokens:1000},
    turns: {[turnId]:{uncachedInputTokens:110,cacheReadTokens:3120,cacheWriteTokens:0,outputTokens:99}},
  }
  await main.evaluate("window.__codexDshStatsOptions = {demo:null,mode:'detailed',liveId:'browser-regression'}; " + payload)
  await main.evaluate(({threadA,turnId,liveId,liveData}) => {
    const selected = document.createElement('div')
    selected.setAttribute('aria-current','page')
    selected.setAttribute('data-app-action-sidebar-thread-id','local:'+threadA)
    document.body.append(selected)
    const row = document.querySelector('.turn-action-controls.justify-start')
    row.parentElement.setAttribute('data-response-annotation-conversation', threadA)
    row.parentElement.setAttribute('data-content-search-unit-key', turnId+':message')
    const group = document.createElement('div')
    group.className = 'native-test-actions'
    for (const button of row.querySelectorAll(':scope > button')) group.append(button)
    row.prepend(group)
    const style = document.createElement('style')
    style.textContent = '.native-test-actions{opacity:0;display:flex;gap:8px} .exchange:hover .native-test-actions,.exchange:focus-within .native-test-actions{opacity:1}'
    document.head.append(style)
    window.__codexDshStats.setLiveStats(liveId, threadA, liveData)
  }, {threadA,turnId,liveId,liveData})
  await quietMouse(main)
  const usageSeat = main.locator('.native-test-actions [data-codex-dsh-mount="turn"]')
  assert.equal(await usageSeat.count(),1)
  assert.equal(await usageSeat.evaluate(el=>getComputedStyle(el.parentElement).opacity),'0')
  await main.locator('.answer').hover()
  assert.equal(await usageSeat.evaluate(el=>getComputedStyle(el.parentElement).opacity),'1')
  await quietMouse(main)
  await main.locator('.native-test-actions button').first().focus()
  assert.equal(await usageSeat.evaluate(el=>getComputedStyle(el.parentElement).opacity),'1')
  await main.locator('.native-test-actions button').first().evaluate(el=>el.blur())
  assert.equal(await usageSeat.evaluate(el=>getComputedStyle(el.parentElement).opacity),'0')
  assert.match(await mainDock.innerText(),/约 750 tok\/s/)
  assert.match(await mainDock.innerText(),/10K tok·缓存命中 98%/)

  await main.locator('[data-app-action-sidebar-thread-id]').evaluate((el,id) => {
    el.setAttribute('data-app-action-sidebar-thread-id','local:'+id)
  }, threadB)
  await mainDock.waitFor({state:'hidden'})
  await usageSeat.waitFor({state:'detached'})
  await main.evaluate(({liveId,threadA,liveData}) => window.__codexDshStats.setLiveStats(liveId,threadA,liveData),
    {liveId,threadA,liveData})
  assert.equal(await mainDock.count(),0,'旧聊天的数据不能在切换后重新出现')
  await main.evaluate(({liveId,threadB,liveData}) => window.__codexDshStats.setLiveStats(liveId,threadB,
    {...liveData,turns:{},usage:{...liveData.usage,outputTokens:11000}}),{liveId,threadB,liveData})
  assert.match(await mainDock.innerText(),/20K tok/)
  assert.equal(await usageSeat.count(),0)
  await main.evaluate(() => window.__codexDshStats.dispose())

  const report = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 })
  await report.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
    * { box-sizing: border-box; } body { margin: 0; padding: 12px; background: #101012; color: #ededee; font: 14px "Segoe UI", "Microsoft YaHei", sans-serif; }
    h1 { font-size: 20px; margin: 2px 0 3px; } p { margin: 0 0 12px; color: #b6b6ba; }
    .grid { display: grid; grid-template-columns: 580px 580px; gap: 0 12px; }
    h2 { grid-column: 1 / -1; margin: 10px 0 5px; font-size: 15px; }
    figure { margin: 0; background: #1a1a1a; border-radius: 8px; overflow: hidden; }
    figcaption { padding: 6px 10px; border-bottom: 1px solid #38383a; color: #d8d8db; }
    img { display: block; width: 580px; height: auto; }
    </style><h1>DSH 用量组件对照</h1><p>相同假数据、字体和 Chromium 视口。右侧在 Codex 结构夹具中加载桌面补丁。</p>
    <div class="grid">${shots.map(({ label, pair }) => `<h2>${label}</h2>${pair.map((data, index) => `<figure><figcaption>${index ? 'Codex 桌面补丁' : 'DSH 上游组件'}</figcaption><img src="data:image/png;base64,${data.toString('base64')}"></figure>`).join('')}`).join('')}</div></html>`)
  await report.locator('img').last().waitFor()
  await report.evaluate(() => Promise.all(Array.from(document.images, image => image.decode())))
  await report.screenshot({ path: resolve(output, 'DSH用量组件对照.png'), fullPage: true })
  console.log('浏览器验收通过：挂载与卸载、三种弹窗、窄屏、模式、底部位置、DOM 更新、跟随原生悬停、聊天隔离、对照截图')
} finally {
  await browser?.close()
  await server.close()
}

