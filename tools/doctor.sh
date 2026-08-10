#!/usr/bin/env bash
# Check that every dependency the toolkit needs is present and usable.
# Run this first on a new machine or a new project.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ok=0; bad=0
say_ok()   { echo "  OK    $*"; ok=$((ok+1)); }
say_bad()  { echo "  FAIL  $*"; bad=$((bad+1)); }
say_warn() { echo "  WARN  $*"; }

echo "mxdiff doctor"
echo "toolkit: $TOOLS_DIR"
echo

echo "Dependencies"
for c in git node mxcli mxlint; do
  if command -v "$c" >/dev/null 2>&1; then
    case "$c" in
      git)    say_ok "git    $(git --version | awk '{print $3}')" ;;
      node)   say_ok "node   $(node --version)" ;;
      mxcli)  say_ok "mxcli  $(mxcli --version 2>&1 | head -1 | awk '{print $3}')" ;;
      mxlint) say_ok "mxlint $(mxlint version 2>&1 | head -1)" ;;
    esac
  else
    say_bad "$c not found on PATH"
  fi
done

# mxlint must be new enough to have the git-backed modelsource workflow.
if command -v mxlint >/dev/null 2>&1; then
  v=$(mxlint version 2>&1 | head -1 | sed 's/^v//')
  major=${v%%.*}; rest=${v#*.}; minor=${rest%%.*}
  if [ "${major:-0}" -gt 3 ] 2>/dev/null || { [ "${major:-0}" -eq 3 ] && [ "${minor:-0}" -ge 17 ]; } 2>/dev/null; then
    say_ok "mxlint >= 3.17 (has 'lint --diff' / modelsource git workflow)"
  else
    say_warn "mxlint $v is older than 3.17 - lint-diff will not work; build-history/review still will"
  fi
fi

echo
echo "Project"
if repo=$(git rev-parse --show-toplevel 2>/dev/null); then
  say_ok "git repo: $repo"
  if mpr=$(ls "$repo"/*.mpr 2>/dev/null | head -1); then
    say_ok "project:  $(basename "$mpr")"
  else
    say_bad "no .mpr file in repo root"
  fi
  if [ -d "$repo/mprcontents" ]; then
    say_ok "mprcontents/ present (MPR v2 - required for BSON sweep)"
  else
    say_warn "no mprcontents/ - project predates Mendix 10.18; sweep.sh will not work"
  fi
  if grep -qE '^/?\.mendix-cache' "$repo/.gitignore" 2>/dev/null; then
    say_ok ".mendix-cache is git-ignored"
  else
    say_warn ".mendix-cache is NOT git-ignored - add '/.mendix-cache/' to .gitignore"
  fi
  if ls "$repo"/*.mpr.lock >/dev/null 2>&1; then
    say_warn "Studio Pro has the main checkout open - fine: the tools read a separate worktree copy"
  else
    say_ok "no Studio Pro lock on the main checkout"
  fi
else
  say_bad "not inside a git repository (cd into your Mendix project first)"
fi

echo
echo "$ok ok, $bad problem(s)"
[ "$bad" -eq 0 ] || exit 1
