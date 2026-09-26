#!/usr/bin/env bash
# GitHub Pages 갱신 (M 마일스톤 끝날 때마다): 커밋된 HEAD 를 깨끗한 작업트리에서 빌드해 gh-pages 브랜치에 올림.
# 작업 폴더의 커밋 안 된 변경은 들어가지 않음. 강제 푸시 없음.
#   bash tools/publish-pages.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd -W 2>/dev/null || pwd)"
REV="$(git rev-parse --short HEAD)"
BUILD="../hk-pages-build"
SITE="../hk-pages-site"
cleanup() {
  git worktree remove --force "$BUILD" 2>/dev/null || true
  git worktree remove --force "$SITE" 2>/dev/null || true
}
trap cleanup EXIT
cleanup

# 1) HEAD 를 따로 꺼내고, git 에 없는 빌드 입력(node_modules, 비공개 그림)은 연결
git worktree add --detach "$BUILD" HEAD >/dev/null
link() { # 윈도우는 디렉터리 정션, 그 밖은 심볼릭 링크
  if command -v cmd >/dev/null 2>&1; then cmd //c mklink /J "$(cygpath -w "$BUILD/$1")" "$(cygpath -w "$ROOT/$1")" >/dev/null
  else ln -s "$ROOT/$1" "$BUILD/$1"; fi
}
mkdir -p "$BUILD/assets/generated"
link node_modules
link assets/vendor
link assets/generated/ui
link assets/generated/world

# 2) 빌드: 주소에 ?town= 이 없으면 애쉬포드 마을로 열림. MSYS_NO_PATHCONV 가 없으면 Git Bash 가 base 경로를 망침
( cd "$BUILD" && npx tsc --noEmit && MSYS_NO_PATHCONV=1 VITE_DEFAULT_TOWN=ashford npx vite build --base=/hearth-and-kin/ )
grep -q 'src="/hearth-and-kin/assets/' "$BUILD/dist/index.html" || { echo "base 경로가 틀림"; exit 1; }

# 3) gh-pages 에 덮어 올림
git fetch -q origin gh-pages
git worktree add --detach "$SITE" origin/gh-pages >/dev/null
( cd "$SITE" && git rm -rq --ignore-unmatch assets index.html && cp -r "../hk-pages-build/dist/." . && touch .nojekyll \
  && git add -A && git -c core.autocrlf=false commit -qm "Pages 갱신 ($REV)" && git push origin HEAD:gh-pages )
echo "올림: https://kh32-7.github.io/hearth-and-kin/ ($REV)"
