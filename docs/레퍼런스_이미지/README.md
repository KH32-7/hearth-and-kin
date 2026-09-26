# 레퍼런스 이미지 & 영상 정리

2026-09-26 수집. 여기 있는 스크린샷은 남의 유료 에셋 목업이므로 **참고용 전용**이다. 게임에 넣거나 공개 레포에 올리지 말 것 (`.gitignore` 처리함).

## 폴더

| 파일/폴더 | 출처 | 장수 |
|---|---|---|
| `00_사용자_참고_마을.jpg` | 사용자 제공 (세로 구도 마을 광장 픽셀아트) | 1 |
| `01_Village/` | Rafa Pixel, *The Village asset pack - pixel art mockup collection* (youtube.com/watch?v=bJjjdi_5iqQ, 2:41) | 27 |
| `02_Ancient_Ruins/` | Rafa Pixel, *Ancient Ruins asset pack - pixel art mockup collection* (youtube.com/watch?v=BIvWwCrn00w, 2:00) | 20 |
| `03_Grass_Land_2/` | Rafa Pixel, *Grass Land 2.0 asset pack - pixel art mockup collection* (youtube.com/watch?v=Z5m7ERGjwLY, 1:27) | 12 |

파일명의 `tMM_SS`가 영상 속 시각이다. 1920×1080 원본 해상도에서 장면마다 한 장씩 뽑았고, 카메라가 이동하는 장면은 여러 장 찍었다. 목업 영상은 가운데 선명한 장면 좌우에 흐린 배경을 까는 편집이라, 사진 양옆이 흐린 건 원래 그렇다.

### 장면 목록

- **Village**: 헛간(인트로), 생선가게와 줄무늬 차양 노점, 모닥불 앞 목조주택과 마을 사람들, 반목조 2층집 앞 군중, 섬 위의 탑집, 풍차, 반목조 집과 망루, 붉은 기와 대저택, 강가의 뼈 장식, 보라색 포장 광장(3장), 파란 지붕 집과 유르트, 강을 낀 보라 지붕 저택, 갈색 집들, 물레방아 저택, 회색 지붕 집, 건물 단품 모음 9장(지붕색과 규모별), 붉은 깃발 마을
- **Ancient Ruins**: 신전 원경과 근경, 폭포, 원형 제단, 붉은 사당, 숲과 폐허를 가로지르는 패닝 5장, 물가 전투, 곰이 있는 숲, 풀밭 길, 돌 광장, 붉은 포장 제단, 숲 2장, 오솔길 2장, 포털
- **Grass Land 2.0**: 목조 오두막(지붕 변형 2장), 모닥불, 토템 기둥, 거대 해골, 천막 야영지, 강과 나무다리 2장, 주황 흙길 교차로, 해변으로 이어지는 패닝 3장

---

## 영상 4: Tiled 오토타일 기법 (Rafa Pixel, *Tiled Map Editor | Grass Land Asset Pack | How to use Auto-tile for cliffs and terrains*, youtube.com/watch?v=uwTSDSNgY8s, 8:22)

내레이션 없이 배경음악만 있는 화면 녹화라서, 아래 내용은 전부 화면(레이어 패널, 터레인 세트 이름, 메뉴)을 보고 정리했다.

### 1. 터레인 세트는 전부 Corner 방식
- 타일 32×32. 모든 터레인 세트의 Type이 **Corner**다(Tiled의 Wang corner set). 타일 네 모서리에 재질을 지정해 두면, 칠할 때 이웃 모서리를 맞춰 전이 타일을 자동으로 고른다.
- 타일셋 이미지는 재질마다 **십자(+) 모양 블롭 견본**으로 배치되어 있다. 볼록 모서리, 오목 모서리, 가장자리가 한 덩어리에 모두 들어가서 세트 하나를 한눈에 검수할 수 있다.

### 2. 재질 쌍마다 전용 전이 세트
- 이름이 `A to B` 꼴이다: Grass to water, lighter grass to darker grass, darker grass to lighter grass, dirt to darker/lighter grass, dirt2 to dirt, leaves to darker grass, stone path to darker/lighter grass, gravel to darker/lighter grass (2), stone ground to dirt/gravel, tall grass to lighter grass 등.
- 같은 흙이라도 **어두운 풀 위에 놓일 때와 밝은 풀 위에 놓일 때** 테두리 색이 다른 세트를 따로 쓴다. 전이 테두리가 바탕색과 어긋나 보이지 않게 하려는 것이다.
- 물은 `Grass to water`와 `Grass to water2` 두 가지다. 물가 흙벽이 있는 버전과 없는 버전.

### 3. "to any terrain (transparency)" 세트로 조합 수를 줄임
- `gravel to any grass (transparency)`, `stone path to any terrain (transparency)`, `leaves to any terrain (transparency-higher contrast)`, `rough stone to any terrain`, `tall grass to any terrain`, `darker/lighter grass to transparency` 등.
- 전이 타일의 바깥쪽이 **투명**이라, 별도 레이어에 칠하면 아래 무엇이든 위에 얹힌다. 재질 N개를 쌍으로 다 만들면 N² 세트가 필요한데, 이 방식은 재질당 한 세트면 된다.
- 레이어 순서(아래에서 위로): `water` → `grass_to_water_platform` → `terrain` → `terrain2` → `Tile Layer 7`(투명 전이 세트용) → `fence` → `grass_platform`. **재질층마다 레이어를 나누고 겹쳐 쌓는** 구조다.

### 4. 절벽은 오토매핑 규칙으로 자동 생성
- 따로 `cliff-grass_platform_rule.tmx` 규칙 맵을 둔다. 레이어는 `input_grass_platform` / `output_grass_platform` / `regions_input` / `regions_output`.
- 작업자는 `grass_platform` 레이어에 **윗단 풀 영역만 칠한다**. `Map > AutoMap`(Ctrl+M) 또는 `AutoMap While Drawing`을 켜 두면, 규칙이 윗단 가장자리 아래에 흙 절벽면 타일을 알아서 붙인다(3:00–3:30 구간에서 칠하는 즉시 절벽이 생기는 게 보임).
- 절벽용 타일셋(`tileset-cliff`)에도 `cliff` Corner 세트가 따로 있다.

### 5. 울타리와 낮은 벽도 터레인 세트로
- `Wooden Fence`, `stone fence-like`, `Wooden Fence with no grass (transparency)`, `half-sized wall (transparency)`, `half-sized wall (smaller)` 같은 선형 구조물도 터레인 브러시로 **길 그리듯** 그으면 모서리와 끝이 자동으로 맞춰진다(6:20–7:30).

### 우리 게임에 적용할 점
- 현재 `src/render/WorldView.ts`의 `TerrainSet`(이웃을 보고 전이 타일 선택)이 1~2번에 해당한다. 3번 **투명 전이 레이어**를 들이면 Epic RPG World 재질 조합이 늘어나도 세트 수가 선형으로만 는다.
- 4번 절벽 규칙은 "윗단 영역 값 → 아래 칸에 절벽면 파생" 규칙으로 옮길 수 있다. 게임 로직에는 칸 단위 높이값만 두고, 절벽 그림은 artpack 쪽에서 파생시키면 CLAUDE.md의 "로직은 칸 단위만" 규칙과 맞는다.
- 5번은 울타리와 담장 물건에 그대로 쓸 수 있다(선형 자동 연결).

---

## 영상 5: 2D 실시간 그림자 (Fishy Games, *How I Made Real-Time Shadows in 2D*, youtube.com/watch?v=NP2rICXE_gQ, 24:05)

아이소메트릭 픽셀 게임 *Idlefisher*에 태양 방향이 바뀌는 그림자를 넣기까지 시도한 방법들을 순서대로 보여 준다. 결론은 **손으로 그린 높이맵 + 화면 공간 레이마칭**이다.

### 실패한 방법들 (왜 안 됐나)
1. **스프라이트 찌그러뜨리기**(1:14): 스프라이트를 다시 그리되 윗변 두 꼭짓점을 높이만큼 x로 밀고 알파를 반으로 낮춘다. 나무처럼 얇은 물체는 괜찮다. 하지만 건물이나 테이블 같은 큰 형태는 늘어나 보이고, 그림자가 물체 아래나 앞에 깔리며, 다른 물체를 감싸지 못한다.
2. **스프라이트를 3D로 세우고 섀도 매핑**(3:13): 윗 꼭짓점에 깊이를 줘 판을 세우고, 태양 시점 깊이맵을 만든 뒤 다시 그리며 비교한다(자기 그림자 방지 bias 포함). 판이 평면이라 건물 전체가 **이미지 바닥선 하나**를 기준으로 판정되어서 지붕이나 창틀 같은 세부가 사라진다.
3. **완전 3D 모델 + 섀도 매핑**(6:35): 그림자 자체는 완벽했지만 **픽셀아트와 선이 맞지 않았다**. 몇 달을 쓰고 포기했다.

### 최종 방법: 픽셀별 높이맵 + 레이마칭
- **발상**(8:12): 판을 쪼갤 수 없다면 픽셀마다 깊이를 알려 주면 된다. 처음엔 월드 좌표 X/Y/Z를 RGB에 담아 그렸다(11:30). 그런데 X는 이미 아는 값이라 버리고, Z는 "픽셀을 높이만큼 아래로 내리면 바닥에 닿는 자리"로 계산된다. 결국 **높이(Y) 하나만 남는 흑백 높이맵**이 된다(검정=낮음, 흰색=높음, 255 단계 한도).
- **렌더링**(13:47): 각 이미지에 `<원본경로>_heightmap` 변형을 두고 별도 렌더 큐에 모아 프레임 끝에 한꺼번에 그린다. 그림자 셰이더가 이미지마다 따로 돌면 서로에게 그림자를 드리울 수 없어서, **모든 높이맵을 한 장으로 합친다**(18:26).
- **셰이더**(14:37, 16:25 화면 코드):
  - 태양 방향 `sunDir`, 자기 그림자 방지 `bias = 0.0075`, 허용 오차 `margins = 1.5/255`.
  - 현재 픽셀에서 태양 쪽으로 **1픽셀씩 최대 150걸음** 이동한다. 걸음마다 좌표를 반올림하고, 빛을 막으려면 필요한 높이 `desiredHeight = startHeight + roundedLoc.y/255 + bias`를 계산한다.
  - 그 자리 높이맵 값이 필요 높이의 ±margin 안에 들면 가려진 것으로 보고 `FragColor = vec4(0,0,0,0.6)`을 낸다. 투명 픽셀은 건너뛴다.
  - 태양 방향을 마우스에 물리면 아침부터 밤까지 그림자가 돈다(17:14). 그림자를 받을 바닥 높이맵도 필요하다.
- **캐릭터**(17:41): 캐릭터도 높이맵을 가진다. 처음에 높이를 부두 높이로 박아 넣었더니 지형이 바뀌면 떠 버렸다. 그래서 캐릭터 높이맵은 0부터 시작하고, **발밑 지형 높이를 샘플해 더한다**. 계단에서 떨림이 생겨서 세부를 뺀 **매끈한 두 번째 지형 높이맵**을 따로 만들어 이것만 샘플한다(20:07).
- **뒷면 높이맵**(21:24): 높이맵은 윗면, 왼면, 오른면처럼 보이는 면만 안다. 그래서 그림자가 납작한 판처럼 드리워진다. 선택적으로 **뒷면용 두 번째 높이맵**을 두고 별도 "behind shadow" 레이어에 그린 다음, 셰이더가 두 장 모두 검사한다. 부피감이 크게 좋아진다.
- **남은 문제**(22:07): 앞 물체(나무)의 높이맵이 뒤 물체의 높이 정보를 덮어써서 뒤쪽 그림자가 사라진다. 물체마다 레이어를 나누면 풀리지만 비용이 크다. 작성자는 눈에 잘 안 띄어서 보류했다.
- **작성자 회고**: "처음부터 3D로 만들고 후처리로 픽셀화했으면 더 빨랐을 것."

### 우리 게임에 적용할 점
- 지금 캐릭터 그림자는 `CharacterView.ts`의 **타원 블롭**(opacity 0.35)이다. 위 1번보다도 단순한 단계이고, 그림자가 물체를 감싸지 않는다.
- 높이맵 방식을 쓰려면 Epic RPG World 건물과 소품마다 **높이맵을 손으로 그리거나 AI로 생성**해야 한다. 이는 에셋 파이프라인 변경이고, AI로 만들면 `assets/AI_GENERATED.md`에 기록해야 한다. 셰이더 자체는 Three.js `ShaderMaterial`로 영상 코드 그대로 옮길 수 있다.
- 우리 게임은 탑다운(정면 3/4) 시점이라 아이소메트릭보다 높이맵 그리기가 단순하다. 건물은 벽면 세로 그라데이션에 지붕 경사만 넣으면 된다.
- 시간 흐름이 심즈식이므로 하루 동안 태양 방향이 도는 연출에 잘 맞는다. 도입할지는 설계 결정 사항.
