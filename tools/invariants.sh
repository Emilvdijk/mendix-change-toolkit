#!/usr/bin/env bash
# Run the mechanical invariant checks over a commit range.
#
#   bash invariants.sh <shaA>..<shaB>        checks scoped to documents the range changed
#   bash invariants.sh <shaA>..<shaB> --all  check every document in the model, not just changed ones
#   ... --json                               machine-readable
#
# Reads the model-history mirror, so build-history.sh must have run for the range.
# Emits CANDIDATES for a reviewer to confirm - never final findings.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

need git
need node
REPO="$(repo_root)"
MIRROR="$(mirror_dir)"
[ -d "$MIRROR/.git" ] || die "no mirror at $MIRROR - run build-history.sh first"

ALL=0; JSON=""; RANGE=""
for a in "$@"; do
  case "$a" in
    --all)  ALL=1 ;;
    --json) JSON="--json" ;;
    *)      RANGE="$a" ;;
  esac
done
[ -n "$RANGE" ] || die "usage: invariants.sh <shaA>..<shaB> [--all] [--json]"
[[ "$RANGE" == *..* ]] || die "expected a range like <shaA>..<shaB>"

A="${RANGE%%..*}"; B="${RANGE##*..}"

# Resolve a project sha to a mirror commit. Prefer the tag build-history.sh
# writes; fall back to the "mendix-commit:" trailer, which survives a mirror
# rebuild that did not re-tag.
resolve() {
  local sha full tag
  full="$(git -C "$REPO" rev-parse "$1" 2>/dev/null)" || die "unknown commit: $1"
  tag="$(mirror_tag "$REPO" "$1")"
  if git -C "$MIRROR" rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1; then
    git -C "$MIRROR" rev-parse "refs/tags/$tag"; return
  fi
  sha="$(git -C "$MIRROR" log --format='%H %b' | grep -m1 "mendix-commit: $full" | cut -d' ' -f1)"
  [ -n "$sha" ] || die "$1 not in mirror - run: build-history.sh '$RANGE'"
  echo "$sha"
}
TA="$(resolve "$A")" || exit 1
TB="$(resolve "$B")" || exit 1

WORK="$(cache_dir)/invariants"
rm -rf "$WORK"; mkdir -p "$WORK/old" "$WORK/new"
git -C "$MIRROR" archive "$TA" | tar -x -C "$WORK/old"
git -C "$MIRROR" archive "$TB" | tar -x -C "$WORK/new"

SCOPE=()
if [ "$ALL" -eq 0 ]; then
  git -C "$MIRROR" diff --name-only -M "$TA" "$TB" -- '*.yaml' > "$WORK/changed.txt"
  SCOPE=(--changed "$WORK/changed.txt")
  echo ">> $(wc -l < "$WORK/changed.txt") changed document(s) in scope: $RANGE" >&2
else
  echo ">> checking every document at $TB" >&2
fi

node "$TOOLS_DIR/invariants.js" --new "$WORK/new" --old "$WORK/old" "${SCOPE[@]}" $JSON
