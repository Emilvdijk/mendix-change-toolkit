#!/usr/bin/env bash
# Replay Mendix commits into a text "model history" git repo: one commit of exported
# mxlint YAML per Mendix commit, tagged mx-<shortsha>. After this, every comparison
# is plain `git diff` - which is what makes combining many commits work.
#
#   bash build-history.sh <rev-list-args...>
#   bash build-history.sh <baseSha>^..HEAD
#   bash build-history.sh HEAD~5..HEAD
#
# Incremental: re-running only adds commits that are not already tagged.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

need git; need node; need mxlint
[ $# -gt 0 ] || die "usage: build-history.sh <rev-list-args...>   e.g. HEAD~5..HEAD"

REPO="$(repo_root)"
warn_if_main_open "$REPO"
CACHE="$(cache_dir)"
WT="$CACHE/mxdiff-worktree"
MIRROR="$(mirror_dir)"
CFG="$CACHE/mxdiff-export.yaml"
mkdir -p "$CACHE"

# 1. one reusable worktree; checkouts after the first only touch changed files
if [ ! -e "$WT/.git" ]; then
  echo ">> creating worktree $WT"
  git -C "$REPO" worktree add --detach "$WT" HEAD >/dev/null 2>&1 \
    || die "could not create worktree at $WT"
fi
assert_project_free "$WT"

# 2. mirror repo holding the exported YAML history
if [ ! -d "$MIRROR/.git" ]; then
  echo ">> creating mirror repo $MIRROR"
  mkdir -p "$MIRROR"
  git -C "$MIRROR" init -q
  # exported YAML is LF; stop git rewriting it and spamming CRLF warnings
  git -C "$MIRROR" config core.autocrlf false
  git -C "$MIRROR" config core.safecrlf false
  printf '* -text\n' > "$MIRROR/.gitattributes"
  git -C "$MIRROR" add -A >/dev/null 2>&1
  git -C "$MIRROR" commit -q --allow-empty -m "mxdiff: empty baseline"
fi

printf 'projectDirectory: %s\nmodelsource: %s\n' \
  "$(to_native "$WT")" "$(to_native "$MIRROR")" > "$CFG"
CFGW="$(to_native "$CFG")"

SHAS=$(git -C "$REPO" rev-list --reverse "$@") || die "bad rev range: $*"
[ -n "$SHAS" ] || die "no commits matched: $*"
TOTAL=$(echo "$SHAS" | grep -c .)
echo ">> $TOTAL commit(s) in range"

i=0; built=0
for sha in $SHAS; do
  i=$((i+1))
  tag="$(mirror_tag "$REPO" "$sha")"
  subject=$(git -C "$REPO" log -1 --format=%s "$sha")

  if git -C "$MIRROR" rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1; then
    echo ">> [$i/$TOTAL] $tag  (already built, skipping)"
    continue
  fi
  echo ">> [$i/$TOTAL] $tag  $subject"

  author=$(git -C "$REPO" log -1 --format='%an <%ae>' "$sha")
  cdate=$(git -C "$REPO" log -1 --format=%aI "$sha")

  git -C "$WT" checkout -q --detach "$sha" || die "checkout $sha failed"

  # clear previous export so deletions register, keep .git/.gitattributes
  find "$MIRROR" -mindepth 1 -maxdepth 1 ! -name .git ! -name .gitattributes -exec rm -rf {} +

  mxlint export --config "$CFGW" >/dev/null 2>&1 || die "mxlint export failed for $sha"
  node "$TOOLS_DIR/expand-pseudocode.js" "$MIRROR" >/dev/null \
    || die "expand-pseudocode.js failed for $sha (mirror commit not written)"

  git -C "$MIRROR" add -A >/dev/null 2>&1
  GIT_AUTHOR_NAME="${author%% <*}" \
  GIT_AUTHOR_EMAIL="$(echo "$author" | sed 's/.*<//;s/>//')" \
  GIT_AUTHOR_DATE="$cdate" \
  git -C "$MIRROR" commit -q --allow-empty -m "$subject" -m "mendix-commit: $sha" >/dev/null 2>&1
  git -C "$MIRROR" tag -f "$tag" >/dev/null 2>&1
  built=$((built+1))
done

echo
echo ">> done: $built newly built, mirror at $MIRROR"
