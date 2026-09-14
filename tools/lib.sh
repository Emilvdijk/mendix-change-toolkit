#!/usr/bin/env bash
# Shared helpers for the mxdiff toolkit. Sourced by every script.
# Nothing here assumes where the toolkit is installed or which project it runs against.

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export TOOLS_DIR

die() { echo "error: $*" >&2; exit 1; }

# Repo root of the Mendix project we are operating on (cwd-based).
repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || die "not inside a git repository"
}

# The .mpr file of the project.
mpr_path() {
  local repo="${1:-$(repo_root)}"
  local f
  f=$(ls "$repo"/*.mpr 2>/dev/null | head -1)
  [ -n "$f" ] || die "no .mpr found in $repo"
  echo "$f"
}

# mxlint is a native binary: it needs C:/... on Windows, plain paths elsewhere.
to_native() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi
}

# Where all generated data lives. Git-ignored in Mendix projects by default.
cache_dir() { echo "$(repo_root)/.mendix-cache"; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' not found on PATH. Run: bash $TOOLS_DIR/doctor.sh"
}

# mxcli/mxlint must never touch a .mpr that Studio Pro has open - it can corrupt it.
# The reliable signal is the per-project lock file, not whether studiopro.exe is running:
# the scripts do their work in a *separate worktree copy*, which Studio Pro does not hold.
# So check the directory actually being read, and only warn about the main checkout.
assert_project_free() {
  local dir="$1"
  if ls "$dir"/*.mpr.lock >/dev/null 2>&1 || [ -e "$dir/modeler-merge-marker" ]; then
    die "Studio Pro has $dir open (lock file present). Close it, or point at a worktree copy."
  fi
}

# Informational only: the main checkout being open is fine, because we read a worktree.
warn_if_main_open() {
  local repo="${1:-$(repo_root)}"
  if ls "$repo"/*.mpr.lock >/dev/null 2>&1; then
    echo ">> note: Studio Pro has the main checkout open; working from a separate worktree copy." >&2
  fi
}

# Translate a Mendix commit-ish into the mirror repo's tag.
# The length is pinned: bare `--short` honours core.abbrev, which git grows as the
# repo gains objects. A mirror tagged at 8 chars would stop being found the day git
# decided 9 were needed, silently orphaning every tag already built.
mirror_tag() {
  local repo="$1" sha="$2"
  echo "mx-$(git -C "$repo" rev-parse --short=8 "$sha")"
}

mirror_dir() { echo "$(cache_dir)/model-history"; }
