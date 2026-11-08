# Codex 用量 Windows 独立启动测试版

解压后双击 Install.cmd。安装后，在开始菜单打开「Codex 用量（独立测试版）」即可启动 Codex 并加载用量。如果普通 Codex 已在运行，启动项会等你保存并正常退出，然后接手启动。

目前支持微软商店版 Codex，测试包为 Windows x64。包内附 Node.js，不需要另外安装 Node.js、Git 或 Codex Tweaks。独立版通过本机调试连接加载统计，使用开始菜单中原来的 Codex 或 ChatGPT 入口直接启动时，统计不会自动加载。安装后不需要手动编译。

独立版统计只读取本机当前聊天的 Codex 会话日志，且功能包不发送统计或聊天内容。项目许可、Node.js 许可与 DeepSeek Harness 许可随包附上。独立版和 Codex Tweaks 版建议每次只使用其中一个。

卸载前请退出独立版启动的 Codex。然后在开始菜单打开「卸载 Codex 用量（独立测试版）」。安装位置是当前用户本地应用数据下的 CodexDshStatsStandalone 目录。

升级到 v0.1.1 时，请先退出独立版启动的 Codex 并卸载旧版，再解压并运行新版 Install.cmd。旧版卸载后如果留下空目录，新版安装时会自动处理。
