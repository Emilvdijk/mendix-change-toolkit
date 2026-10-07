# Install the Mendix change-review toolkit + skills (Windows / PowerShell).
#
#   powershell -ExecutionPolicy Bypass -File install.ps1
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Project
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Link      <- recommended
#
# Safe to re-run: it overwrites its own files and touches nothing else.
#
# -Link installs directory JUNCTIONS instead of copies, so this checkout is the
# single source of truth: edit a skill here and every agent sees it immediately,
# with no reinstall. Without it, each install takes a snapshot that goes stale
# the next time you edit a SKILL.md — which is the failure this switch exists to
# prevent, because a stale skill still loads and still looks right.
#
# Junctions need no administrator rights (unlike symlinks). Verified: Claude Code
# discovers skills through a junction exactly as through a real directory.
#
# A copying install over an existing junction would write through it, back into
# this repo. Both modes therefore detect junctions and leave them alone.
param([switch]$Project, [switch]$Link)

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

$mode = if ($Link) { "linked" } else { "copied" }
Write-Host "Installing mendix-change-toolkit -> $Scope  [$mode]"

function Get-LinkType($path) {
    $i = Get-Item $path -Force -ErrorAction SilentlyContinue
    if ($i) { return $i.LinkType }
    return $null
}

# Install one directory, as a junction or as a copy of its contents.
function Install-Dir($source, $target, $label) {
    $existing = Get-LinkType $target

    if ($Link) {
        if ($existing -eq 'Junction') { Write-Host "  $label  already linked"; return }
        if (Test-Path $target) { Remove-Item -Recurse -Force $target }
        cmd /c mklink /J "$target" "$source" | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Error "could not create junction at $target"; exit 1 }
        Write-Host "  $label  -> $target  (junction)"
        return
    }

    if ($existing -eq 'Junction') {
        # Copying here would write through the link into this repo and silently
        # undo the centralisation. Say so rather than doing it.
        Write-Host "  $label  SKIPPED: $target is a junction into this checkout."
        Write-Host "           It is already live. Re-run with -Link, or remove it first to go back to copies."
        return
    }
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item -Force -Path (Join-Path $source "*") -Destination $target -Recurse
    Write-Host "  $label  -> $target"
}

Install-Dir (Join-Path $Src "tools") (Join-Path $Dest "mxdiff") "tools "

New-Item -ItemType Directory -Force -Path (Join-Path $Dest "skills") | Out-Null
foreach ($d in Get-ChildItem -Directory (Join-Path $Src "skills")) {
    Install-Dir $d.FullName (Join-Path $Dest "skills\$($d.Name)") "skill "
}

Write-Host ""
Write-Host "Checking dependencies..."
& bash (Join-Path $Dest "mxdiff/doctor.sh")

Write-Host @"

Installed skills:
  /mendix-scout             triage a story nobody has built yet
  /mendix-plan              work out how to implement one
  /mendix-build             build a plan into the local model
  /mendix-review            code review of a commit range
  /mendix-test-instructions test steps derived from what actually changed
  /mendix-change-notes      customer/team-facing change note
  /mendix-change-report     all three in one pass

Note: the tools are bash scripts. Git for Windows (Git Bash) provides the required
bash, and is already a dependency of any Mendix git workflow.
"@
if (-not $Link) {
    Write-Host @"
These are COPIES. Editing a skill in this checkout will not reach them until you
run this script again. Re-run with -Link to make them junctions instead.
"@
}
