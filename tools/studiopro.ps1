<#
.SYNOPSIS
  Open, close and inspect the Studio Pro instance that holds one project.

.DESCRIPTION
  Studio Pro records the process holding a project in `<App>.mpr.lock`, next to
  the .mpr:

      {"SessionId":"57fd8ae1-...","ProcessId":4680}

  That file is the ONLY reliable project -> process mapping. Two instances on two
  different copies of the same app show the IDENTICAL window title
  ("App (Main line ('main'), Git)"), so anything that picks a process by title,
  or by "the studiopro.exe that is running", will eventually close the wrong one
  — including the developer's own work.

  Every subcommand here therefore resolves the PID from the lock file of the
  project it was given, and touches nothing else.

  CLOSING IS ALWAYS GRACEFUL. This script sends WM_CLOSE (CloseMainWindow) and
  waits. It never calls Kill, because a killed Studio Pro skips its shutdown work
  and leaves the lock file behind with a dead PID. If the close does not complete
  — almost always an unsaved-changes or confirmation dialog waiting for a human —
  the script exits non-zero and says so. Deciding what to do about a dialog is
  the developer's, not the agent's.

.PARAMETER Action
  status | open | close

.PARAMETER Project
  Path to the .mpr (or to the folder containing exactly one).

.EXAMPLE
  pwsh -File studiopro.ps1 status "C:\...\MyApp\MyApp.mpr"
  pwsh -File studiopro.ps1 close  "C:\...\MyApp\MyApp.mpr"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('status', 'open', 'close')]
  [string]$Action,

  [Parameter(Mandatory = $true, Position = 1)]
  [string]$Project,

  # Open: how long to wait for the project to finish loading. A cold start on a
  # real app measured ~16s to the lock file and longer to a usable window.
  [int]$OpenTimeoutSec = 180,

  # Close: how long to wait for the process to exit after WM_CLOSE. A clean close
  # measured 1.5s; anything past a few seconds means a dialog is up.
  [int]$CloseTimeoutSec = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-Mpr([string]$p) {
  if (-not (Test-Path $p)) { throw "project path not found: $p" }
  $item = Get-Item $p
  if ($item.PSIsContainer) {
    $mprs = @(Get-ChildItem $item.FullName -Filter *.mpr -File)
    if ($mprs.Count -eq 0) { throw "no .mpr in $($item.FullName)" }
    if ($mprs.Count -gt 1) { throw "more than one .mpr in $($item.FullName); name the file" }
    return $mprs[0].FullName
  }
  if ($item.Extension -ne '.mpr') { throw "not a .mpr: $($item.FullName)" }
  return $item.FullName
}

# The holder of a project: the PID in its lock file, if that process is alive.
# A lock naming a dead PID is STALE — Studio Pro was killed or crashed — and is
# reported as such rather than silently ignored, because a stale lock is also the
# signature of a close that did not run its shutdown work.
function Get-Holder([string]$mpr) {
  $lock = "$mpr.lock"
  $res = [ordered]@{ Mpr = $mpr; Lock = $lock; LockExists = (Test-Path $lock)
                     ProcessId = $null; Alive = $false; Stale = $false; Title = $null }
  if (-not $res.LockExists) { return [pscustomobject]$res }
  try { $data = Get-Content $lock -Raw | ConvertFrom-Json } catch { $res.Stale = $true; return [pscustomobject]$res }
  if (-not $data.PSObject.Properties.Name.Contains('ProcessId')) { $res.Stale = $true; return [pscustomobject]$res }
  $res.ProcessId = [int]$data.ProcessId
  $proc = Get-Process -Id $res.ProcessId -ErrorAction SilentlyContinue
  # Guard against PID reuse: the holder must actually be a Studio Pro.
  if ($proc -and $proc.ProcessName -eq 'studiopro') { $res.Alive = $true; $res.Title = $proc.MainWindowTitle }
  else { $res.Stale = $true }
  return [pscustomobject]$res
}

# Windows already knows how to open a .mpr, and the association points at the
# Version Selector, which picks the Studio Pro matching the project's own version.
# Reading it beats hardcoding a path on a machine with several versions installed.
function Get-OpenCommand {
  foreach ($root in @('HKLM:\SOFTWARE\Classes', 'HKCU:\SOFTWARE\Classes')) {
    $k = Join-Path $root '.mpr'
    if (-not (Test-Path $k)) { continue }
    $progId = (Get-ItemProperty $k).'(default)'
    if (-not $progId) { continue }
    $cmdKey = Join-Path $root "$progId\shell\open\command"
    if (-not (Test-Path $cmdKey)) { continue }
    $cmd = (Get-ItemProperty $cmdKey).'(default)'
    if ($cmd -match '^\s*"([^"]+)"\s*(.*)$') { return @{ Exe = $Matches[1]; Args = $Matches[2] } }
  }
  throw 'no .mpr file association found; is Studio Pro installed?'
}

$mpr = Resolve-Mpr $Project

switch ($Action) {

  'status' {
    $h = Get-Holder $mpr
    if (-not $h.LockExists)      { Write-Output "closed: no lock file"; exit 0 }
    if ($h.Stale)                { Write-Output "STALE LOCK: $($h.Lock) names pid $($h.ProcessId), which is not a running Studio Pro."; exit 3 }
    Write-Output "open: pid $($h.ProcessId), title '$($h.Title)'"
    exit 0
  }

  'open' {
    $h = Get-Holder $mpr
    if ($h.Alive) { Write-Output "already open: pid $($h.ProcessId)"; exit 0 }
    if ($h.Stale) {
      # Left by a crash or a kill. Studio Pro will not open the project while it
      # is there, and removing it is safe precisely because the named process is
      # gone — which Get-Holder has just confirmed.
      Write-Output "removing stale lock (pid $($h.ProcessId) is gone)"
      Remove-Item $h.Lock -Force
    }

    $open = Get-OpenCommand
    $argline = $open.Args.Replace('%1', $mpr)
    Write-Output "launching: $($open.Exe) $argline"
    Start-Process -FilePath $open.Exe -ArgumentList $argline | Out-Null

    # Readiness is NOT the lock file. Measured: a project that failed to load
    # ("incorrectly initialized for Git") still produced a lock file and left
    # Studio Pro sitting on an empty window. The usable signal is a main window
    # whose title names the project rather than the bare product name.
    $t0 = Get-Date
    $deadline = $t0.AddSeconds($OpenTimeoutSec)
    while ((Get-Date) -lt $deadline) {
      $h = Get-Holder $mpr
      if ($h.Alive -and $h.Title -and $h.Title -ne 'Mendix Studio Pro') {
        $el = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
        Write-Output "open: pid $($h.ProcessId) after ${el}s, title '$($h.Title)'"
        exit 0
      }
      Start-Sleep -Milliseconds 500
    }
    $h = Get-Holder $mpr
    if ($h.Alive) {
      Write-Output "TIMEOUT after ${OpenTimeoutSec}s: pid $($h.ProcessId) is running but has not loaded the project (title '$($h.Title)')."
      Write-Output "Studio Pro may be showing an error dialog. Ask the developer to look."
      exit 2
    }
    Write-Output "TIMEOUT after ${OpenTimeoutSec}s: no Studio Pro took the project."
    exit 2
  }

  'close' {
    $h = Get-Holder $mpr
    if (-not $h.LockExists) { Write-Output 'already closed: no lock file'; exit 0 }
    if ($h.Stale) {
      Write-Output "STALE LOCK: $($h.Lock) names pid $($h.ProcessId), which is not running."
      Write-Output 'Studio Pro did not shut down cleanly. Leave the file for the developer to judge.'
      exit 3
    }

    $proc = Get-Process -Id $h.ProcessId
    Write-Output "closing pid $($h.ProcessId) ('$($h.Title)')"
    $t0 = Get-Date
    $null = $proc.CloseMainWindow()      # WM_CLOSE: the same thing clicking X does
    $deadline = $t0.AddSeconds($CloseTimeoutSec)
    while ((Get-Date) -lt $deadline -and -not $proc.HasExited) {
      Start-Sleep -Milliseconds 250
      $proc.Refresh()
    }

    if (-not $proc.HasExited) {
      $el = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
      Write-Output "DID NOT CLOSE after ${el}s. Studio Pro is still running (pid $($h.ProcessId))."
      Write-Output 'That almost always means a dialog is waiting for a person — unsaved changes, or a'
      Write-Output 'confirmation. This script will not force it: killing Studio Pro skips its shutdown'
      Write-Output 'work. Ask the developer to look at the window.'
      exit 2
    }

    # The lock is removed by Studio Pro on the way out, and can lag the exit.
    $d2 = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $d2 -and (Test-Path $h.Lock)) { Start-Sleep -Milliseconds 250 }
    $el = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)

    if (Test-Path $h.Lock) {
      Write-Output "closed after ${el}s, BUT the lock file is still there: $($h.Lock)"
      Write-Output 'The process exited without clearing it. Treat the project as suspect and tell the developer.'
      exit 3
    }
    Write-Output "closed cleanly after ${el}s; lock released"
    exit 0
  }
}
