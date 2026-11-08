export async function openCdp(address) {
  const url = new URL(address)
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1') throw new Error('只允许连接本机 CDP')
  const socket = new WebSocket(url)
  const opened = Promise.withResolvers()
  const pending = new Map()
  let id = 0

  socket.addEventListener('open', () => opened.resolve(), { once: true })
  socket.addEventListener('error', () => opened.reject(new Error('无法连接 Codex 调试目标')), { once: true })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })
  socket.addEventListener('close', () => {
    opened.reject(new Error('Codex 调试连接已关闭'))
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('Codex 调试连接已关闭'))
    }
    pending.clear()
  }, { once: true })

  const handshake = setTimeout(() => {
    opened.reject(new Error('等待 Codex 调试连接超时'))
    socket.close()
  }, 3_000)
  try {
    await opened.promise
  } finally {
    clearTimeout(handshake)
  }

  function send(method, params) {
    const request = ++id
    const response = Promise.withResolvers()
    const timer = setTimeout(() => {
      pending.delete(request)
      response.reject(new Error(`Codex 调试请求超时：${method}`))
    }, 5_000)
    pending.set(request, { ...response, timer })
    socket.send(JSON.stringify({ id: request, method, params }))
    return response.promise
  }

  return {
    send,
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      }
      return result.result.value
    },
    close: () => socket.close(),
  }
}

