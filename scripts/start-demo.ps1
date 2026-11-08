[CmdletBinding()]
param([switch]$PlanOnly, [ValidateRange(1024, 65535)][int]$Port = 49239)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$bundledNode = Join-Path $project 'runtime\node.exe'
$node = if (Test-Path -LiteralPath $bundledNode -PathType Leaf) {
    $bundledNode
} else {
    (Get-Command node.exe -ErrorAction Stop).Source
}

$package = Get-AppxPackage -Name OpenAI.Codex
if (!$package) { throw '当前用户未安装微软商店版 Codex。' }
$application = (Get-AppxPackageManifest -Package $package).Package.Applications.Application |
    Where-Object { $_.Executable -match '(^|[\\/])ChatGPT[.]exe$' } | Select-Object -First 1
if (!$application) { throw '找不到 Codex 的桌面启动入口。' }
$appId = $package.PackageFamilyName + '!' + $application.Id
$appExe = Join-Path $package.InstallLocation ($application.Executable -replace '/', '\')
$attach = Join-Path $PSScriptRoot 'attach.mjs'
$payload = Join-Path $project 'dist/desktop-payload.js'
if (!(Test-Path -LiteralPath $payload -PathType Leaf)) { throw '桌面补丁未构建，请先运行 npm run build。' }

$activator = @"
using System;
using System.Runtime.InteropServices;

namespace DshStats {
    [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IApplicationActivationManager {
        [PreserveSig]
        int ActivateApplication(
            [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments,
            uint options, out uint processId);
    }

    public static class Launcher {
        public static uint Activate(string appUserModelId, string arguments) {
            var type = Type.GetTypeFromCLSID(new Guid("45ba127d-10a8-46ea-8ab7-56ea9078943c"), true);
            var manager = (IApplicationActivationManager)Activator.CreateInstance(type);
            try {
                uint processId;
                Marshal.ThrowExceptionForHR(manager.ActivateApplication(appUserModelId, arguments, 0, out processId));
                return processId;
            } finally {
                Marshal.FinalReleaseComObject(manager);
            }
        }
    }
}
"@
if (!('DshStats.Launcher' -as [type])) { Add-Type -TypeDefinition $activator }
$launchArgs = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$port"

if ($PlanOnly) {
    [pscustomobject]@{
        Package = $package.Name
        Version = $package.Version
        ApplicationId = $appId
        Listener = "127.0.0.1:$port"
        LaunchArguments = $launchArgs
        PayloadBytes = (Get-Item -LiteralPath $payload).Length
    }
    return
}

function Invoke-DemoAttach {
    $ErrorActionPreference = 'Continue'
    $output = & $node $attach "--port=$port" 2>&1
    $ok = $LASTEXITCODE -eq 0
    $message = (@($output) | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    [pscustomobject]@{ Success = $ok; Message = $message }
}

$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    $attempt = Invoke-DemoAttach
    if ($attempt.Success) { Write-Host $attempt.Message; return }
    throw "无法连接当前窗口。请打开一个本地聊天后重试。$([Environment]::NewLine)$($attempt.Message)"
}

function Get-RunningCodex {
    @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq $appExe })
}

if ((Get-RunningCodex).Count -gt 0) {
    Write-Host '请先保存正在进行的工作，再从 Codex 应用菜单或托盘退出。这个脚本会等待，不会关闭应用。'
    $deadline = [DateTime]::Now.AddMinutes(4)
    while ((Get-RunningCodex).Count -gt 0 -and [DateTime]::Now -lt $deadline) {
        Start-Sleep -Seconds 1
    }
    if ((Get-RunningCodex).Count -gt 0) { throw '等待 Codex 退出超时。' }
}

$used = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($used) { throw "本地端口 $port 已被占用。" }

$started = [DshStats.Launcher]::Activate($appId, $launchArgs)
Write-Host "已请求启动 Codex（进程 $started）。请在 Codex 打开本聊天或任意有已完成回复的本地聊天。"
$deadline = [DateTime]::Now.AddSeconds(90)
$failure = ''
while ([DateTime]::Now -lt $deadline) {
    try {
        $targets = Invoke-WebRequest -Uri "http://127.0.0.1:$port/json/list" -UseBasicParsing -TimeoutSec 2
        if ($targets.StatusCode -eq 200 -and $targets.Content -ne '[]') {
            $attempt = Invoke-DemoAttach
            if ($attempt.Success) {
                Write-Host $attempt.Message
                return
            }
            $failure = $attempt.Message
        }
    } catch {
        $failure = $_.Exception.Message
    }
    Start-Sleep -Seconds 2
}
throw "未能完成桌面挂载。$failure"

