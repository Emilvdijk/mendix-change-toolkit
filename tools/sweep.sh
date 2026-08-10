#!/usr/bin/env bash
# Ground-truth diff straight from the raw .mxunit BSON blobs in git.
# Needs no export, no worktree, no mxlint - only git and node.
#
#   bash sweep.sh <baseRef> <headRef> [detail]
#
# Each mprcontents/xx/yy/<guid>.mxunit file IS one Mendix document, stored as raw
# BSON. This decodes both revisions and reports the exact structural changes.
# It is the only source for sequence-flow edges and RefreshInClient on delete actions,
# which the mxlint YAML export drops.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

need git; need node
[ $# -ge 2 ] || die "usage: sweep.sh <baseRef> <headRef> [detail]"

BASE="$1"; HEAD_="$2"; DETAIL="${3:-}"
REPO="$(repo_root)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$REPO"

[ -d "$REPO/mprcontents" ] || die "no mprcontents/ - needs MPR v2 (Mendix 10.18+)"

git diff --name-status "$BASE" "$HEAD_" -- mprcontents | while read -r st path rest; do
  [ -z "${path:-}" ] && continue
  case "$path" in *.mxunit) ;; *) continue ;; esac

  ok_old=1; ok_new=1
  git show "$BASE:$path"  > "$TMP/o.bin" 2>/dev/null || ok_old=0
  git show "$HEAD_:$path" > "$TMP/n.bin" 2>/dev/null || ok_new=0

  if [ "$st" = "A" ] || [ $ok_old -eq 0 ]; then
    echo "ADDED    $(node "$TOOLS_DIR/info.js" "$TMP/n.bin" 2>&1)   <- $path"
    continue
  fi
  if [ "$st" = "D" ] || [ $ok_new -eq 0 ]; then
    echo "DELETED  $(node "$TOOLS_DIR/info.js" "$TMP/o.bin" 2>&1)   <- $path"
    continue
  fi

  res=$(node "$TOOLS_DIR/mxdiff.js" "$TMP/o.bin" "$TMP/n.bin" 2>&1)
  hdr=$(echo "$res" | head -1 | sed 's/^# //')
  cnt=$(echo "$res" | sed -n '2p' | sed 's/^# //')
  echo "MODIFIED $hdr  --  $cnt"
  [ -n "$DETAIL" ] && echo "$res" | tail -n +3 | sed 's/^/         /'
done
