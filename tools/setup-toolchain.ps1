$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tc = Join-Path $root '.toolchain'
$sdk = Join-Path $tc 'android-sdk'
$log = Join-Path $root 'tools\setup-toolchain.log'
New-Item -ItemType Directory -Force -Path $tc, (Join-Path $root 'tools') | Out-Null
Set-Content -Path $log -Value "toolchain setup $(Get-Date -Format o)"

function Log([string]$message) {
  $line = "$(Get-Date -Format 'HH:mm:ss') $message"
  Add-Content -Path $log -Value $line
  Write-Host $line
}

function Fetch([string]$url, [string]$out) {
  if ((Test-Path $out) -and ((Get-Item $out).Length -gt 1MB)) {
    Log "have $(Split-Path $out -Leaf) ($([math]::Round((Get-Item $out).Length / 1MB, 1)) MB)"
    return
  }
  Log "download $url"
  & curl.exe -L --fail --retry 3 --connect-timeout 20 --max-time 1800 -sS -o $out $url
  if ($LASTEXITCODE -ne 0) { throw "curl failed ($LASTEXITCODE) for $url" }
  $size = (Get-Item $out).Length
  Log "downloaded $(Split-Path $out -Leaf): $([math]::Round($size / 1MB, 1)) MB"
  if ($size -lt 10MB) { throw "download too small: $out" }
}

# JDK 17
$jdkZip = Join-Path $tc 'jdk17.zip'
Fetch 'https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/x64/windows/OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip' $jdkZip
$jdk = Join-Path $tc 'jdk-17'
if (-not (Test-Path (Join-Path $jdk 'bin\java.exe'))) {
  Log 'extract JDK'
  $tmp = Join-Path $tc 'jdk-extract'
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  & tar.exe -xf $jdkZip -C $tmp
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  if ($null -eq $inner) { throw 'JDK zip did not contain a directory' }
  Move-Item $inner.FullName $jdk
  Remove-Item -Recurse -Force $tmp
}
$env:JAVA_HOME = $jdk
$env:Path = "$jdk\bin;$env:Path"
Log (& "$jdk\bin\java.exe" -version 2>&1 | Select-Object -First 1)

# Gradle 8.9
$gradleZip = Join-Path $tc 'gradle-8.9-bin.zip'
Fetch 'https://mirrors.cloud.tencent.com/gradle/gradle-8.9-bin.zip' $gradleZip
$gradleHome = Join-Path $tc 'gradle-8.9'
if (-not (Test-Path (Join-Path $gradleHome 'bin\gradle.bat'))) {
  Log 'extract Gradle'
  & tar.exe -xf $gradleZip -C $tc
}
Log (& "$gradleHome\bin\gradle.bat" --version 2>&1 | Select-String -Pattern '^Gradle ' | Select-Object -First 1)

# Android SDK packages
$sdkmanager = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path $sdkmanager)) { throw "sdkmanager missing at $sdkmanager" }
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
Log 'accept SDK licenses'
$yes = (1..40 | ForEach-Object { 'y' }) -join "`n"
$yes | & $sdkmanager --sdk_root=$sdk --licenses 2>&1 | Select-Object -Last 5 | ForEach-Object { Log $_ }
Log 'install platform-tools, android-35, build-tools 35.0.0'
& $sdkmanager --sdk_root=$sdk 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0' 2>&1 | Select-Object -Last 8 | ForEach-Object { Log $_ }
Log (& $sdkmanager --sdk_root=$sdk --version)
Log 'toolchain ready'
