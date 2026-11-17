<#
.SYNOPSIS
  生成 Android 发布签名密钥，并写好 android/keystore.properties。

.DESCRIPTION
  发布私钥不进仓库（`.gitignore` 已挡 `*.jks` 与 `android/keystore.properties`），
  所以由仓库主人跑一次这个脚本：
   - 默认生成到 `<repo>\.toolchain\keystore\release.jks`（已在 gitignore 的目录里）；
   - 口令默认随机 28 位，写进 `android/keystore.properties`（同样被 gitignore）；
   - 已存在的密钥不会被覆盖，除非显式传 -Force。

  生成后 `gradlew :app:assembleRelease` 就会自动用它签名（build.gradle.kts 检测到
  `android/keystore.properties` 才启用 signingConfigs.release）。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/make-keystore.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/make-keystore.ps1 -Alias my-key -Validity 3650
#>
[CmdletBinding()]
param(
  [string]$Alias = 'dsh-remote',
  [int]$Validity = 10000,
  [string]$DistinguishedName = 'CN=TS7 DSH Remote, OU=Personal, O=TS7, L=Local, S=Local, C=CN',
  [string]$Password,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$keytool = Join-Path $repo '.toolchain\jdk-17\bin\keytool.exe'
if (-not (Test-Path $keytool)) { throw "找不到 keytool：$keytool（先跑 tools/setup-toolchain.ps1）" }

$keyDir = Join-Path $repo '.toolchain\keystore'
$keystore = Join-Path $keyDir 'release.jks'
$propsPath = Join-Path $repo 'android\keystore.properties'

New-Item -ItemType Directory -Force -Path $keyDir | Out-Null

if ((Test-Path $keystore) -and -not $Force) {
  throw "密钥已存在：$keystore。要重新生成请显式传 -Force（旧签名一旦丢失，已发布的 App 无法升级覆盖）。"
}

if ([string]::IsNullOrWhiteSpace($Password)) {
  $chars = (48..57) + (65..90) + (97..122)
  $Password = -join (1..28 | ForEach-Object { [char]($chars | Get-Random) })
}

& $keytool -genkeypair -v `
  -keystore $keystore `
  -alias $Alias `
  -keyalg RSA -keysize 2048 `
  -validity $Validity `
  -storepass $Password -keypass $Password `
  -dname $DistinguishedName
if ($LASTEXITCODE -ne 0) { throw "keytool 失败（退出码 $LASTEXITCODE）" }

# properties 必须是纯 ASCII：Java 的 Properties.load(InputStream) 按 ISO-8859-1 解码，
# 仓库路径含中文时会被读成 '????'，Gradle 随后报 "Keystore file ... not found"。
# 解法：路径里有非 ASCII 就用 ASCII junction（C:\dshroot → 仓库根）作为访问路径。
$propsStorePath = $keystore -replace '\\', '/'
if ($propsStorePath -match '[^\x00-\x7F]') {
  $junction = 'C:\dshroot'
  if (-not (Test-Path $junction)) {
    cmd /c mklink /J "$junction" "$repo" | Out-Null
    Write-Output "已创建 ASCII junction：$junction → $repo"
  }
  $propsStorePath = "$($junction -replace '\\','/')/.toolchain/keystore/release.jks"
  Write-Output '注意：仓库路径含中文，properties 里改写为 ASCII junction 路径（Gradle 才能读到）'
}

$props = @(
  "storeFile=$propsStorePath"
  "storePassword=$Password"
  "keyAlias=$Alias"
  "keyPassword=$Password"
) -join "`n"
Set-Content -Path $propsPath -Value $props -Encoding ASCII -NoNewline

Write-Output ''
Write-Output "密钥      : $keystore"
Write-Output "配置      : $propsPath（已 gitignore）"
Write-Output "别名      : $Alias · 有效期 $Validity 天"
Write-Output ''
Write-Output '下一步：'
Write-Output '  cd android; .\gradlew.bat :app:assembleRelease --no-daemon'
Write-Output '  powershell -NoProfile -File tools/verify-apk-signature.ps1 -Apk android\app\build\outputs\apk\release\app-arm64-v8a-release.apk'
Write-Output ''
Write-Output '注意：这个 .jks 与口令丢了就再也发不出「同签名」的升级包，请离线备份。'
