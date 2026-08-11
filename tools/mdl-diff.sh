#!/usr/bin/env bash
# Readable before/after logic diff for specific documents, using mxcli's nested MDL.
# Run this after review.sh has told you WHICH documents changed.
#
#   bash mdl-diff.sh <shaA> <shaB> MyModule.SUB_MyFlow [More.Docs...]
#
# MDL is properly nested, uses real variable names, and does not renumber labels,
# so the diff shows only the semantic change. Canvas coordinates are stripped.
# Pass several documents in one call - the worktree checkouts are the slow part
# and are shared across all of them.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

need git; need mxcli
[ $# -ge 3 ] || die "usage: mdl-diff.sh <shaA> <shaB> <Module.Doc>..."

REPO="$(repo_root)"
warn_if_main_open "$REPO"
WT="$(cache_dir)/mxdiff-worktree"
OUT="$(cache_dir)/mdl-diff"
# Resolve to absolute SHAs against the MAIN repo before touching the worktree.
# A relative ref like HEAD~3 would otherwise resolve against the worktree's own
# HEAD, which sits at whatever commit was checked out last - silently wrong.
A_REF="$1"; B_REF="$2"; shift 2
A="$(git -C "$REPO" rev-parse --verify "${A_REF}^{commit}")" || die "bad ref: $A_REF"
B="$(git -C "$REPO" rev-parse --verify "${B_REF}^{commit}")" || die "bad ref: $B_REF"
DOCS=("$@")

[ -e "$WT/.git" ] || git -C "$REPO" worktree add --detach "$WT" HEAD >/dev/null 2>&1
assert_project_free "$WT"
mkdir -p "$OUT"
MPR="$(basename "$(mpr_path "$REPO")")"

render() { # render <sha> <suffix>
  local sha="$1" suffix="$2" doc
  git -C "$WT" checkout -q --detach "$sha" || die "checkout $sha failed"
  for doc in "${DOCS[@]}"; do
    mxcli describe -p "$WT/$MPR" "$doc" 2>/dev/null \
      | grep -vE '^[[:space:]]*@(position|anchor)\(' > "$OUT/$doc.$suffix.mdl"
  done
}

render "$A" old
render "$B" new

for doc in "${DOCS[@]}"; do
  echo "############ $doc   ($A_REF -> $B_REF)"
  if [ ! -s "$OUT/$doc.old.mdl" ] && [ ! -s "$OUT/$doc.new.mdl" ]; then
    echo "(mxcli could not describe this document - use sweep.sh for ground truth)"
  elif [ ! -s "$OUT/$doc.old.mdl" ]; then
    echo "(new document - full definition)"; cat "$OUT/$doc.new.mdl"
  elif [ ! -s "$OUT/$doc.new.mdl" ]; then
    echo "(document removed)"
  elif cmp -s "$OUT/$doc.old.mdl" "$OUT/$doc.new.mdl"; then
    echo "(no logic change)"
  else
    git --no-pager diff --no-index --no-prefix -U4 \
        "$OUT/$doc.old.mdl" "$OUT/$doc.new.mdl" 2>/dev/null | tail -n +5
  fi
  echo
done
