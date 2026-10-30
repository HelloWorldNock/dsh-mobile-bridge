<#
.SYNOPSIS
  Poll GitHub's OAuth device flow until the user approves, then store the access token.

.DESCRIPTION
  Pairs with the device code request:
    POST https://github.com/login/device/code  { client_id, scope }
  The user opens verification_uri, enters user_code, and this script writes the token to -OutFile.

.EXAMPLE
  powershell -NoProfile -File tools/device-login.ps1 -DeviceCode 0abc... -OutFile "$env:TEMP\gh-token.txt"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DeviceCode,
  [string]$ClientId = '178c6fc778ccc68e1d6a',
  [string]$Proxy = (if ($env:HTTPS_PROXY) { $env:HTTPS_PROXY } else { 'http://127.0.0.1:7890' }),
  [int]$TimeoutSec = 870,
  [string]$OutFile = (Join-Path $env:TEMP 'gh-device-token.txt')
)

$ErrorActionPreference = 'Stop'
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$interval = 5
Write-Output "polling    : every ${interval}s, up to ${TimeoutSec}s"

while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds $interval
  $body = @{
    client_id   = $ClientId
    device_code = $DeviceCode
    grant_type  = 'urn:ietf:params:oauth:grant-type:device_code'
  }
  try {
    $resp = Invoke-RestMethod -Uri 'https://github.com/login/oauth/access_token' -Method Post `
      -Body $body -Headers @{ Accept = 'application/json' } -Proxy $Proxy
  } catch {
    Write-Output "retry      : $($_.Exception.Message)"
    continue
  }

  if ($resp.access_token) {
    [IO.File]::WriteAllText($OutFile, $resp.access_token, (New-Object Text.UTF8Encoding($false)))
    $headers = @{ Authorization = "Bearer $($resp.access_token)"; 'User-Agent' = 'dsh-mobile-bridge-device-login' }
    $me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $headers -Proxy $Proxy
    Write-Output "TOKEN_READY user=$($me.login) scope=$($resp.scope)"
    Write-Output "written    : $OutFile"
    exit 0
  }

  switch ($resp.error) {
    'authorization_pending' { continue }
    'slow_down' { $interval += 5; Write-Output "slowed     : interval now ${interval}s"; continue }
    'expired_token' { throw 'device code expired before approval' }
    'access_denied' { throw 'authorization was denied' }
    default { Write-Output "wait       : $($resp.error)" }
  }
}

throw "no approval within ${TimeoutSec}s"
