<#
.SYNOPSIS
  校验 APK 的签名（G05 门禁），输出证书指纹并按结果返回退出码。

.DESCRIPTION
  用 Android SDK 的 apksigner 检查一个或多个 APK：
   - 未签名 / 只签了旧 scheme → 退出码 1；
   - 已签名 → 打印签名方案（v1/v2/v3）、证书 DN 与 SHA-256 指纹，退出码 0。

  默认只校验 debug 包也能过（debug 用 Android Debug 证书）；想确认发布包用的是自己的
  证书，加 -ExpectCommonName，或直接看输出的 DN。

.EXAMPLE
  powershell -NoProfile -File tools/verify-apk-signature.ps1
  powershell -NoProfile -File tools/verify-apk-signature.ps1 -Apk dist\TS7-DSH-Remote-0.9.11-arm64-v8a-debug.apk
  powershell -NoProfile -File tools/verify-apk-signature.ps1 -Apk <rel.apk> -ExpectCommonName "CN=TS7 DSH Remote"
#>
[CmdletBinding()]
param(
  [string[]]$Apk,
  [string]$ExpectCommonName,
  [string]$BuildToolsVersion = '35.0.0'
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$signer = Join-Path $repo ".toolchain\android-sdk\build-tools\$BuildToolsVersion\apksigner.bat"
if (-not (Test-Path $signer)) {
  $found = Get-ChildItem (Join-Path $repo '.toolchain\android-sdk\build-tools') -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
  if ($null -eq $found) { throw '找不到 build-tools（先跑 tools/setup-toolchain.ps1）' }
  $signer = Join-Path $found.FullName 'apksigner.bat'
  Write-Output "使用 build-tools $($found.Name)"
}

if (-not $Apk -or $Apk.Count -eq 0) {
  $Apk = Get-ChildItem (Join-Path $repo 'dist') -Filter 'TS7-DSH-Remote-*-debug.apk' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 3 -ExpandProperty FullName
}
if (-not $Apk -or $Apk.Count -eq 0) { throw '没有可校验的 APK：用 -Apk 指定，或先把产物放进 dist\' }

$failed = 0
foreach ($path in $Apk) {
  if (-not (Test-Path $path)) { Write-Output "✖ 找不到 $path"; $failed += 1; continue }
  $output = & $signer verify --print-certs $path 2>&1
  $code = $LASTEXITCODE
  $lines = @($output | ForEach-Object { $_.ToString() })

  if ($code -ne 0) {
    Write-Output "✖ $([System.IO.Path]::GetFileName($path))：未签名或校验失败"
    $lines | Where-Object { $_ -match 'ERROR|DOES NOT VERIFY' } | Select-Object -First 2 | ForEach-Object { Write-Output "   $_" }
    $failed += 1
    continue
  }

  $dn = ($lines | Where-Object { $_ -match 'certificate DN' } | Select-Object -First 1) -replace '^.*certificate DN:\s*', ''
  $sha = ($lines | Where-Object { $_ -match 'SHA-256 digest' } | Select-Object -First 1) -replace '^.*SHA-256 digest:\s*', ''
  $schemes = & $signer verify --verbose $path 2>&1 | Where-Object { $_ -match 'Verified using v\d' } | ForEach-Object { ($_ -split ' ')[0..3] -join ' ' }

  Write-Output "✔ $([System.IO.Path]::GetFileName($path))"
  Write-Output "   DN     : $dn"
  Write-Output "   SHA-256: $sha"
  if ($schemes) { Write-Output "   方案   : $((($schemes -join '; ')))" }

  if ($ExpectCommonName -and ($dn -notlike "*$ExpectCommonName*")) {
    Write-Output "   ✖ 证书 DN 与期望不符（期望包含 $ExpectCommonName）"
    $failed += 1
  }
}

if ($failed -gt 0) {
  Write-Output ''
  Write-Output "FAIL：$failed 个 APK 未通过签名校验"
  exit 1
}
Write-Output ''
Write-Output 'PASS：全部 APK 已签名'
