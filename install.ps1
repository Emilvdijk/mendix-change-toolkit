# Install the Mendix change-review toolkit + skills (Windows / PowerShell).
#
#   powershell -ExecutionPolicy Bypass -File install.ps1
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Project
#
# Safe to re-run: it overwrites its own files and touches nothing else.
param([switch]$Project)

$Src = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Project) {
    $Root = (git rev-parse --show-toplevel 2>$null)
    if (-not $Root) { Write-Error "not in a git repository"; exit 1 }
    $Dest = Join-Path $Root ".claude"
    $Scope = "project ($Root)"
} else {
    $Dest = Join-Path $env:USERPROFILE ".claude"
    $Scope = "user ($env:USERPROFILE)"
}

Write-Host "Installing mendix-change-toolkit -> $Scope"

New-Item -ItemType Directory -Force -Path (Join-Path $Dest "mxdiff")  | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Dest "skills")  | Out-Null

Copy-Item -Force -Path (Join-Path $Src "tools\*") -Destination (Join-Path $Dest "mxdiff")
Write-Host "  tools  -> $(Join-Path $Dest 'mxdiff')"

foreach ($d in Get-ChildItem -Directory (Join-Path $Src "skills")) {
    $target = Join-Path $Dest "skills\$($d.Name)"
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item -Force -Path (Join-Path $d.FullName "SKILL.md") -Destination $target
    Write-Host "  skill  -> $target"
}

Write-Host ""
Write-Host "Checking dependencies..."
& bash (Join-Path $Dest "mxdiff/doctor.sh")

Write-Host @"

Installed skills:
  /mendix-review            code review of a commit range
  /mendix-test-instructions test steps derived from what actually changed
  /mendix-change-notes      customer/team-facing change note
  /mendix-change-report     all three in one pass

Note: the tools are bash scripts. Git for Windows (Git Bash) provides the required
bash, and is already a dependency of any Mendix git workflow.
"@
