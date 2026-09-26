---
type: reference
tags:
  - domain/gamedev
  - topic/assets
created: 2026-09-25
---

# Mana Seed (보류)

> [!info] 상태: 보류
> 사용자가 가진 Epic RPG World Collection(32px)으로 세계를 채우기로 하면서 보류. Epic RPG World로 부족하다고 판단될 때 다시 검토하기 위해 조사 내용을 보관함
> **본문 수치와 참조는 보류 시점 기준**임. 현재 세계 에셋과 배율은 `04_에셋_목록.md`, 현재 GDD 규칙은 `gdd/`를 따름

> [!warning] Mana Seed 라이선스 (2026-09-25 사용자 확인 후 진행)
> Mana Seed 라이선스는 **AI로 만든 이미지, 글, 코드와 한 프로젝트에서 함께 쓰는 것을 금지**함 ([라이선스](https://selieltheshaper.weebly.com/user-license.html), [제작자 답변](https://itch.io/post/12516802)). 유료/무료 배포와 상관없이 적용되는 조항. 사용자가 이 조항을 알고 진행하기로 결정함. **공개 배포(무료 포함) 전에 다시 검토할 것**. 그 밖의 조건: 구매 1회당 프로젝트 1개, 표기 선택, 원본 재배포 금지(공개 레포에 올리지 않음), web3 금지, 굿즈 제작 금지

> [!warning] 생성형 AI와의 충돌
> 이 프로젝트는 생성형 AI 이미지를 쓰기로 함 (GDD 28-5). Mana Seed를 쓰려면 `assets/AI_GENERATED.md`의 모든 파일을 먼저 AI 없이 만든 것으로 바꿔야 함

---

## 1. 크기와 배율


| 항목 | Mana Seed (세계) | LPC (사람, 동물, 괴물) |
| --- | --- | --- |
| 원본 규격 | 타일 16px | 타일 32px, 캐릭터 64×64 프레임 (키 약 48px) |
| 추천 화면 배율 | **3배** (타일 48px) | **2배** (캐릭터 키 약 96px = 타일 2칸) |
| 결과 | Mana Seed가 의도한 "캐릭터 키 = 타일 2칸" 비율 그대로 | |

- 현재 세계는 Epic RPG World 32px + LPC 보충, 2배 (`04_에셋_목록.md` 1절). 교체하면 세계만 Mana Seed 3배로 바뀜 (이 문서 4절)
- 둘 다 정수 배율이라 픽셀은 선명함. 다만 **사람의 픽셀 알갱이가 배경보다 작게 보임** (2:3). 이게 거슬리는지는 화면으로 봐야 앎
- 교체 단계(MS)에서 **비율 시험**: (가) 세계 3배 + 사람 2배, (나) 세계 2배 + 사람 1배(사람이 조금 작아짐), 두 가지를 같은 방에서 찍어 비교하고 DECISIONS.md에 기록
- 가구 사용 위치(앉는 자리, 눕는 자리)는 물건 데이터의 슬롯 좌표로 맞춤 (13장 사용 슬롯)
- 줌은 세계/사람 배율 쌍을 함께 바꿈 (예: 3/2 → 6/4)

---

## 2. 구매 (당시 계획)

| 묶음 | 소계 |
| --- | --- |
| 2-1. Mana Seed 번들 | $99.99 |
| 2-2. Mana Seed 추가 팩 | $78.95 |
| 2-3. UI, 아이콘, 효과, 음악 (`04_에셋_목록.md` 5-1절) | 약 $87.24 |
| **합계** | **약 $266** (itch.io 세금 별도, 유로 가격은 달러 환산 추정) |

- 처음 예산 $100을 넘음. 줄여야 하면 `04_에셋_목록.md` 5-1절 끝의 우선순위대로 뒤에서부터 뺌

### 2-1. Mana Seed 번들 ($99.99)

| 상품 | 가격 | 받기 |
| --- | --- | --- |
| **Make A Farming Sim Bundle** (Mana Seed 28개 팩, 정가 합계 $266.82) | **$99.99** | [itch.io 번들](https://itch.io/s/130490) |

- itch.io 결제 시 세금이 붙으면 $100을 조금 넘을 수 있음
- 번들 종료일은 페이지에 표시되지 않음 (바뀔 수 있으니 확인 후 구매)
- **구매 시점**: 교체 단계(MS) 직전. 2-2의 추가 팩도 이때. 5-1절(UI, 아이콘, 효과, 음악)은 개발 단계에서 바로 필요하면 먼저 사도 됨

### 번들에 든 것과 쓰는 곳

| 팩 | 개별가 | 이 게임에서 |
| --- | --- | --- |
| [Thatch Roof Home](https://seliel-the-shaper.itch.io/thatch-roof-home) | $17.99 | 농노/자유민 초가집 (건축 모드) |
| [Stonework Home](https://seliel-the-shaper.itch.io/stonework-home) | $17.99 | 석조 집 (상인, 기사) |
| [Timber Roof Home](https://seliel-the-shaper.itch.io/timber-roof-home) | $17.99 | 목재 지붕 집 |
| [Half-Timber Home](https://seliel-the-shaper.itch.io/half-timber-home) | $17.99 | 반목조 집 (장인). 4종 모두 같은 배치라 서로 바꿔 끼울 수 있음 |
| [Cozy Furnishings](https://seliel-the-shaper.itch.io/cozy-furnishings) | $16.99 | 가구 250개 이상: 침대, 아기 침대, 목욕통, 탁자, 궤짝, 서랍장, 찬장, 조리대, **왕좌**, 갑옷 장식, 작업대 |
| [Village Accessories](https://seliel-the-shaper.itch.io/villageaccessories) | $7.99 | 장터 노점, 우물, 수레, **뒷간**, 개집, 간판, 통 |
| [Fences & Walls](https://seliel-the-shaper.itch.io/fencesandwalls) | $7.99 | 울타리, 담 |
| [Animated Candles](https://seliel-the-shaper.itch.io/animatedcandles) | $5 | 촛불 광원 |
| [Spring](https://seliel-the-shaper.itch.io/spring-forest) / [Summer](https://seliel-the-shaper.itch.io/summer-forest) / [Autumn](https://seliel-the-shaper.itch.io/autumn-forest) / [Winter Forest](https://seliel-the-shaper.itch.io/winter-forest) (정식판) | 각 $19.99 | 사계절 지형, 절벽, 물, 나무. 같은 배치라 계절 교체가 쉬움 |
| [Weather](https://seliel-the-shaper.itch.io/weather-effects) | $6 | 비, 눈, 번개, 구름, 눈 덮임 (안개는 없음 → 직접) |
| [Farming Crops #1](https://seliel-the-shaper.itch.io/farming-crops) / [#2](https://seliel-the-shaper.itch.io/farming-crops-2) | 각 $9.99 | 작물 성장 5단계, 씨앗/수확물 아이콘 (31장 농사) |
| [Growable Trees](https://seliel-the-shaper.itch.io/growable-trees) / [Growable Fruit Trees](https://seliel-the-shaper.itch.io/fruit-trees) | $9.99 / $14.99 | 자라는 나무, 과수원 |
| [Livestock](https://seliel-the-shaper.itch.io/livestock) / [Livestock Accessories](https://seliel-the-shaper.itch.io/livestock-accessories) | $19.99 / $8.99 | 닭, 소, 돼지, 오리 / 닭장, 여물통, 건초, 달걀·양털·우유 아이콘 |
| [Hardy Horse](https://seliel-the-shaper.itch.io/hardy-horse) | $19.99 | 말 18색 (LPC 말과 비교해 선택) |
| [Delicate Deer](https://seliel-the-shaper.itch.io/animated-deer) | $5 | 사슴 |
| [Smithing Gear](https://seliel-the-shaper.itch.io/smithing-gear) | $12.99 | 화로, 모루, 광석, 주괴 (대장장이 직업) |
| [Fishing Gear](https://seliel-the-shaper.itch.io/fishing-gear) | $9.99 | 낚시 |
| [Traveler's Camp](https://seliel-the-shaper.itch.io/travelers-camp) | $5 | 여정/원정 야영지 |
| [NPC Pack #1](https://seliel-the-shaper.itch.io/npc-pack) / [#2](https://seliel-the-shaper.itch.io/npc-pack-2) | 각 $9.99 | 고정 NPC (아기, 노인, 왕, 기사, 수녀, 아이 등). **사람은 LPC로 통일하므로 참고용** |
| [Farmer Sprite System](https://seliel-the-shaper.itch.io/farmer-base) (정식판) | $29.99 | 앉기, 잠, 들기, 대장일, 공예, 젖 짜기 등 150개 이상 동작. **사람은 LPC로 그리므로, LPC에 없는 생활 동작을 만들 때 자세와 타이밍 참고용** |
| [Mana Seed Font Collection](https://seliel-the-shaper.itch.io/mana-seed-fonts) | $4 | 라틴 문자만. 쓰지 않음 (폰트는 넥슨 워헤이븐체) |

### 2-2. Mana Seed 추가 팩 ($78.95)

| 팩 | 가격 | 이유 |
| --- | --- | --- |
| [Iconic Castle](https://seliel-the-shaper.itch.io/iconic-castle) | $19.99 | 성 내부, 왕좌, 왕실 부엌 (사면 `04_에셋_목록.md` 4절의 "성 내부" 직접 제작이 필요 없어짐) |
| [Fortified Keep](https://seliel-the-shaper.itch.io/fortified-keep) | $19.99 | 요새, 성문 |
| [Alchemy Gear](https://seliel-the-shaper.itch.io/potion-pack) | $12.99 | 연금술 도구, 물약 (33장 마법) |
| [Emoji Pack](https://seliel-the-shaper.itch.io/emoji-pack) | $7 | 16px 감정 말풍선 96개 |
| [Grand Library](https://seliel-the-shaper.itch.io/grand-library) | $14.99 | 수도원 서고 |
| [Bridges & More](https://seliel-the-shaper.itch.io/bridgesandmore) | $10.99 | 다리 |

---

## 3. 직접 그려야 했던 세계 물건


| 항목 | 참고 원본 | 난이도 |
| --- | --- | --- |
| 교회 내부 (신도석, 제단, 설교대, 스테인드글라스) | LPC Castle Mega-Pack, Cozy Furnishings 벤치 | 중간 |
| ~~성 내부~~ | Iconic Castle 구매로 해결 (2-2) | - |
| 여관 바, 술통 진열 | LPC Tavern, Village Accessories 통 | 낮음 |
| 물레, 베틀 | LPC Tailor | 중간 |
| 요강, 요람, 캐노피 침대 | Cozy Furnishings 침대/아기 침대 변형 | 낮음 |
| 안개 효과 | Weather 구름 효과 변형 | 낮음 |
| 마법진, 저주 연기, 주문 발광 | [Foozle CC0 효과](https://foozlecc.itch.io/pixel-magic-sprite-effects) 참고 | 낮음 |
| 욕구 아이콘 8개, 감정 아이콘 11개 | 16px | 낮음 |

- 제작 방식: 코딩 에이전트가 픽셀 편집 스크립트로 만들고 확대 스크린샷으로 검수. 품질이 안 나오는 것(유아 몸 등)은 사람이 직접 찍거나 외주 (DECISIONS.md에 기록)
- **Mana Seed 쪽 그림은 Mana Seed 공식 팔레트만 사용** (팔레트 검사 스크립트)
- 생성형 AI 사용 가능 (GDD 28-5). AI로 만든 파일은 `assets/AI_GENERATED.md`에 기록. **Mana Seed로 교체하려면 그 전에 AI 이미지를 전부 대체해야 함**

---

## 4. 화면 배율 (LPC → Mana Seed 교체 시)

| 단계 | 세계 | 사람/동물/괴물 | 캐릭터 키 |
| --- | --- | --- | --- |
| 현재 (Epic RPG World + LPC) | 32px 타일 × **2배** | LPC × **2배** | 타일 약 1.5칸 |
| Mana Seed 교체 후 | Mana Seed 16px 타일 × **3배** | LPC × **2배** (그대로) | 타일 약 2칸 |

- 교체하면 **캐릭터가 타일 대비 커짐** (1.5칸 → 2칸). 방이 좁게 느껴질 수 있어서, 부지/방 크기와 가구 배치는 교체 후 한 번 다시 조정
- 게임 로직(길찾기, 가구 칸, 사용 슬롯)은 픽셀이 아니라 **타일 칸 단위**라서 교체해도 그대로 (BRIEF 1장 "아트 팩")

## 5. 교체할 때 할 일

1. Mana Seed 번들 구매 (이 문서 2절)
2. `src/data/artpacks/manaseed.json` 작성: 물건 id → Mana Seed 스프라이트 좌표, 타일셋 매핑, 배율 (LPC 팩과 같은 형식)
3. 물건 데이터의 칸 크기와 사용 슬롯이 새 그림과 맞는지 검사 (스크립트 + 스크린샷)
4. 집 타일 자동 배치 규칙을 Mana Seed 집 4종 형식에 맞게 추가
5. 미리 만든 집/부지 크기 재조정, 봇 테스트로 stuck 0 확인
6. "교체 후" 표시된 직접 제작 물건을 Mana Seed 크기로 제작
7. 교체 전후 같은 방 스크린샷 비교 (03 프롬프트 V)

