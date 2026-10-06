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

# A document may be given as <type>:<Module.Name>. mxcli's auto-detect does not know
# every type - layouts above all - and answers "no describable document named ..." for
# them, which reads like "mxcli cannot describe this" when the type alone was missing.
# A colon is not a legal filename character on Windows, so the cache name drops it.
describe_one() { # describe_one <doc>
  case "$1" in
    *:*) mxcli describe -p "$WT/$MPR" "${1%%:*}" "${1#*:}" 2>/dev/null ;;
    *)   mxcli describe -p "$WT/$MPR" "$1"       2>/dev/null ;;
  esac
}
cache_name() { echo "${1//:/__}"; }

render() { # render <sha> <suffix>
  local sha="$1" suffix="$2" doc
  git -C "$WT" checkout -q --detach "$sha" || die "checkout $sha failed"
  for doc in "${DOCS[@]}"; do
    describe_one "$doc" \
      | grep -vE '^[[:space:]]*@(position|anchor)\(' > "$OUT/$(cache_name "$doc").$suffix.mdl"
  done
}

render "$A" old
render "$B" new

for doc in "${DOCS[@]}"; do
  c="$OUT/$(cache_name "$doc")"
  echo "############ $doc   ($A_REF -> $B_REF)"
  if [ ! -s "$c.old.mdl" ] && [ ! -s "$c.new.mdl" ]; then
    case "$doc" in
      *:*) echo "(mxcli could not describe this document - use sweep.sh for ground truth)" ;;
      *)   echo "(mxcli could not describe this document. If it is a layout or another type"
           echo " its auto-detect does not know, name the type: ${doc%%.*}-style '<type>:$doc'."
           echo " Otherwise use sweep.sh for ground truth.)" ;;
    esac
  elif [ ! -s "$c.old.mdl" ]; then
    echo "(new document - full definition)"; cat "$c.new.mdl"
  elif [ ! -s "$c.new.mdl" ]; then
    echo "(document removed)"
  elif cmp -s "$c.old.mdl" "$c.new.mdl"; then
    echo "(no logic change)"
  else
    git --no-pager diff --no-index --no-prefix -U4 \
        "$c.old.mdl" "$c.new.mdl" 2>/dev/null | tail -n +5
  fi
  echo
done
