[CmdletBinding()]
param([switch]$Uninstall, [string]$TestRoot)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Desktop') {
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')
}
$files = @(
    'setup.ps1', 'Open-Codex.cmd', 'README.md', 'LICENSE', 'LICENSE-DSH.txt',
    'runtime/node.exe', 'runtime/LICENSE-Node.txt', 'dist/desktop-payload.js',
    'scripts/start-demo.ps1', 'scripts/attach.mjs', 'scripts/cdp.mjs',
    'scripts/live-worker.mjs', 'scripts/rollout.mjs'
)
$root = [Environment]::GetFolderPath('LocalApplicationData')
$programs = [Environment]::GetFolderPath('Programs')
if ($TestRoot) {
    $root = (Resolve-Path -LiteralPath $TestRoot).Path
    $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (!$root.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path $root -Leaf) -notmatch '^codex-dsh-standalone-test-[0-9a-f]{32}$') {
        throw '测试目录必须是指定格式的 Windows 临时目录。'
    }
    $programs = Join-Path $root 'Programs'
    New-Item -ItemType Directory -Path $programs -Force | Out-Null
}
$destination = Join-Path $root 'CodexDshStatsStandalone'
$uninstallName = '卸载 Codex 用量（独立测试版）.lnk'
$links = [ordered]@{
    'Codex 用量（独立测试版）.lnk' = @{
        Target = Join-Path $destination 'Open-Codex.cmd'
        Arguments = ''
    }
    $uninstallName = @{
        Target = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}" -Uninstall' -f (Join-Path $destination 'setup.ps1')
    }
}
$shell = New-Object -ComObject WScript.Shell
$manifestName = 'sha256.json'

function Read-PackageManifest($directory) {
    $data = Get-Content -LiteralPath (Join-Path $directory $manifestName) -Raw | ConvertFrom-Json
    foreach ($path in $files) {
        $hash = $data.PSObject.Properties[$path]
        if (!$hash -or $hash.Value -notmatch '^[a-fA-F0-9]{64}$') { throw "安装清单不完整：$path" }
        $file = Join-Path $directory $path
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $hash.Value) {
            throw "文件校验失败：$path"
        }
    }
    $data
}

function Remove-PackageFiles($directory) {
    foreach ($path in ($files + $manifestName)) {
        $file = Join-Path $directory $path
        if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file }
        if (Test-Path -LiteralPath $file) { throw "未能移除：$file" }
    }
    foreach ($path in @('runtime', 'scripts', 'dist')) {
        $folder = Join-Path $directory $path
        if ((Test-Path -LiteralPath $folder -PathType Container) -and
            !(Get-ChildItem -LiteralPath $folder -Force)) {
            Remove-Item -LiteralPath $folder
            if (Test-Path -LiteralPath $folder) { throw "未能移除：$folder" }
        }
    }
    if ((Test-Path -LiteralPath $directory -PathType Container) -and
        !(Get-ChildItem -LiteralPath $directory -Force)) {
        Remove-Item -LiteralPath $directory
        if (Test-Path -LiteralPath $directory) { throw "未能移除：$directory" }
    }
}

foreach ($entry in $links.GetEnumerator()) {
    $link = Join-Path $programs $entry.Key
    if (!(Test-Path -LiteralPath $link)) { continue }
    $shortcut = $shell.CreateShortcut($link)
    $matchesCurrent = $shortcut.TargetPath -eq $entry.Value.Target -and $shortcut.Arguments -eq $entry.Value.Arguments
    $matchesLegacy = $entry.Key -eq $uninstallName -and
        $shortcut.TargetPath -eq (Join-Path $destination 'Uninstall.cmd') -and !$shortcut.Arguments
    if (!$matchesCurrent -and !$matchesLegacy) { throw "已存在不属于此安装包的同名入口：$link" }
}

if ($Uninstall) {
    if (!(Test-Path -LiteralPath $destination)) { Write-Host '独立版未安装。'; return }
    if ($PSScriptRoot -ne $destination -and !$TestRoot) { throw '请从开始菜单运行独立版卸载入口。' }
    $null = Read-PackageManifest $destination
    $runningNode = Get-Process -Name node -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq (Join-Path $destination 'runtime\node.exe') }
    if ($runningNode) { throw '独立版正在读取用量。请退出独立版启动的 Codex，稍后再卸载。' }
    Set-Location -LiteralPath $root
    Remove-PackageFiles $destination
    foreach ($entry in $links.GetEnumerator()) {
        $link = Join-Path $programs $entry.Key
        if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link }
        if (Test-Path -LiteralPath $link) { throw "未能移除：$link" }
    }
    if (Test-Path -LiteralPath $destination) { Write-Host "已卸载，保留目录中的其他文件：$destination" }
    else { Write-Host '独立版已卸载。' }
    return
}

$null = Read-PackageManifest $PSScriptRoot
if (Test-Path -LiteralPath $destination -PathType Container) {
    $folder = Get-Item -LiteralPath $destination -Force
    if ($folder.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw '安装目录是重解析点，请检查目录后重试。'
    }
    if (!(Get-ChildItem -LiteralPath $destination -Force)) {
        Remove-Item -LiteralPath $destination
        if (Test-Path -LiteralPath $destination) { throw '未能移除旧版卸载留下的空目录。' }
    }
}
if (Test-Path -LiteralPath $destination) {
    $null = Read-PackageManifest $destination
    if ((Get-FileHash -LiteralPath (Join-Path $destination $manifestName)).Hash -ne
        (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $manifestName)).Hash) {
        throw '已安装其他版本，请先从开始菜单卸载旧版。'
    }
} else {
    $stage = Join-Path $root ('CodexDshStatsStandalone.install-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    try {
        foreach ($path in ($files + $manifestName)) {
            $target = Join-Path $stage $path
            New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
            Copy-Item -LiteralPath (Join-Path $PSScriptRoot $path) -Destination $target
        }
        $null = Read-PackageManifest $stage
        if ((Split-Path (Resolve-Path -LiteralPath $stage).Path) -ne $root -or
            (Split-Path $destination) -ne $root -or (Test-Path -LiteralPath $destination)) {
            throw '安装目录已变化，请重试。'
        }
        Move-Item -LiteralPath $stage -Destination $destination
        if (Test-Path -LiteralPath $stage) { throw '安装目录未能移动。' }
        $null = Read-PackageManifest $destination
    } finally {
        if (Test-Path -LiteralPath $stage -PathType Container) { Remove-PackageFiles $stage }
    }
}
foreach ($entry in $links.GetEnumerator()) {
    $link = Join-Path $programs $entry.Key
    $shortcut = $shell.CreateShortcut($link)
    $shortcut.TargetPath = $entry.Value.Target
    $shortcut.Arguments = $entry.Value.Arguments
    $shortcut.WorkingDirectory = $root
    $shortcut.Save()
    $saved = $shell.CreateShortcut($link)
    if ($saved.TargetPath -ne $shortcut.TargetPath -or $saved.Arguments -ne $shortcut.Arguments) {
        throw "入口验证失败：$link"
    }
}
Write-Host '安装完成。请在开始菜单打开「Codex 用量（独立测试版）」。'