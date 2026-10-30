# Builds the embedded Tailscale node helper (host/tsnode) for one target.
#
# Usage (from the repo root, works in PowerShell 5.1 and 7):
#   pwsh -File tools/build-tsnode.ps1
#   pwsh -File tools/build-tsnode.ps1 -Goos windows -Arch arm64
#
# The helper is a small Go program around tailscale.com/tsnet. It runs as a
# child process of the bridge plugin, joins the tailnet and forwards tailnet
# TCP traffic to the local bridge port, so the PC does not need the Tailscale
# client installed.
#
# Requires a Go toolchain that can satisfy host/tsnode/go.mod. The module cache
# in <repo>/.toolchain/go-home already contains every dependency, so the default
# run is fully offline (GOPROXY=off). Pass -Online to allow module downloads.

[CmdletBinding()]
param(
  [ValidateSet('windows', 'linux', 'darwin')]
  [string]$Goos = 'windows',

  [ValidateSet('amd64', 'arm64', '386')]
  [string]$Arch = 'amd64',

  [switch]$Online,

  [string]$GoExe = ''
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repo 'host\tsnode'
$outDir = Join-Path $repo 'host\bin'
$suffix = if ($Goos -eq 'windows') { '.exe' } else { '' }
$output = Join-Path $outDir "tsnode-$Goos-$Arch$suffix"

if (-not (Test-Path -LiteralPath (Join-Path $source 'go.mod'))) {
  throw "missing $source\go.mod"
}

if ($GoExe -eq '') {
  $candidates = @(
    (Join-Path $repo '.toolchain\go\bin\go.exe'),
    (Join-Path $repo '.toolchain\go\bin\go')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { $GoExe = $candidate; break }
  }
  if ($GoExe -eq '') {
    $command = Get-Command go -ErrorAction SilentlyContinue
    if ($null -ne $command) { $GoExe = $command.Source }
  }
  if ($GoExe -eq '') { throw 'no go toolchain found; install Go or run tools/setup-toolchain.ps1' }
}

$env:GOPATH = Join-Path $repo '.toolchain\go-home'
$env:GOTOOLCHAIN = 'go1.26.0'
$env:CGO_ENABLED = '0'
$env:GOOS = $Goos
$env:GOARCH = $Arch
$env:GOFLAGS = '-mod=mod'
if ($Online) {
  Remove-Item Env:\GOPROXY -ErrorAction SilentlyContinue
} else {
  $env:GOPROXY = 'off'
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Write-Host "go:      $GoExe"
Write-Host "target:  $Goos/$Arch"
Write-Host "output:  $output"

Push-Location $source
try {
  & $GoExe build -trimpath -ldflags '-s -w' -o $output .
  if ($LASTEXITCODE -ne 0) { throw "go build failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

$file = Get-Item -LiteralPath $output
Write-Host ("built:   {0} ({1:N0} bytes)" -f $file.FullName, $file.Length)
