#!/usr/bin/env bash
# GitHub Pages 갱신: 작업 폴더에서 빌드한 dist/ 만 gh-pages 에 새 커밋으로 올림.
# 정션/심볼릭 링크, git worktree, 폴더 일괄 삭제를 쓰지 않음 (2026-09-26 assets/vendor 삭제 사고).
# 따로 만든 임시 git 인덱스에 dist/ 를 담아 gh-pages 의 다음 커밋을 만들고 밀어 넣음 (강제 푸시 없음).
#   bash tools/pages-publish.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REV="$(git rev-parse --short HEAD)"
npx tsc --noEmit
# 주소에 ?town= 이 없으면 애쉬포드 마을로 열림. MSYS_NO_PATHCONV 가 없으면 Git Bash 가 base 경로를 망침
MSYS_NO_PATHCONV=1 VITE_DEFAULT_TOWN=ashford npx vite build --base=/hearth-and-kin/
grep -q 'src="/hearth-and-kin/assets/' dist/index.html || { echo "base 경로가 틀림"; exit 1; }
touch dist/.nojekyll
git fetch -q origin gh-pages
IDX="$(git rev-parse --git-dir)/pages-index.tmp"
rm -f "$IDX"
# dist 안 경로가 .gitignore 규칙(assets/generated 등)에 걸려도 올라가게 -f
( cd dist && GIT_INDEX_FILE="../$IDX" git --git-dir=../.git --work-tree=. add -A -f . )
TREE="$(GIT_INDEX_FILE="$IDX" git write-tree)"
rm -f "$IDX"
COMMIT="$(git commit-tree "$TREE" -p origin/gh-pages -m "Pages 갱신 ($REV)")"
git push origin "$COMMIT:refs/heads/gh-pages"
echo "올림: https://kh32-7.github.io/hearth-and-kin/ ($REV)"
