# Codex 桌面用量 · Windows 独立预览版

这是微软商店版 Codex 的本地用量扩展。安装包内含 Node.js，安装后从开始菜单打开「Codex 用量（独立测试版）」。[下载和版本说明](https://github.com/Penguinshen/codex-tweaks-dsh-stats/releases/tag/standalone-v0.1.1-preview)

此版本仅适用于 Windows x64，统计来自匹配的本机 Codex 聊天日志，目前支持有匹配日志的 Codex 本地聊天。需要通过独立入口启动 Codex。常规官方入口自动加载尚未实现。详见[安装说明](standalone/README.md)。

## 从源码打包

用 Node.js 24 构建。将 [Node.js v24.22.2 Windows x64 二进制](https://nodejs.org/dist/v24.22.2/win-x64/node.exe) 和 [同版许可证](https://raw.githubusercontent.com/nodejs/node/v24.22.2/LICENSE) 分别以 node.exe 和 LICENSE-Node.txt 保存在源码目录下的 runtime-download 文件夹。打包脚本会校验 node.exe 的 SHA-256。

```powershell
npm ci --ignore-scripts
npm test
npm run build
New-Item -ItemType Directory -Force .\release
.\standalone\package-windows.ps1 -RuntimeDirectory .\runtime-download -OutputDirectory .\release
```

## 开发和统计口径

打开本地 Codex 聊天后，输入框下方显示会话统计和累计 Token。每轮的最后一条已完成助手回复会在原生操作组里显示「本轮用量」。用量按钮跟随原生操作组的悬停和键盘聚焦状态。

- 构建：`npm ci`，然后运行 `npm run build`。
- 启动：运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-demo.ps1`。当前 Codex 已开启本机调试连接时直接挂载，否则脚本会等你正常退出并重开。
- 简洁模式：`npm run attach -- --compact`。默认 `npm run attach` 使用真实用量。开发测试可加 `--demo` 或 `--turn` 切到样例。
- 查看和卸载：`npm run attach -- --status` 查看挂载状态，`npm run detach` 移除控件。按原方式重启 Codex 会结束本次调试会话。
- 验证：`npm test`。安装 Chromium 后运行 `npm run test:browser`。已挂载真实桌面时可运行 `node scripts/verify-live.mjs` 验证。

用量读取器按活动聊天的 ID 找到本地 JSONL。它以只读方式打开日志，用文件监听和字节位置读取追加数据。向桌面页面发送的只有统计字段和匹配所需的 ID。切换聊天时先清除上一个聊天的显示，找不到匹配的本地数据时省略对应控件。实时读取跟随当前挂载，卸载、刷新或关闭 Codex 后后台读取器会退出。

会话总量来自日志的累计快照，单轮用量取已完成轮次记录，旧日志用累计变化量回退。缓存读取和写入已计入输入，推理已计入输出。轮次总耗时取完成事件，工具累计用时按调用和返回的时间差相加，可能包含并行重叠。输出速度用可配对轮次的输出数和首 token 后的耗时估算，包含这段时间内的工具和等待耗时。

来源：[DSH 源码 fcc0ad4](https://github.com/deepseek-ai/deepseek-harness/tree/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159) 与 [Codex 用量累计实现](https://github.com/openai/codex/blob/main/codex-rs/core/src/state/session.rs)。上游 DSH 的数字格式、组件 CSS、图标和视觉夹具按 LICENSE-DSH.txt 保留授权。Windows 应用启动参考 [Codex Tweaks](https://github.com/codex-tweaks/codex-tweaks/blob/ed83f9792d77de178ed942fd067a03964e0b0e15/backend/internal/core/platform_windows.go)。

