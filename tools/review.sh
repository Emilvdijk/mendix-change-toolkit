#!/usr/bin/env bash
# Turn the model-history mirror into a review artifact.
#
#   bash review.sh <shaA>..<shaB>        combined diff across a contiguous range
#   bash review.sh <sha> <sha> <sha>     per-commit breakdown (non-contiguous set)
#   ... --summary                        changed-document table only, no diff bodies
#   ... --docs                           print changed document names only, one per line
#
# Requires build-history.sh to have been run for the commits involved.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

need git
REPO="$(repo_root)"
MIRROR="$(mirror_dir)"
[ -d "$MIRROR/.git" ] || die "no mirror at $MIRROR - run build-history.sh first"

SUMMARY=0; DOCSONLY=0; ARGS=()
for a in "$@"; do
  case "$a" in
    --summary) SUMMARY=1 ;;
    --docs)    DOCSONLY=1 ;;
    *)         ARGS+=("$a") ;;
  esac
done
[ ${#ARGS[@]} -gt 0 ] || die "usage: review.sh <shaA>..<shaB> | <sha>... [--summary|--docs]"

have_tag() { git -C "$MIRROR" rev-parse -q --verify "refs/tags/$1" >/dev/null 2>&1; }
need_tag() { have_tag "$1" || die "$1 not in mirror - run: build-history.sh <range covering it>"; }

PAIRS=()
if [ ${#ARGS[@]} -eq 1 ] && [[ "${ARGS[0]}" == *..* ]]; then
  A="${ARGS[0]%%..*}"; B="${ARGS[0]##*..}"
  ta="$(mirror_tag "$REPO" "$A")"; tb="$(mirror_tag "$REPO" "$B")"
  need_tag "$ta"; need_tag "$tb"
  PAIRS+=("combined|$ta|$tb")
else
  for sha in "${ARGS[@]}"; do
    t="$(mirror_tag "$REPO" "$sha")"; need_tag "$t"
    PAIRS+=("$(git -C "$REPO" log -1 --format='%h %s' "$sha")|$t^|$t")
  done
fi

# changed documents, one "status<TAB>path" per line
changed() { git -C "$MIRROR" diff --name-status -M "$1" "$2" -- '*.yaml'; }

if [ "$DOCSONLY" -eq 1 ]; then
  for p in "${PAIRS[@]}"; do
    rest="${p#*|}"; changed "${rest%%|*}" "${rest##*|}" | cut -f2- | sed 's/\.yaml$//'
  done | sort -u
  exit 0
fi

echo "# Mendix change review"
echo
for p in "${PAIRS[@]}"; do
  label="${p%%|*}"; rest="${p#*|}"; from="${rest%%|*}"; to="${rest##*|}"

  echo "## $label"
  echo
  if [ "$label" = "combined" ]; then
    echo "Commits included:"
    echo '```'
    git -C "$REPO" log --oneline "${ARGS[0]}"
    echo '```'
    echo
  fi

  echo "### Changed documents"
  echo
  echo '| Status | Module | Document | +/- |'
  echo '|---|---|---|---|'
  # one numstat pass, one name-status pass, joined in awk - no per-file git calls
  paste <(changed "$from" "$to" | cut -f1) \
        <(git -C "$MIRROR" diff --numstat -M "$from" "$to" -- '*.yaml') \
    | awk -F'\t' '{
        st=$1; add=$2; del=$3; f=$4;
        n=split(f,parts,"/"); mod=parts[1];
        doc=parts[n]; sub(/\.yaml$/,"",doc);
        printf "| %s | %s | `%s` | +%s/-%s |\n", st, mod, doc, add, del;
      }'
  echo

  if [ "$SUMMARY" -eq 0 ]; then
    echo "### Detail"
    echo
    echo '```diff'
    git -C "$MIRROR" diff -U3 -M "$from" "$to"
    echo '```'
    echo
  fi
done
