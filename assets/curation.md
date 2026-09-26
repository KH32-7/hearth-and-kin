# 에셋 선별표

팩별로 "쓸 것 / 안 쓸 것 / 수정해서 쓸 것"과 이유를 기록. M0에서 채움

## Epic RPG World

(임포트 후 작성)

## LPC

(받은 뒤 작성)

## UI 아이콘

생성: `python tools/build-ui-atlas.py` → `assets/generated/ui/ui-atlas.png`(290x146, .gitignore) + `src/data/ui/atlas.json`, 확인용 `assets/generated/ui/preview.png`.
모든 칸은 원본 픽셀을 그대로 복사함 (확대/필터/다시 그리기 없음, 스크립트가 원본과 바이트 비교로 검증). 항목 사이 2px 투명.
번호 `aN`은 Raven Fantasy Icons `Full Spritesheet/16x16.png`의 N번째 칸(1부터, 한 줄 16개, `Separated Files/16x16/aN.png`와 같은 그림).
`symN`은 Raven extras `Symbols and Runes/Original/16/N.png` (96개 기호 x 13색, 같은 기호는 96 간격).

### 쓸 것: 아이콘 (전부 16x16, Raven Fantasy 계열로 통일)

| 키 | 원본 | 그림 | 비고 |
|---|---|---|---|
| need.hunger | a2262 | 닭다리 | 빵(a2209)은 행동/살림 쪽에 씀 |
| need.energy | Symbols and Runes 385 | 노란 초승달 | Raven extras. 잠(Zz)은 행동 쪽에 씀 |
| need.hygiene | a2510 | 파란 물방울 | 비누 없음. 거품(a2509)은 1배에서 블루베리처럼 보여 목욕 쪽으로 돌림 |
| need.bladder | a2175 | 회색 빈 단지 | 요강 대용. 변기(a3313)는 현대식이라 안 씀 |
| need.fun | a3331 | 파란 음표 | 주사위/카드/류트 그림 없음 |
| need.social | a3334 | 말풍선(…) | 두 사람 그림 없음 |
| need.warmth | a3489 | 불꽃 | |
| need.comfort | a313 | 흰 깃털 | 쿠션/의자 그림 없음 |
| fire | a3494 | 큰 모닥불 | 불 지피기 |
| stew | a2323 | 스튜 그릇 | 끓이기/먹기 공용. 가마솥(a3320)도 후보 |
| warmth | a3489 | 불꽃 | 불 쬐기 = need.warmth 와 같은 그림 |
| water | a300 | 물 담긴 나무 양동이 | 손 씻기/우물/불 끄기 공용 |
| bread | a2209 | 빵 덩이 | 식빵형(a2186)은 현대적이라 안 씀 |
| hygiene | a2510 | 물방울 | 세수 |
| bath | a2509 | 비누 거품 | 목욕 |
| bladder | a2175 | 단지 | 요강 쓰기 |
| outhouse | a16 | 나무 헛간 | 뒷간 전용 그림 없음 |
| sleep | a3615 | 보라 Zz | 선이 가늘어 1배에선 약함 |
| comfort | a313 | 깃털 | |
| clothes | a6465 | 주황 튜닉 | 갈색 튜닉(a6429)은 1배에서 가방처럼 보여 교체 |
| book | a1681 | 붉은 책 | |
| lute | a3331 | 음표 | 류트 그림 없음 (need.fun 과 같은 그림) |
| eye | a2708 | 작은 흰 눈 | 상태 아이콘 계열이라 다른 아이콘보다 작음. 큰 눈(a3175)은 괴물 눈이라 안 씀 |
| plant | a1269 | 붉은 꽃 가지 | |
| yarn | a310 | 붉은 털실 뭉치 | 실 끝이 달린 뭉치. 1배에선 솔방울처럼도 보임 |
| axe | a4473 | 외날 도끼 | |
| candle | a227 | 촛대 | |
| social | a3334 | 말풍선 | |
| logs | Trees and Logs tp14 | 통나무 | Raven premium New updates |
| goto | a105 | 초록 깃발 | |
| item.firewood | Trees and Logs tp14 | 통나무 | 쪼갠 장작 그림 없음 |
| item.water | a300 | 양동이 | |
| item.flour | a2089 | 밀 이삭 | 자루(a398)는 돈주머니처럼 보여 안 씀 |
| item.bread | a2209 | 빵 | |
| item.ingredients | a2025 | 당근 | 채소 바구니 없음 |
| item.yarn | a310 | 털실 | |
| ui.temp | a1505 | 붉은 액체 가는 관 | 온도계 없음 → 시험관을 온도계 대용 |
| ui.clock | a343 | 모래시계 | |
| ui.cancel | a2560 | 붉은 X | |
| ui.auto | a18 | 톱니 | |
| ui.coin | a371 | 금화 | 달러 표시(a400)는 안 씀 |
| ui.crest | a7769 | 흰 방패에 붉은 십자 | 신분 표시용 문장. 무늬 없는 방패(a7713 등)는 "방어"로 읽혀서 문장 무늬 있는 것으로 |
| item.ale | a2199 | 거품 난 손잡이 맥주잔 | 긴 유리잔(a2237)은 현대적 |
| item.herbs | a2083 | 초록 잎 가지 | 약초 다발 그림 없음 |
| item.preserves | a2231 | 체크 뚜껑 잼 단지 | 저장식 |

### 쓸 것: 감정 아이콘 11 (emotions.json 의 icon 키)

얼굴 이모지는 Raven 상태이상 소형 칸(a2657~a2720)에 몇 개(식은땀, 붉은 얼굴, X눈, 메스꺼움)뿐이라 상징 위주로 고르고, 색은 emotions.json 의 color 에 맞춤.
전부 Raven 계열(같은 검은 외곽선/음영). 소형 칸(9px 안팎)과 큰 칸(14~16px)이 섞여 크기감이 다름.

| 키 | 원본 | 그림 | 비고 |
|---|---|---|---|
| emo.happy | a3575 | 금빛 햇살(해 모양 빛살) | 웃는 얼굴 없음 → 해. 1배에선 반짝 폭발처럼도 보임. 후보: 금 클로버 a3123, 금 하트 a3120 |
| emo.energized | a3521 | 노란 번개 | |
| emo.focused | sym99 | 푸른 조준 원(⊕) | 처음 고른 푸른 눈(a3144)은 1배에서 벌레처럼 보여 교체. 작은 눈(a2708)은 구경(eye)과 겹침 |
| emo.excited | a2597 | 분홍 하트 두 개 | 두근거림. 한 개짜리 분홍 하트 a3100 도 후보 |
| emo.inspired | sym714 | 보라 반짝임(✳) | Raven 반짝이 무리(a3125 금, a3141 파랑, a3146 은)에 보라가 없어 기호 쪽 보라 |
| emo.pious | a2606 | 빛나는 흰 십자 | 기도하는 손 그림 없음 → 빛 + 십자 |
| emo.sad | a2936 | 하늘색 눈물방울 | 청결(a2510, 파란 물방울)과 모양이 비슷함. 더 가늘고 옅은 쪽 |
| emo.angry | a2668 | 붉은 화남 표시(💢 모양) | 원래 상태이상 소형 칸. 9px 로 작음. 후보: 붉은 소용돌이 a3098, 붉은 이빨 a2682 |
| emo.tense | a2670 | 식은땀 흘리는 노란 얼굴 | 소형 얼굴 |
| emo.ashamed | a2666 | 뺨이 붉어진 얼굴 | 소형 얼굴. 붉은 얼굴이라 분노로도 읽힐 수 있음 (분노는 💢 로 구분) |
| emo.neutral | sym2 | 회색 원(⊙) | 담담한 원형. 집중(⊕ 파랑)과 같은 기호 모양 계열이라 색으로 구분 |

### 쓸 것: UI 조각

| 키 | 원본 (x,y,w,h) | slice [상,우,하,좌] | 비고 |
|---|---|---|---|
| panel.brown | GUI Starter 16,0,48,48 | 5,5,5,5 | 점선 테두리. 모서리 5px 안에 점선 꺾임이 다 들어감 (가장자리 점선 주기 3px) |
| panel.cream | GUI 64,0,48,48 | 5,5,5,5 | |
| panel.dark | GUI 112,0,48,48 | 4,4,4,4 | 가운데 반투명(알파 192) |
| bar.frame | GUI 16,68,48,8 | 3,3,3,3 | 빈 막대 틀. 채움은 가운데 42x2 영역 |
| bar.frame_metal | GUI 16,52,48,8 | 2,4,2,4 | 쇠 마개 막대 틀 |
| clock.dial | GUI 81,97,30,31 | | 낮밤 원판(받침 다리 포함) |
| clock.night / clock.day | GUI 81,97,15,30 / 96,97,15,30 | | 원판 왼쪽 반(달) / 오른쪽 반(해). 아틀라스에서는 원판 안의 부분 좌표 |
| button.square / _pressed | GUI 0,208,16,14 / 0,320,16,14 | | 빈 키캡. 눌림은 윗면이 2px 내려간 그림이라 같은 칸 크기로 잘라 바꿔 끼우면 됨 |
| button.round / _pressed | GUI 1,160,14,15 / 1,272,14,15 | | 둥근 빈 버튼, 원형 메뉴 항목 배경 겸용 |
| slot.brown / slot.cream | GUI 155,107,26,26 / 203,107,26,26 | 5,5,5,5 | 사각 슬롯 |
| slot.dark | GUI 252,108,24,24 | 4,4,4,4 | |
| slot.metal / slot.wood | GUI 0,48,16,16 / 0,64,16,16 | | 둥근 모서리 작은 칸 |
| ui.select.0 / .1 | Kenmi UI_Selectors 107,10,26,28 / 155,10,26,28 | 10,10,10,10 | 모서리만 있는 선택 표시 2프레임(깜빡임) |
| bubble.speech | Kenmi UI_Pop_Up 14,14,20,24 | 3,4,7,12 | 흰 바탕 검은 테두리 사각 말풍선, 아래 꼬리 포함. 꼬리를 왼쪽 고정 칸(12px) 안에 넣고 오른쪽 4px 띠만 늘림: 늘려도 꼬리 모양은 그대로, 원래 크기에선 가운데, 넓히면 왼쪽으로 치우침. 가운데 띠 균일 확인함 |
| bubble.thought | Kenmi UI_Pop_Up 61,13,22,26 | 5,5,9,13 | 둥근 말풍선(꼬리 포함)을 생각 풍선 대용. 방울 꼬리 생각 풍선은 팩에 없음. slice 방식은 위와 같음 |
| portrait.frame | Kenmi UI_Frames 1064,104,32,32 | | 모서리 장식 양피지 카드, 9-slice 아님. 속이 채워진 판이라 초상화를 위에 얹음. Epic RPG World 원형 슬롯(24px)은 속이 작아서, Kenmi 나무 틀(42px)은 속이 갈색이라 초상화와 대비가 약해서 안 씀 |

### 안 쓸 것

- Raven 현대 물건(전화기, 디스크, 카드 등 a1761~a1888), 현대식 변기 a3313, 달러 a400: 중세 톤과 안 맞음
- Raven 스킬/마법 아이콘(a2753~a4448): 저판타지 톤보다 화려함
- Elthen Status Effects: 32px 애니메이션 효과라 16px HUD 아이콘 규격과 안 맞음 (머리 위 상태 효과용으로 따로 검토)
- Kenmi UI_Icons의 톱니/X: Raven 쪽에 같은 뜻이 있어 한 스타일로 통일. Kenmi는 선택 표시, 말풍선, 초상화 판만 씀
- Symbols and Runes 의 점성술/룬 기호: 감정 뜻으로 읽히지 않음. 원(⊙/⊕)과 반짝임(✳)만 감정에 씀
- Raven GUI Starter 의 하트(0,96 줄): 체력 게이지형(반쪽/빈 하트)이라 감정 아이콘과 톤이 다름
- GUI Starter의 키보드/패드 글자 버튼: 조작 안내 화면이 생기면 그때 추가

### 대체한 것 (원하는 그림이 팩에 없음)

온도계 → 붉은 시험관(a1505), 요강 → 빈 단지(a2175), 류트/주사위/카드 → 음표(a3331), 두 사람 → 말풍선(a3334), 쿠션/의자 → 깃털(a313), 채소 바구니 → 당근(a2025), 밀가루 자루 → 밀 이삭(a2089), 뒷간 → 나무 헛간(a16), 털실 → Raven의 실 끝 달린 뭉치(a310, 1배 가독성 낮음).
감정: 웃는 얼굴 → 금빛 햇살(a3575), 집중 얼굴 → 조준 원(sym99), 영감 → 보라 반짝임(sym714), 기도 → 빛나는 십자(a2606), 화난 얼굴 → 💢 표시(a2668), 무표정 → 회색 원(sym2). 생각 풍선(방울 꼬리) → 둥근 말풍선. 전용 그림이 필요하면 AI 생성 또는 추가 구매 검토 (결정 필요).

## 세계 M4: 작업대, 밭, 작물 (tools/world/build-world.ts)

원칙: Epic RPG World 에 있으면 Epic 우선, 없으면 LPC Revised(OGA-BY, 톤이 Epic 에 가까움) → 그다음 LPC(CC-BY-SA). LPC 는 나무색/초록을 Epic 램프로 색 보정. 생성형 AI 안 씀.

### 작업대

| 물건 | 칸 | 원본 | 고른 이유 |
|---|---|---|---|
| oven 빵 화덕 | 3x1 (북쪽 벽) | Epic interiors fireplace_0 | 아치 입구에 잉걸불 있는 낮은 돌 화덕. 화로(fireplace_1)와 같은 팩이라 부엌 톤 통일. 식으면 잉걸 → 재, 일할 때 잉걸 깜빡임 |
| forge 대장간 화로 | 2x1 | Epic Grass Land blacksmith props_40 / forge1-anim1 + chimney-smoke1 | 팩에 불 애니와 굴뚝 연기가 있음. LPC Revised Forge A 는 256px 급이라 너무 큼 |
| anvil 모루 | 1x1 | LPC Revised Anvils (가장 작은 것) | Epic 모루(51px)는 사람보다 커 보임. 쇠 색은 Epic 모루 램프로 |
| loom 베틀 | 2x1 | LPC Revised Loom | Epic 에 베틀 없음. 팩의 천 덧그림 4단계로 짜는 중 애니 |
| workbench 목공대 | 2x1 | LPC Revised Workbench, Carpentry | Epic 에 목공대 없음. 판자 구간 20px 잘라 2칸에 맞춤 |
| brew_vat 양조통 | 1x1 | Epic Village barrels_3 | 물 담긴 통의 물 → 에일 색, 하이라이트는 거품 |
| salting_tub 소금 절임통 | 1x1 | Epic Village grain-crate_2 (그대로) | 흰 알갱이 든 나무 궤짝 = 굵은 소금 |
| churn 버터 교반기 | 1x1 | Epic Village barrels_1 | 폭을 줄이고 키를 늘린 통 + 뚜껑 + 교반 막대 (막대/뚜껑은 Epic 나무색 점 몇 개) |
| press 과즙 압착기 | 2x1 | Epic Village barrels_0 + 직접 그린 틀 | 어느 팩에도 압착기 없음. 통을 낮게 잘라 과육(Epic 무/밀 색)을 채우고 기둥/보/나사를 Epic 나무·쇠 색 사각형으로 그림 |
| smokehouse 훈제 걸이 | 3x1 | Epic interiors kitchen_props6_3 + Grassland campfire 5/6 + campfire smoke | 고기 걸린 걸이(쇠 → 나무색) 아래 모닥불. 일할 때 잉걸 + 연기 두 줄기. 작은 오두막형은 뒷간과 같아 보여 안 씀 |

### 밭

- field_plot_untilled: Grassland dirt1 to grass - transparency 3x2 조각 (가장자리 풀이 부지 풀과 섞임)
- field_plot_tilled: Grassland plowed soil and watered.png 의 둥근 돌 테두리 밭을 16px 모서리 9조각으로 3x2 에 맞춤
- garden_plot_empty/tilled: 밭 흙(다진 흙/고랑) + Epic 나무색 낮은 판자 틀. 높은 상자(grain-crate_5)는 작물 덧그림이 상자 앞면에 그려져서 안 씀
- 작물 원본은 LPC crops 보다 Epic Grassland 2.0 crops update(8단계, 같은 외곽선/밝기)가 세계와 맞아 Epic 을 씀. 단계 1~5 → 우리 0~4 (0 씨앗, 6·7 수확 아이콘은 안 씀)

### 작물 (crop_<id>_<0~4>, assets/generated/world/crops.png 한 장)

| 우리 작물 | 원본 (Epic sheet4-sprites) | 색 바꿈 |
|---|---|---|
| wheat 밀 | crops-wheat | 0~2 잎 초록, 3 연두 (원본은 싹부터 금색이라), 4 원본 |
| barley 보리 | crops-wheat | 위 + 익음을 옅은 짚색 |
| oats 귀리 | crops-wheat | 위 + 익음을 흰빛 베이지 |
| rye 호밀 | crops-wheat | 잎 청록빛, 익음 회갈색 |
| beans 콩 | crops-green bean | 없음 |
| flax 아마 | crops-wheat | 줄기 초록, 3 이삭 윗부분 파란 꽃, 4 갈색 꼬투리 |
| turnip 순무 | crops-radish | 붉은 뿌리 → 위 보라/아래 흰색 |
| cabbage 양배추 | crops-red cabagge | 보라/회보라 → bok choy 연두 |
| onion 양파 | crops-garlic | 흰 알뿌리 → 황갈색 (감자 색) |
| leek 대파(리크) | crops-garlic | 잎 청록, 흰 줄기 유지 |
| herbs 허브 | crops-tomato | 붉은 열매 → 연보라 꽃 |
| medicinal_herbs 약초 | crops-blueberry | 열매 → 흰 꽃, 잎 회녹색 |
| moonwort 달풀 | crops-artichoke | 은청록 잎, 봉오리 푸른 흰색 (33-0: 수수한 색만, 빛 효과 없음) |
| crop_weeds 잡초 | Grassland grass tufts 3/7/12 | 없음 (한 칸에 세 포기) |

### 과수 (orchard_<apples|pears|grapes>_<0 잎|1 꽃|2 열매>, 2x2)

- apples/pears: LPC Fruit Trees (CC-BY-SA, SHARE_ALIKE.md). Epic 나무는 128x224 로 부지에 비해 너무 크고 열매판이 없음. 초록/줄기를 Epic 램프로 색 보정, 꽃은 열매 픽셀을 옅은 분홍-흰으로
- grapes: Epic crops-grape 3/4/5 (시렁 포도) 를 2x2 로 네 칸 배치, 꽃 단계는 4단계 송이를 연두로

### 못 구한 그림 / 대안

- 압착기: 팩에 없음 → 통 + 직접 그린 틀 (위)
- 버터 교반기: 팩에 없음 → 통 변형
- 아마/순무/양파/리크/보리/귀리/호밀/허브/약초/달풀: 전용 그림 없음 → 가장 가까운 Epic 작물 색 바꿈 (위 표)
- 사과/배 꽃 단계: LPC 과수에 꽃판 없음(벚나무만) → 열매 자리 색 바꿈

