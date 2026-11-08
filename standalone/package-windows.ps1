[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RuntimeDirectory,
    [Parameter(Mandatory)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot
$runtime = (Resolve-Path -LiteralPath $RuntimeDirectory).Path
$output = (Resolve-Path -LiteralPath $OutputDirectory).Path
$nodePath = Join-Path $runtime 'node.exe'
$expectedNodeHash = '1c331340fa6cac5e4294725959070a143fa0507195a78ad77eed7943f719aac9'
if ((Get-FileHash -LiteralPath $nodePath -Algorithm SHA256).Hash -ne $expectedNodeHash) {
    throw '需要官方 Node.js v24.22.2 Windows x64 node.exe，SHA-256 校验失败。'
}
$archive = Join-Path $output 'codex-dsh-stats-standalone-win-x64-v0.1.1-preview.zip'
if (Test-Path -LiteralPath $archive) { throw "发布文件已存在：$archive" }
$stage = Join-Path ([IO.Path]::GetTempPath()) ('codex-dsh-package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null

$files = [ordered]@{
    'Install.cmd' = (Join-Path $PSScriptRoot 'Install.cmd')
    'setup.ps1' = (Join-Path $PSScriptRoot 'setup.ps1')
    'Open-Codex.cmd' = (Join-Path $PSScriptRoot 'Open-Codex.cmd')
    'README.md' = (Join-Path $PSScriptRoot 'README.md')
    'LICENSE' = (Join-Path $project 'LICENSE')
    'LICENSE-DSH.txt' = (Join-Path $project 'LICENSE-DSH.txt')
    'runtime/node.exe' = $nodePath
    'runtime/LICENSE-Node.txt' = (Join-Path $runtime 'LICENSE-Node.txt')
    'dist/desktop-payload.js' = (Join-Path $project 'dist/desktop-payload.js')
}
foreach ($name in @('start-demo.ps1', 'attach.mjs', 'cdp.mjs', 'live-worker.mjs', 'rollout.mjs')) {
    $files["scripts/$name"] = Join-Path $project "scripts/$name"
}
$hashes = [ordered]@{}
try {
    foreach ($entry in $files.GetEnumerator()) {
        $target = Join-Path $stage $entry.Key
        New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
        Copy-Item -LiteralPath $entry.Value -Destination $target
        $hashes[$entry.Key] = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
        if ($hashes[$entry.Key] -ne (Get-FileHash -LiteralPath $entry.Value -Algorithm SHA256).Hash) {
            throw "复制校验失败：$($entry.Key)"
        }
    }
    $hashes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'sha256.json') -Encoding utf8
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $archive, [IO.Compression.CompressionLevel]::Optimal, $false)
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        if ($zip.Entries.Count -ne ($hashes.Count + 1)) { throw 'ZIP 文件数量与清单不一致。' }
        foreach ($path in $hashes.Keys) {
            $entry = $zip.GetEntry($path)
            if (!$entry) { throw "ZIP 缺少 $path" }
            $stream = $entry.Open()
            try {
                if ((Get-FileHash -InputStream $stream -Algorithm SHA256).Hash -ne $hashes[$path]) {
                    throw "ZIP 文件校验失败：$path"
                }
            } finally { $stream.Dispose() }
        }
    } finally { $zip.Dispose() }
    Get-FileHash -LiteralPath $archive -Algorithm SHA256
} finally {
    $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
    $expectedParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    if ((Split-Path $resolvedStage) -ne $expectedParent -or
        (Split-Path $resolvedStage -Leaf) -notmatch '^codex-dsh-package-[a-f0-9]{32}$') {
        throw "拒绝清理意外目录：$resolvedStage"
    }
    Remove-Item -LiteralPath $resolvedStage -Recurse
    if (Test-Path -LiteralPath $resolvedStage) { throw "未能清理打包目录：$resolvedStage" }
}