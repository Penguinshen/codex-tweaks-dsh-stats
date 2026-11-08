# Codex DSH Stats（开发中）

非官方 Codex Tweaks 功能包：在 Codex 桌面应用显示会话统计和已完成轮次用量。与 OpenAI、DeepSeek 和 Codex Tweaks 无隶属关系。

Windows x64 独立启动预览版已发布，安装包内附 Node.js，可从独立入口直接启动 Codex。[独立预览版下载](https://github.com/Penguinshen/codex-tweaks-dsh-stats/releases/tag/standalone-v0.1.1-preview)

## 当前状态

测试版：已在 Windows 的 Codex Tweaks 中验证本地导入、编译、授权和显示统计弹窗；Git 安装、重启后的自动加载和停用尚待验证。macOS 尚未实机验证。

## 安装（测试版）

在 Codex Tweaks 的功能包页面选择“从 Git 安装”，填写本仓库地址；安装、编译后检查权限说明，并在信任该版本时授权和启用。首次连接可能需要按管理器提示重启 Codex；普通快捷方式能否始终自动加载尚未验证。安装与构建需要 Node.js，Git 安装还需要 Git。

## 权限和隐私

功能包需要完整 Node 权限。代码从 `CODEX_HOME`（未设置时为 `~/.codex`）下的 sessions 和 archived_sessions 只读打开当前聊天的 JSONL 会话日志；日志可能包含聊天内容、工具调用和路径。读取后在本地提取统计，不需要账户令牌；功能包自身没有上传或网络请求代码。Node 权限在技术上并不限于只读，用户应检查代码并自行决定是否信任。宿主 Codex Tweaks 自身的联网和安全行为由其项目说明。不要把真实日志、截图或密钥提交到公开仓库。

## 兼容性和计算

目标为 Codex Tweaks API v3；需要 Node.js 和 Codex 桌面应用。桌面界面和日志格式属于可能变化的实现，更新后可能需要适配。缓存命中率为日志记录的缓存读取输入除以输入总量，会话为累计比值；模型切换后不会把百分比简单平均。速度为估算值。

## 开发验证

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
npm run test:browser
```

## 授权和致谢

参考 DeepSeek Harness 的组件、图标及格式化代码，保留上游 [MIT 许可](LICENSE-DSH.txt)。本项目自身代码使用 [MIT 许可](LICENSE)。
