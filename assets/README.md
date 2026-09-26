# assets

- `vendor/` : 외부 에셋 원본. **git에 올리지 않음** (.gitignore). 받는 방법은 아래
- `fonts/` : 넥슨 워헤이븐체 (배포 파일 그대로)
- `palette/` : 팔레트 파일 (Epic RPG World 기준, LPC 생성기 기준)
- `CREDITS.json` : 모든 에셋의 출처, 작가, 라이선스, 표기 문구, 수정 여부
- `AI_GENERATED.md` : 생성형 AI로 만든 파일 목록
- `SHARE_ALIKE.md` : CC-BY-SA로 수정한 파일 목록 (같은 라이선스로 공개해야 함)
- `curation.md` : 팩별 "쓸 것 / 안 쓸 것" 정리

## vendor 채우는 법

| 폴더 | 내용 | 받는 곳 |
| --- | --- | --- |
| `vendor/epic-rpg-world/` | Epic RPG World Collection (사용자 보유) | 유니티 에셋 스토어. 유니티 프로젝트로 임포트한 뒤 PNG/Tiled 파일 복사 (`docs/04_에셋_목록.md` 1절) |
| `vendor/epic-rpg-world-free-interiors/` | Epic RPG World Village(interiors) V1.3 (무료, 집 내부 가구) | https://rafaelmatos.itch.io/epic-rpg-world-free-house-interiors 에서 Download (브라우저로 받아야 함) |
| `vendor/lpc/lpc-generator/` | Universal LPC 캐릭터 생성기 | `git clone --depth 1 https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator.git` |
| `vendor/lpc/lpc-revised/` | LPC Revised | `git clone --depth 1 https://github.com/ElizaWy/LPC.git` |
| `vendor/lpc/oga/` | OpenGameArt LPC 팩들 | `vendor/lpc/oga/SOURCES.md`의 페이지 링크 |
| 그 밖의 유료/무료 팩 | UI, 아이콘, 효과, 음악, 효과음 | `docs/04_에셋_목록.md` 5절, 5-1절 |

## 구매한 에셋 (2026-09-26, 합계 $68.99)

원본 zip은 사용자 `다운로드` 폴더에 있음. 다시 풀 때는 같은 폴더 이름으로

| 폴더 | 에셋 | 가격 | 라이선스 요점 |
| --- | --- | --- | --- |
| `vendor/szadi-fantasy-lands-houses/` | Szadi – Fantasy Lands Houses v1.0 (PNG 37, PSD 포함) | $18 | 상업 사용, 수정 가능, 재판매 금지, 로고/상표 사용 금지, 표기 선택 (`license.txt`) |
| `vendor/raven-gui-starter/` | Raven Fantasy GUI Starter Set | $10 | 상업 사용, 표기 선택, 재배포 금지 |
| `vendor/kenmi-cute-fantasy-ui/` | Kenmi – Cute Fantasy UI | $2.99 | 상업 사용, 재판매 금지 |
| `vendor/raven-fantasy-icons/premium/` | Raven Fantasy Icons Premium (PNG 약 3만 개) | $35 | Premium이라 상업 게임 사용 가능, 표기 선택. 무료판은 비수익 전용이라 쓰지 않음 |
| `vendor/raven-fantasy-icons/extras/` | 같이 받은 추가 팩 3개 (Crops and Food 2, Pets and Animals, Symbols and Runes) | Premium 포함 | 위와 같음 |
| `vendor/elthen-status-effects/` | Elthen – Status Effect Sprites (시트 PNG + JSON) | $3 | 상업 사용, AI 학습 금지, 암호화폐 금지 |

- 전부 "AI와 함께 사용 금지" 조항 없음
- 성 내부는 Szadi CASTLE을 사지 않고 Epic RPG World 재료(왕좌, 카펫, 깃발, 기둥, 석상, 벽 촛대)를 색 보정해서 조립. 부족하면 그때 구매
