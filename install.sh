#!/usr/bin/env bash
# Install the Mendix change-review toolkit + skills.
#
#   bash install.sh              install for your user (all projects)  -> ~/.claude/
#   bash install.sh --project    install into the current project only -> <repo>/.claude/
#   bash install.sh --link       symlink instead of copy  <- recommended
#
# Safe to re-run: it overwrites its own files and touches nothing else.
#
# --link installs SYMLINKS instead of copies, so this checkout is the single
# source of truth: edit a skill here and every agent sees it immediately, with no
# reinstall. Without it, each install takes a snapshot that goes stale the next
# time you edit a SKILL.md — which is the failure this flag exists to prevent,
# because a stale skill still loads and still looks right.
#
# A copying install over an existing symlink would write through it, back into
# this repo. Both modes therefore detect links and leave them alone.
set -uo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEST="$HOME/.claude"
SCOPE="user ($HOME)"
LINK=0
for arg in "$@"; do
  case "$arg" in
    --project)
      ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "not in a git repo" >&2; exit 1; }
      DEST="$ROOT/.claude"; SCOPE="project ($ROOT)" ;;
    --link) LINK=1 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

MODE=$([ "$LINK" = 1 ] && echo linked || echo copied)
echo "Installing mendix-change-toolkit -> $SCOPE  [$MODE]"

# Install one directory, as a symlink or as a copy of its contents.
install_dir() {
  local source="$1" target="$2" label="$3"

  if [ "$LINK" = 1 ]; then
    if [ -L "$target" ] && [ "$(readlink "$target")" = "$source" ]; then
      echo "  $label  already linked"; return
    fi
    rm -rf "$target"
    ln -s "$source" "$target" || { echo "could not link $target" >&2; exit 1; }
    echo "  $label  -> $target  (symlink)"
    return
  fi

  if [ -L "$target" ]; then
    echo "  $label  SKIPPED: $target is a symlink into this checkout."
    echo "           It is already live. Re-run with --link, or remove it first to go back to copies."
    return
  fi
  mkdir -p "$target"
  cp -rf "$source"/* "$target"/
  echo "  $label  -> $target"
}

mkdir -p "$DEST/skills"
install_dir "$SRC/tools" "$DEST/mxdiff" "tools "
[ "$LINK" = 1 ] || chmod +x "$DEST/mxdiff/"*.sh 2>/dev/null || true

for d in "$SRC/skills/"*/; do
  name="$(basename "$d")"
  install_dir "${d%/}" "$DEST/skills/$name" "skill "
done

echo
echo "Checking dependencies..."
bash "$DEST/mxdiff/doctor.sh" || true

cat <<'EOF'

Installed skills:
  /mendix-scout             triage a story nobody has built yet
  /mendix-plan              work out how to implement one
  /mendix-build             build a plan into the local model
  /mendix-review            code review of a commit range
  /mendix-test-instructions test steps derived from what actually changed
  /mendix-change-notes      customer/team-facing change note
  /mendix-change-report     all three in one pass

If the project lives elsewhere, cd into it first - the tools always operate on the
git repo of your current directory.
EOF

if [ "$LINK" != 1 ]; then
  cat <<'EOF'
These are COPIES. Editing a skill in this checkout will not reach them until you
run this script again. Re-run with --link to make them symlinks instead.
EOF
fi
