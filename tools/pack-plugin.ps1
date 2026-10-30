<#
.SYNOPSIS
  打包 dsh-mobile-bridge 为可分发的 tgz，并校验清单。

.DESCRIPTION
  在 host/ 下执行 npm pack，产物写到 dist/。打包前后各检查一次：
  图标 <= 256 KiB、locale 与 icon 在 files 允许列表内、tgz 里包含插件运行所需文件。
  默认不联网、不发布、不改任何 profile。

.EXAMPLE
  powershell -NoProfile -File tools/pack-plugin.ps1
  powershell -NoProfile -File tools/pack-plugin.ps1 -Destination F:\tmp
#>
[CmdletBinding()]
param(
  [string]$Destination
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Destination)) { $Destination = Join-Path $PSScriptRoot '..\dist' }

$repo = Split-Path -Parent $PSScriptRoot
$pkgDir = Join-Path $repo 'host'
$manifestPath = Join-Path $pkgDir 'package.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$name = $manifest.name
$version = $manifest.version

$icon = Join-Path $pkgDir 'icon.png'
if (-not (Test-Path $icon)) { throw "缺少插件图标：$icon" }
$iconBytes = (Get-Item $icon).Length
if ($iconBytes -gt 262144) { throw "图标 $iconBytes 字节，超过 256 KiB 上限" }
$manifestRaw = Get-Content $manifestPath -Raw
if ($manifestRaw -notmatch '"locale"') { throw 'package.json 的 files 未包含 locale' }
if ($manifestRaw -notmatch '"icon\.png"') { throw 'package.json 的 files 未包含 icon.png' }

New-Item -ItemType Directory -Force -Path $Destination | Out-Null

Push-Location $pkgDir
try {
  $packed = & npm pack --pack-destination $Destination --json
  if ($LASTEXITCODE -ne 0) { throw "npm pack 失败：$packed" }
  $json = ($packed | Out-String).Trim()
  $info = @(ConvertFrom-Json $json)[0]
} finally {
  Pop-Location
}

$tarball = Join-Path (Resolve-Path $Destination).Path $info.filename
$files = @($info.files.path)
$required = @('package.json', 'lib/index.js', 'lib/client.js', 'lib/tailscale.js', 'cordis.patch.yml',
  'icon.png', 'locale/en.json', 'locale/zh.json', 'README.md', 'LICENSE')
$missing = @($required | Where-Object { $files -notcontains $_ })
if ($missing.Count -gt 0) { throw "tgz 缺少文件：$($missing -join ', ')" }

$tsnodeBin = Join-Path $pkgDir 'bin\tsnode-windows-amd64.exe'
if (-not (Test-Path $tsnodeBin)) {
  Write-Output '注意：未找到 host\bin\tsnode-windows-amd64.exe，内置 Tailscale 节点在面板里会显示「缺少节点程序」。'
  Write-Output '      先运行 tools/build-tsnode.ps1 再打包。'
} elseif ($files -notcontains 'bin/tsnode-windows-amd64.exe') {
  throw 'tgz 缺少 bin/tsnode-windows-amd64.exe（package.json 的 files 需包含 bin）'
}

Write-Output "package : $name@$version"
Write-Output "tarball : $tarball"
Write-Output "size    : $((Get-Item $tarball).Length) 字节 / $($files.Count) 个文件"
Write-Output "icon    : $iconBytes 字节"
Write-Output ''
Write-Output '装到某个 profile（之后还需把包名加入该 profile 的 dsh.profile.bundles）：'
Write-Output "  dsh plugin --profile <profile> add file:$tarball"
Write-Output '发布到 npm：'
Write-Output "  cd `"$pkgDir`""
Write-Output '  npm publish'
