#!/usr/bin/env bash
# Which documents did this range change that the mxlint mirror cannot see?
#
#   bash mirror-gaps.sh <shaA> <shaB>
#
# The mirror is the change list every other step is scoped by: review.sh --summary,
# lint-diff.sh and invariants.sh all read it. It is NOT the whole commit - mxlint
# skips marketplace modules on export - and the raw .mxunit blobs in git are the only
# census that is complete. Anything printed as GAP changed in the range and appears
# in NO other output of this toolkit.
#
# Measured: a snippet was placed on a layout in a marketplace module. The
# mirror diff showed 9 files, all internally consistent, and the review concluded the
# snippet had never been placed. sweep.sh had the layout the whole time.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

need git; need node
[ $# -ge 2 ] || die "usage: mirror-gaps.sh <shaA> <shaB>"

BASE="$1"; HEAD_="$2"
REPO="$(repo_root)"
MIRROR="$(mirror_dir)"
[ -d "$MIRROR/.git" ] || die "no mirror at $MIRROR - run build-history.sh first"

A="$(mirror_tag "$REPO" "$BASE")"; B="$(mirror_tag "$REPO" "$HEAD_")"
for t in "$A" "$B"; do
  git -C "$MIRROR" rev-parse -q --verify "refs/tags/$t" >/dev/null 2>&1 \
    || die "$t not in mirror - run build-history.sh for that range first"
done

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git -C "$MIRROR" diff --name-only -M "$A" "$B" > "$TMP/mirror.txt"

DOL='$'
covered=0; gaps=0

while read -r st p rest; do
  [ -z "${p:-}" ] && continue
  case "$p" in *.mxunit) ;; *) continue ;; esac

  src="$HEAD_"; [ "${st:0:1}" = "D" ] && src="$BASE"
  git show "$src:$p" > "$TMP/u.bin" 2>/dev/null || continue
  info="$(node "$TOOLS_DIR/info.js" "$TMP/u.bin" 2>/dev/null)" || continue
  type="${info%%|*}"; name="${info##*|}"
  short="${type##*${DOL}}"

  # Folders and module wrappers are containers, not documents: the export has no file for them.
  case "$type" in
    "Projects${DOL}Folder"|"Projects${DOL}ModuleImpl"|"Projects${DOL}Project") continue ;;
  esac

  # Covered when the mirror diff holds a path for it: "<Name>.<Area>$<Type>.yaml", or
  # "<Area>$<Type>.yaml" for the per-module singletons that carry no document name.
  # mxlint truncates long filenames, so a prefix match is the honest test.
  stem="${name:0:16}"
  hit=0
  while IFS= read -r m; do
    b="${m##*/}"
    case "$b" in
      "${stem}"*"${DOL}${short}.yaml") hit=1; break ;;
      *"${DOL}${short}.yaml") [ "$name" = "(unnamed)" ] && { hit=1; break; } ;;
    esac
  done < "$TMP/mirror.txt"

  if [ "$hit" -eq 1 ]; then
    covered=$((covered+1))
  else
    gaps=$((gaps+1))
    echo "GAP  $st  $type|$name   <- $p"
  fi
done < <(git -C "$REPO" diff --name-status "$BASE" "$HEAD_" -- mprcontents)

echo
echo ">> $covered document(s) covered by the mirror, $gaps gap(s)."
if [ "$gaps" -gt 0 ]; then
  echo ">> Every GAP above is invisible to review.sh --summary, lint-diff.sh and invariants.sh."
  echo ">> Read it with:  bash sweep.sh <shaA> <shaB> detail      (structural diff)"
  echo ">>                mxcli describe <type> <Module.Name>     (current state, Studio Pro closed)"
fi
exit 0
