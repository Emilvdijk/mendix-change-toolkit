#!/usr/bin/env bash
# Install the Mendix change-review toolkit + skills.
#
#   bash install.sh              install for your user (all projects)  -> ~/.claude/
#   bash install.sh --project    install into the current project only -> <repo>/.claude/
#
# Safe to re-run: it overwrites its own files and touches nothing else.
set -uo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${1:-}" = "--project" ]; then
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "not in a git repo" >&2; exit 1; }
  DEST="$ROOT/.claude"
  SCOPE="project ($ROOT)"
else
  DEST="$HOME/.claude"
  SCOPE="user ($HOME)"
fi

echo "Installing mendix-change-toolkit -> $SCOPE"

mkdir -p "$DEST/mxdiff" "$DEST/skills"
cp -f "$SRC/tools/"* "$DEST/mxdiff/"
chmod +x "$DEST/mxdiff/"*.sh 2>/dev/null || true
echo "  tools  -> $DEST/mxdiff/"

for d in "$SRC/skills/"*/; do
  name="$(basename "$d")"
  mkdir -p "$DEST/skills/$name"
  cp -f "$d"SKILL.md "$DEST/skills/$name/"
  echo "  skill  -> $DEST/skills/$name/"
done

echo
echo "Checking dependencies..."
bash "$DEST/mxdiff/doctor.sh" || true

cat <<'EOF'

Installed skills:
  /mendix-review           code review of a commit range
  /mendix-test-instructions test steps derived from what actually changed
  /mendix-change-notes     customer/team-facing change note
  /mendix-change-report    all three in one pass

If the project lives elsewhere, cd into it first - the tools always operate on the
git repo of your current directory.
EOF
