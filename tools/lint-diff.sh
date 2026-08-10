#!/usr/bin/env bash
# Lint ONLY the documents that changed between two Mendix commits.
#
#   bash lint-diff.sh <shaA> <shaB>
#
# Trick: point mxlint's modelsource at the mirror repo, then move its HEAD/index back
# to <shaA> while the working tree holds <shaB>. The unstaged delta is exactly the
# range, and `mxlint lint --diff` only evaluates documents with unstaged changes.
# Requires mxlint >= 3.17. Downloads the rule pack on first run (needs network once).
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

need git; need mxlint
[ $# -ge 2 ] || die "usage: lint-diff.sh <shaA> <shaB>"

REPO="$(repo_root)"
M="$(mirror_dir)"
CFG="$(cache_dir)/mxdiff-lint.yaml"
[ -d "$M/.git" ] || die "no mirror at $M - run build-history.sh first"

A="$(mirror_tag "$REPO" "$1")"; B="$(mirror_tag "$REPO" "$2")"
for t in "$A" "$B"; do
  git -C "$M" rev-parse -q --verify "refs/tags/$t" >/dev/null 2>&1 \
    || die "$t not in mirror - run build-history.sh for that range first"
done

TIP=$(git -C "$M" rev-parse HEAD)
cleanup() { git -C "$M" reset -q --hard "$TIP" 2>/dev/null || true; }
trap cleanup EXIT

git -C "$M" reset -q --hard "$B"   # working tree = new state
git -C "$M" reset -q "$A"          # HEAD/index  = old state -> unstaged delta = the range

n=$(git -C "$M" status --porcelain | grep -c . || true)
echo ">> linting $n changed document(s): $1 -> $2"
echo

printf 'projectDirectory: %s\nmodelsource: %s\n' \
  "$(to_native "$REPO")" "$(to_native "$M")" > "$CFG"

mxlint lint --diff --config "$(to_native "$CFG")" 2>&1 \
  | sed 's/^time="[^"]*" level=//'
