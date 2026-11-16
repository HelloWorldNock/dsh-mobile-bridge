<#
.SYNOPSIS
  跑 Android 侧的 JVM 单测（`app/src/test`）。

.DESCRIPTION
  仓库路径里带中文时，Gradle 的 test worker 会起不来：
    ClassNotFoundException: worker.org.gradle.process.internal.worker.GradleWorkerMain
  原因是 worker 的 classpath 通过 `@<argfile>` 传给子 JVM，非 ASCII 路径下取不到。

  这个脚本先建两个 ASCII 路径的 junction（项目根 + GRADLE_USER_HOME），再从 junction
  跑 `:app:testDebugUnitTest`。Junction 只建一次，之后复用。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-android.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-android.ps1 -Info
#>
[CmdletBinding()]
param(
  [string]$ProjectLink = 'C:\dshproj',
  [string]$GradleHomeLink = 'C:\dshgh',
  [switch]$Info
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$toolchain = Join-Path $repo '.toolchain'
$gradleHome = Join-Path $toolchain 'gradle-home'

function Ensure-Junction([string]$link, [string]$target) {
  if (Test-Path $link) { return }
  $result = cmd /c "mklink /J `"$link`" `"$target`"" 2>&1
  if (-not (Test-Path $link)) { throw "无法创建 junction ${link} -> ${target}：$result" }
}

Ensure-Junction $ProjectLink $repo
Ensure-Junction $GradleHomeLink $gradleHome

$env:JAVA_HOME = Join-Path $toolchain 'jdk-17'
$env:ANDROID_HOME = Join-Path $toolchain 'android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = $GradleHomeLink

$args2 = @(':app:testDebugUnitTest', '--console=plain', '--no-daemon')
if ($Info) { $args2 += '--info' }

Push-Location (Join-Path $ProjectLink 'android')
try {
  & '.\gradlew.bat' @args2
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}

$results = Join-Path $ProjectLink 'android\app\build\test-results\testDebugUnitTest'
if (Test-Path $results) {
  $total = 0
  $failed = 0
  Get-ChildItem $results -Filter '*.xml' | ForEach-Object {
    [xml]$doc = Get-Content $_.FullName -Raw -Encoding UTF8
    $total += [int]$doc.testsuite.tests
    $failed += [int]$doc.testsuite.failures + [int]$doc.testsuite.errors
    Write-Output ("{0}: tests={1} failures={2}" -f $doc.testsuite.name, $doc.testsuite.tests, ([int]$doc.testsuite.failures + [int]$doc.testsuite.errors))
  }
  Write-Output ("总计 {0} 个用例，失败 {1}" -f $total, $failed)
}

exit $code
