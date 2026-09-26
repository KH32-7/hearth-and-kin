#!/usr/bin/env bash
# 비공개 그림을 암호화해 deploy/assets.tar.gz.enc 로 묶음 (GitHub Pages 빌드용).
# 키는 .deploy-key (git 에 올리지 않음) = GitHub Secret DEPLOY_ASSETS_KEY 와 같은 값.
#   bash tools/deploy/pack-assets.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .deploy-key ] || { echo ".deploy-key 없음"; exit 1; }
mkdir -p deploy
node tools/deploy/list-assets.mjs > deploy/.list
echo "파일 $(wc -l < deploy/.list)개"
tar -czf deploy/assets.tar.gz -T deploy/.list
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in deploy/assets.tar.gz -out deploy/assets.tar.gz.enc -pass file:.deploy-key
rm deploy/assets.tar.gz deploy/.list
ls -la deploy/assets.tar.gz.enc
