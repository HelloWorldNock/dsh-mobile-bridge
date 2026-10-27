<#
.SYNOPSIS
  在 Windows 宿主机上注册「DSH 发现中继」开机自启任务。

.DESCRIPTION
  虚拟机里的 DSH 桥接只能广播到 VMnet，手机收不到。本脚本让
  tools/discovery-relay.mjs 登录后常驻，在 48126/udp 上把手机的发现包
  转发给虚拟机，并把回包改写成宿主机地址。

  先编辑 tools/discovery-relay.json 里的 target / publicHost / publicPort /
  tailscaleHost，再运行本脚本。

  任务通过 wscript 隐藏窗口启动，不会在登录时弹出 node 控制台；
  中继的输出写到 tools/discovery-relay.log。
#>
[CmdletBinding()]
param(
    [string]$TaskName = 'DSH-Discovery-Relay',
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$relay = Join-Path $PSScriptRoot 'discovery-relay.mjs'
$config = Join-Path $PSScriptRoot 'discovery-relay.json'
$launcher = Join-Path $PSScriptRoot 'run-discovery-relay.vbs'

if ($Uninstall) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "已移除计划任务 $TaskName"
    return
}

if (-not (Test-Path $relay)) { throw "找不到 $relay" }
if (-not (Test-Path $config)) { throw "找不到 $config" }
if (-not (Test-Path $launcher)) { throw "找不到 $launcher" }

$node = (Get-Command node -ErrorAction Stop).Source
$wscript = (Get-Command wscript -ErrorAction Stop).Source

$actionArgs = @{
    Execute          = $wscript
    Argument         = '//nologo "' + $launcher + '" "' + $node + '"'
    WorkingDirectory = $PSScriptRoot
}
$action = New-ScheduledTaskAction @actionArgs

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"

$settingsArgs = @{
    AllowStartIfOnBatteries = $true
    DontStopIfGoingOnBatteries = $true
    RestartCount            = 3
    RestartInterval         = (New-TimeSpan -Minutes 1)
    ExecutionTimeLimit      = (New-TimeSpan -Days 3650)
}
$settings = New-ScheduledTaskSettingsSet @settingsArgs

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

$registerArgs = @{
    TaskName    = $TaskName
    Action      = $action
    Trigger     = $trigger
    Settings    = $settings
    Description = 'TS7 DSH Remote: forward UDP discovery from the LAN host to a NAT VM bridge.'
    Force       = $true
}
Register-ScheduledTask @registerArgs | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 1
$info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
Write-Host "已注册 $TaskName；状态 $(Get-ScheduledTask -TaskName $TaskName | Select-Object -ExpandProperty State)；上次结果 $($info.LastTaskResult)"
Write-Host "配置：$config"
