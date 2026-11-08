import { readFile } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createLiveFeed } from './live-worker.mjs'
import { openCdp } from './cdp.mjs'

const args = process.argv.slice(2)
const portArg = args.find(arg => arg.startsWith('--port='))
const port = portArg ? Number(portArg.slice(7)) : 49_239
if (process.platform !== 'win32' || !Number.isInteger(port) || port < 1024 || port > 65535
  || args.some(arg => !['--detach', '--status', '--compact', '--turn', '--demo'].includes(arg) && arg !== portArg)) {
  throw new Error('参数：--port=49239 --detach --status --compact --turn --demo')
}

// Verify that the socket belongs to this user's installed Store package.
const probe = String.raw`
$package=Get-AppxPackage -Name OpenAI.Codex
$listeners=@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue)
if(!$package -or !$listeners.Count){exit 2}
foreach($listener in $listeners){
  if($listener.LocalAddress -notin @('127.0.0.1','::1')){exit 3}
  $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$listener.OwningProcess)
  if(!$process.ExecutablePath -or !$process.ExecutablePath.StartsWith(($package.InstallLocation+'\'),[StringComparison]::OrdinalIgnoreCase) -or $process.Name -ne 'ChatGPT.exe'){exit 4}
}
if('127.0.0.1' -notin $listeners.LocalAddress){exit 5}
`
try {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', probe],
    { windowsHide: true, stdio: 'ignore', timeout: 12_000 })
} catch {
  throw new Error('未找到仅监听本机且属于微软商店 Codex 的调试连接。请用项目启动脚本打开 Codex。')
}

const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3_000) })
if (!response.ok) throw new Error('Codex 调试目标不可读')
const targets = (await response.json()).filter(target => target.type === 'page'
  && /^app:\/\/[^/]*(?:\/|$)/.test(target.url)
  && typeof target.webSocketDebuggerUrl === 'string')
const connections = []
try {
  // Codex can expose several auxiliary renderers. Probe them concurrently so
  // a hidden or stalled renderer cannot prevent the live chat from mounting.
  const probes = await Promise.allSettled(targets.map(async target => {
    const endpoint = new URL(target.webSocketDebuggerUrl)
    if (Number(endpoint.port) !== port || !endpoint.pathname.startsWith('/devtools/page/')) return
    const connection = await openCdp(endpoint)
    try {
      const info = await connection.evaluate(`({
        hasMount: Boolean(window.__codexDshStats),
        hasComposer: [...document.querySelectorAll('[data-thread-find-composer="true"]')].some(el => el.getBoundingClientRect().width > 0),
        focused: document.hasFocus(),
        visible: document.visibilityState === 'visible',
      })`)
      connections.push({ connection, info, endpoint })
    } catch (error) {
      connection.close()
      throw error
    }
  }))
  if (connections.length === 0) {
    const failed = probes.find(probe => probe.status === 'rejected')
    if (failed) throw new Error('无法读取 Codex 桌面页面：' + failed.reason.message)
  }
  const eligible = connections.filter(({ info }) => info?.visible && (info.hasComposer || info.hasMount))
  const hiddenMounts = connections.filter(({ info }) => info.hasMount && info.hasComposer)
  const chosen = (eligible.length === 1 ? eligible[0] : eligible.find(({ info }) => info.focused))
    ?? (eligible.length === 0 && hiddenMounts.length === 1 ? hiddenMounts[0] : undefined)
  if (!chosen) throw new Error('请在 Codex 主窗口打开一个有输入框的本地聊天，再重试。')
  const { connection, endpoint } = chosen

  if (args.includes('--detach')) {
    await connection.evaluate('window.__codexDshStats?.dispose(); true')
    console.log('已卸载本窗口的用量演示控件。')
  } else if (args.includes('--status')) {
    console.log(await connection.evaluate('window.__codexDshStats?.status() ?? null'))
  } else {
    const demo = args.includes('--turn') ? 'turn' : args.includes('--demo') ? 'dock' : null
    const options = { demo, mode: args.includes('--compact') ? 'compact' : 'detailed', liveId: demo === null ? randomUUID() : undefined }
    const payload = await readFile(new URL('../dist/desktop-payload.js', import.meta.url), 'utf8')
    const status = await connection.evaluate(`window.__codexDshStatsOptions = ${JSON.stringify(options)}; ${payload}`)
    if (!status?.composer) throw new Error('脚本已运行，但未找到 Codex 输入区挂载点。')
    if (demo === null) {
      const feed = createLiveFeed(connection, options.liveId)
      try {
        if (!await feed.tick()) throw new Error('真实数据接入在初始化时被关闭。')
      } finally { feed.close() }
      const worker = fileURLToPath(new URL('./live-worker.mjs', import.meta.url))
      const child = spawn(process.execPath, [worker, endpoint.href, options.liveId], {
        detached: true, windowsHide: true, stdio: 'ignore',
      })
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
      child.unref()
      console.log('已连接本地真实用量。', await connection.evaluate('window.__codexDshStats.status()'))
    } else {
      console.log('已在 Codex 窗口显示示例数据。', status)
    }
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  for (const { connection } of connections) connection.close()
}

