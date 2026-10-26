<#
.SYNOPSIS
  Publish dsh-mobile-bridge to GitHub: create repo, push main, tag vX.Y.Z, upload release assets.

.DESCRIPTION
  Idempotent: an existing repo, release or asset is reused / replaced instead of failing.
  Requires a token with `repo` scope (PAT or OAuth device-flow token).
  All HTTP and git traffic goes through -Proxy (default 127.0.0.1:7890).

.EXAMPLE
  powershell -NoProfile -File tools/publish-github.ps1 -Token $env:GH_TOKEN
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$Owner = 'HelloWorldNock',
  [string]$Repo = 'dsh-mobile-bridge',
  [string]$Version = '0.1.0',
  [string]$Proxy = 'http://127.0.0.1:7890'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$api = 'https://api.github.com'
$headers = @{
  Authorization          = "Bearer $Token"
  'User-Agent'           = 'dsh-mobile-bridge-publisher'
  'Accept'               = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
}

function Invoke-GitHub {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [string]$Method = 'Get',
    $Body
  )
  $params = @{ Uri = $Uri; Method = $Method; Headers = $headers; Proxy = $Proxy }
  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 6)
    $params.ContentType = 'application/json; charset=utf-8'
  }
  Invoke-RestMethod @params
}

# git writes progress to stderr; PowerShell 5.1 turns native stderr into a
# terminating error under $ErrorActionPreference = 'Stop'. Capture streams to
# files and judge by exit code instead.
function Invoke-Git {
  param([string[]]$GitArgs)
  $outFile = [IO.Path]::GetTempFileName()
  $errFile = [IO.Path]::GetTempFileName()
  $preference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & git @GitArgs 1> $outFile 2> $errFile
    [pscustomobject]@{
      Code = $LASTEXITCODE
      Out  = (Get-Content $outFile -Raw -ErrorAction SilentlyContinue)
      Err  = (Get-Content $errFile -Raw -ErrorAction SilentlyContinue)
    }
  } finally {
    $ErrorActionPreference = $preference
    Remove-Item $outFile, $errFile -Force -ErrorAction SilentlyContinue
  }
}

# --- 1. token identity -------------------------------------------------------
$me = Invoke-GitHub -Uri "$api/user"
Write-Output "token user : $($me.login)"
if ($me.login -ne $Owner) { throw "token belongs to $($me.login), expected $Owner" }

# --- 2. repository -----------------------------------------------------------
$repoExists = $false
try {
  $null = Invoke-GitHub -Uri "$api/repos/$Owner/$Repo"
  $repoExists = $true
  Write-Output "repo       : $Owner/$Repo (exists)"
} catch {
  Write-Output "repo       : $Owner/$Repo (will create)"
}

if (-not $repoExists) {
  $created = Invoke-GitHub -Uri "$api/user/repos" -Method Post -Body @{
    name        = $Repo
    description = 'Drive DeepSeek Harness from an Android phone on the same LAN: pairing-code bridge, prompts, tool approvals, plan review and notifications.'
    homepage    = ''
    private     = $false
    has_issues  = $true
    has_wiki    = $false
    has_projects = $false
  }
  Write-Output "created    : $($created.html_url)"
}

# --- 3. push main ------------------------------------------------------------
Push-Location $repoRoot
try {
  $remotes = @(git remote)
  if ($remotes -notcontains 'origin') {
    git remote add origin "https://github.com/$Owner/$Repo.git" | Out-Null
  }
  git config http.proxy $Proxy
  $b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$Token"))
  $pushArgs = @(
    '-c', "http.proxy=$Proxy",
    '-c', "http.https://github.com/.extraheader=AUTHORIZATION: basic $b64",
    'push', '-u', 'origin', 'main'
  )
  $push = Invoke-Git $pushArgs
  if ($push.Code -ne 0) { throw "git push failed:`n$($push.Err)`n$($push.Out)" }
  Write-Output "pushed     : main ($(($push.Err -split "`n" | Where-Object { $_ -match '->' }) -join ' '))"
} finally {
  Pop-Location
}

# --- 4. release --------------------------------------------------------------
$tag = "v$Version"
$notesPath = Join-Path $repoRoot "docs/RELEASE-$Version.md"
$notes = [IO.File]::ReadAllText($notesPath, [Text.Encoding]::UTF8)
$title = ($notes -split "`n")[0].TrimStart('#').Trim()

$release = $null
try {
  $release = Invoke-GitHub -Uri "$api/repos/$Owner/$Repo/releases/tags/$tag"
  Write-Output "release    : $tag (reusing #$($release.id))"
} catch {
  $release = Invoke-GitHub -Uri "$api/repos/$Owner/$Repo/releases" -Method Post -Body @{
    tag_name         = $tag
    target_commitish = 'main'
    name             = $title
    body             = $notes
    draft            = $false
    prerelease       = $false
  }
  Write-Output "release    : $tag (created #$($release.id))"
}

# --- 5. assets ---------------------------------------------------------------
$assets = @(
  @{ Path = (Join-Path $repoRoot "dist/dsh-mobile-bridge-$Version.tgz"); Name = "dsh-mobile-bridge-$Version.tgz" },
  @{ Path = (Join-Path $repoRoot "dist/TS7-DSH-Remote-$Version-debug.apk"); Name = "TS7-DSH-Remote-$Version-debug.apk" }
)

$sums = New-Object System.Collections.Generic.List[string]
foreach ($asset in $assets) {
  if (-not (Test-Path $asset.Path)) { throw "missing asset: $($asset.Path)" }
  $sums.Add("$((Get-FileHash $asset.Path -Algorithm SHA256).Hash.ToLower())  $($asset.Name)")
}
$sumsPath = Join-Path $repoRoot "dist/SHA256SUMS-$Version.txt"
[IO.File]::WriteAllText($sumsPath, ($sums -join "`n") + "`n", (New-Object Text.UTF8Encoding($false)))
Write-Output "checksums  : dist/SHA256SUMS-$Version.txt"

$assets += @{ Path = $sumsPath; Name = "SHA256SUMS-$Version.txt" }

$existing = Invoke-GitHub -Uri "$api/repos/$Owner/$Repo/releases/$($release.id)/assets"
foreach ($asset in $assets) {
  $old = @($existing) | Where-Object { $_.name -eq $asset.Name }
  if ($old) {
    Invoke-GitHub -Uri "$api/repos/$Owner/$Repo/releases/assets/$($old.id)" -Method Delete | Out-Null
    Write-Output "replaced   : $($asset.Name)"
  }
  $uri = "https://uploads.github.com/repos/$Owner/$Repo/releases/$($release.id)/assets?name=$($asset.Name)"
  $uploaded = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Proxy $Proxy `
    -ContentType 'application/octet-stream' -InFile $asset.Path
  Write-Output "uploaded   : $($asset.Name) ($($uploaded.size) bytes)"
}

# --- 6. market metadata placeholders ----------------------------------------
$contrib = @(
  (Join-Path $repoRoot 'contrib/awesome-dsh-plugin/dsh-mobile-bridge.yml'),
  (Join-Path $repoRoot 'contrib/dshmarket/plugins.json')
)
$changed = $false
foreach ($file in $contrib) {
  $text = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8)
  $next = $text.Replace('OWNER/REPO', "$Owner/$Repo").Replace('OWNER', $Owner).Replace('REPO', $Repo)
  if ($next -ne $text) {
    [IO.File]::WriteAllText($file, $next, (New-Object Text.UTF8Encoding($false)))
    $changed = $true
  }
}
if ($changed) {
  Push-Location $repoRoot
  try {
    git add contrib | Out-Null
    git commit -q -m "docs: point market metadata at $Owner/$Repo" | Out-Null
    $b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$Token"))
    $push = Invoke-Git @('-c', "http.proxy=$Proxy", '-c', "http.https://github.com/.extraheader=AUTHORIZATION: basic $b64", 'push', 'origin', 'main')
    if ($push.Code -ne 0) { throw "git push (contrib) failed:`n$($push.Err)" }
    Write-Output 'pushed     : contrib placeholders resolved'
  } finally {
    Pop-Location
  }
}

Write-Output ''
Write-Output "repo    : https://github.com/$Owner/$Repo"
Write-Output "release : https://github.com/$Owner/$Repo/releases/tag/$tag"
Write-Output "install : dsh plugin --profile desktop add file:.<download>\dsh-mobile-bridge-$Version.tgz"
