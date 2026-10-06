#!/usr/bin/env bash
# Which documents did this range change that the mxlint mirror cannot see - and how to read them.
#
#   bash mirror-gaps.sh <shaA> <shaB> [--all] [--limit N] [--json]
#
# The mirror is the change list every other step is scoped by: review.sh --summary,
# lint-diff.sh and invariants.sh all read it. It is NOT the whole commit - mxlint skips
# marketplace modules on export - and the raw .mxunit blobs in git are the only complete
# census. Anything printed as a GAP changed in the range and appears in NO other output
# of this toolkit, so each one comes with the command that reads it.
#
# Measured: a snippet was placed on a layout in a marketplace module. The mirror diff
# showed 9 files, all internally consistent, and the review concluded the snippet had
# never been placed. sweep.sh had the layout the whole time.
#
# Volume: a marketplace module VERSION bump rewrites hundreds of documents. Those are
# reported as an upgrade with a count instead of one line each; --all overrides.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

need git; need node
[ $# -ge 2 ] || die "usage: mirror-gaps.sh <shaA> <shaB> [--all] [--limit N] [--json]"

BASE_REF="$1"; HEAD_REF="$2"; shift 2
REPO="$(repo_root)"
MIRROR="$(mirror_dir)"
[ -d "$MIRROR/.git" ] || die "no mirror at $MIRROR - run build-history.sh first"

# Resolve against the MAIN repo: a relative ref would otherwise resolve against the
# worktree, which sits at whatever commit was checked out last.
BASE="$(git -C "$REPO" rev-parse --verify "${BASE_REF}^{commit}")" || die "bad ref: $BASE_REF"
HEAD_="$(git -C "$REPO" rev-parse --verify "${HEAD_REF}^{commit}")" || die "bad ref: $HEAD_REF"

A="$(mirror_tag "$REPO" "$BASE")"; B="$(mirror_tag "$REPO" "$HEAD_")"
for t in "$A" "$B"; do
  git -C "$MIRROR" rev-parse -q --verify "refs/tags/$t" >/dev/null 2>&1 \
    || die "$t not in mirror - run build-history.sh for that range first"
done

# A gap can only be named as <type>:<Module.Name> if the module is resolved, and only
# mxcli can do that - against the worktree copy, never the checkout Studio Pro has open.
WTARGS=()
WT="$(cache_dir)/mxdiff-worktree"
if command -v mxcli >/dev/null 2>&1 && [ -e "$WT/.git" ]; then
  assert_project_free "$WT"
  warn_if_main_open "$REPO"
  if git -C "$WT" checkout -q --detach "$HEAD_" 2>/dev/null; then
    WTARGS=(--worktree "$WT" --mpr "$(basename "$(mpr_path "$REPO")")")
  fi
fi

exec node "$TOOLS_DIR/mirror-gaps.js" \
  --repo "$REPO" --mirror "$MIRROR" \
  --base "$BASE" --head "$HEAD_" --tag-a "$A" --tag-b "$B" \
  "${WTARGS[@]+"${WTARGS[@]}"}" "$@"
