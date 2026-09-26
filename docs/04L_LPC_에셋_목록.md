---
type: reference
tags:
  - domain/gamedev
  - topic/assets
created: 2026-09-25
---

# LPC 에셋 목록 (사람, 동물, 괴물 + 세계 보충)

> [!summary] 역할
> - **사람, 동물, 가축, 일부 괴물**: LPC를 그대로 사용 (신분 7단계, 임산부, 아이, 노인)
> - **세계**: 중심은 사용자가 가진 Epic RPG World (32px). 거기 없는 것(작물, 과일나무, 가축 우리, 봄/가을, 교회/성/여관 내부 가구, 물레/베틀 등)만 LPC로 채움
> - 둘 다 32px라 같은 2배 배율. LPC 쪽 색은 Epic RPG World 톤에 맞춰 보정 (`04_에셋_목록.md` 1절)

- 2026-09-25에 스토어/라이선스/GitHub 페이지를 열어 확인함. 파일을 받아 열어 본 건 아님
- 받는 방법: **GitHub**는 초록색 `Code` → `Download ZIP`, **OpenGameArt**는 페이지 아래 `File(s)` 목록, **itch.io**는 `Download` 또는 `Buy Now`

---

## 1. 받을 것 (전부 무료)

| # | 에셋 | 받기 | 쓰임 |
| --- | --- | --- | --- |
| L1 | Universal LPC 캐릭터 생성기 | [GitHub](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator) · [웹 도구](https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/) | **그대로 사용** (모든 사람) |
| L2 | LPC Revised (물건, 건축, 사계절) | [GitHub](https://github.com/ElizaWy/LPC) | Epic RPG World에 없는 부분만 (주로 봄/가을, 농사 물건) |
| L3 | LPC Revised 사계절 타일셋 (Tiled 설정 포함) | [OpenGameArt](https://opengameart.org/content/lpc-revised-fully-configured-4-seasons-tilesets-for-tiled-map-editor) | Epic RPG World에 없는 부분만 (주로 봄/가을, 농사 물건) |
| L4 | [LPC] Wooden Furniture | [OpenGameArt](https://opengameart.org/content/lpc-wooden-furniture) | Epic RPG World에 없는 가구만 (침대, 탁자, 벤치, 서랍장 나무색 변형) |
| L5 | [LPC] House Interior & Decorations | [OpenGameArt](https://opengameart.org/content/lpc-house-interior-and-decorations) | Epic RPG World에 없는 집 내부 가구와 장식만 (선반, 불 붙는 화덕, 궤짝, 책) |
| L6 | [LPC] Tailor (베틀, 물레) | [OpenGameArt](https://opengameart.org/content/lpc-tailor) | 그대로 사용 (Epic RPG World에 없음) |
| L7 | [LPC] Medieval Village Decorations | [OpenGameArt](https://opengameart.org/content/lpc-medieval-village-decorations) | Epic RPG World에 없는 마을 장식만 (장터 노점, 광장, 묘지, 간판, 깃발) |
| L8 | [LPC] Thatched-roof Cottage / [LPC] Roofs | [Cottage](https://opengameart.org/content/lpc-thatched-roof-cottage) · [Roofs](https://opengameart.org/content/lpc-roofs) | Epic RPG World에 없는 건축 부품만 (반목조 벽, 초가/슬레이트/널 지붕 재질) |
| L9 | [LPC] Cats and Dogs / Horses / Farm Animals | [개·고양이](https://opengameart.org/content/lpc-cats-and-dogs) · [말](https://opengameart.org/content/lpc-horses) · [가축](https://opengameart.org/content/lpc-style-farm-animals) | **그대로 사용** |
| L10 | 괴물, 마법 효과, 농사, 건물 내부 팩 | 3절 표의 링크 | 괴물(GDD 33-3 허용 목록 중 Epic RPG World에 없는 것), 농사, 건물 내부 가구는 그대로 사용. 허용 목록 밖 괴물과 큰 주문 효과는 쓰지 않음 |

- 유료 UI, 아이콘, 효과, 음악과 폰트, 효과음은 `04_에셋_목록.md` 5절과 5-1절 (LPC 개발 단계에서도 그대로 사용)

---

## 2. LPC 퀄리티를 끌어올리는 작업

LPC가 아쉬워 보이는 가장 큰 이유는 **기여자가 여럿이라 팔레트와 음영 방식이 제각각**이기 때문. LPC로 쓰는 것(사람, 동물, 작물 등)을 **Epic RPG World 톤에 맞추는 색 보정**이 핵심

| 작업 | 방법 |
| --- | --- |
| 기여자 고르기 | 한 장면에 섞이는 것은 가능한 한 같은 작가 것으로. `assets/curation.md`에 작가 기록 |
| 인물 팔레트 통일 | 피부/머리/옷 색 조회표 팔레트로 통일 (생성기 레이어 간 색 차이 제거) |
| 광원 방향 통일 | LPC 표준(좌상단 광원)과 다른 스프라이트는 음영 수정 |
| 외곽선 규칙 | 외곽선 색을 대상 색보다 어두운 같은 계열로 통일 |
| 조명 시스템 | 시간대 색 보정 + 광원 스프라이트 + 창문 빛 (BRIEF 1장) |
| 비주얼 비평 | 03 프롬프트 V로 장면별 블라인드 비교 |

---

## 3. LPC 상세

| 팩 | 내용 | 라이선스 |
| --- | --- | --- |
| [Universal LPC 캐릭터 생성기](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator) | 체형: 남/여/근육/**임신**/**청소년**/**아동**, **노인 머리**, 주름, 휠체어. 성인 동작: 걷기, 대기, **앉기**, **감정 표현**, 달리기, 점프, 오르기, 다침, 전투(베기/찌르기/쏘기). 아동 동작: 걷기, 대기, 앉기, 점프, 다침, 베기. 옷: 튜닉, 앞치마, 드레스, 로브, 왕관, 갑옷 등 | 레이어마다 다름: CC0, CC-BY, OGA-BY, CC-BY-SA, GPL. **모든 작가 표기** (생성기가 CREDITS.csv 출력) |
| [LPC Revised](https://github.com/ElizaWy/LPC) | 침대(1인/2인/**아이**), 벽난로, 가마솥, **베틀**, **물레**, 대장일, 궤짝, 서랍장, 탁자. **건축: 벽, 문, 창, 바닥, 지붕, 울타리**. **사계절 지형과 나무** | CC-BY 3.0 / OGA-BY 3.0 (**동일조건 없음**). 이 팩의 캐릭터는 쓰지 말 것 (생성기와 비율 다름) |
| [Wooden Furniture](https://opengameart.org/content/lpc-wooden-furniture) | 침대, 탁자, 벤치, 서랍장 나무색 4종 | CC-BY-SA 3/4, GPL3 |
| [House Interior & Decorations](https://opengameart.org/content/lpc-house-interior-and-decorations) | 침대, 선반, 불 붙는 화덕, 궤짝, 책 | CC-BY-SA, GPL |
| [Tailor](https://opengameart.org/content/lpc-tailor) | **움직이는 베틀과 물레** | OGA-BY / CC-BY / GPL |
| [Medieval Village Decorations](https://opengameart.org/content/lpc-medieval-village-decorations) | **장터 노점**, 광장, 묘지, 간판, 등불, 깃발, 울타리 (Tiled .tsx) | CC-BY-SA 3/4 |
| [Thatched-roof Cottage](https://opengameart.org/content/lpc-thatched-roof-cottage), [Roofs](https://opengameart.org/content/lpc-roofs) | 반목조 벽, 초가/슬레이트/널 지붕 | CC-BY-SA 3, GPL3 |
| [Cats and Dogs](https://opengameart.org/content/lpc-cats-and-dogs) | 4방향 걷기, **잠**, 먹기 | CC-BY / SA / GPL / OGA-BY |
| [Horses](https://opengameart.org/content/lpc-horses) | 걷기, 질주, 먹기, 털색 5종 | 위와 같음 |
| [Farm Animals](https://opengameart.org/content/lpc-style-farm-animals) | 닭, 소, 돼지, 양: 걷기, 먹기 | CC-BY 3 / GPL2 |

### 전투 (LPC 생성기에 이미 있음)

- 동작: 베기(한손/양손), 찌르기, 쏘기, 주문 시전, 다침, 전투 대기, 물 주기 등. 물 주기 동작과 물뿌리개는 가뭄 사건의 "물 대기"(GDD 31-2) 연출에만 씀. 매일 물 주기 루프는 만들지 않음
- 무기: 단검, 검(아밍소드, 롱소드 등), 창, 미늘창, 곤봉, 메이스, 도리깨, 전투 도끼, 활 3종, 석궁, 지팡이/완드
- 방패: 히터, 연 모양, 둥근 방패 등 6종
- 도구: 도끼, 괭이, 곡괭이, 삽, 물뿌리개, 망치
- 괴물 머리/몸 레이어도 있음: 늑대, 고블린, 트롤, 쥐, **요정 날개(픽시)**는 사용 (생성기의 모든 동작을 그대로 씀). 오크, 멧돼지인간, 해골, 좀비, 흡혈귀 레이어는 **쓰지 않음** (GDD 33-3 허용 목록 밖)
- 받기: 위 1번 [LPC 생성기](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator)

### 괴물과 야생 동물

**SA** = CC-BY-SA/GPL 동일조건 (수정한 그림을 같은 라이선스로 공개해야 함)

| 에셋 | 받기 | 라이선스 | 내용 |
| --- | --- | --- | --- |
| [LPC] Wolf Animation | [OpenGameArt](https://opengameart.org/content/lpc-wolf-animation) | CC-BY / **OGA-BY** / GPL | 걷기, 달리기, 물기, 울부짖기, 죽음. 6색 (큰늑대) |
| LPC Wolfman | [OpenGameArt](https://opengameart.org/content/lpc-wolfman) | **SA** | 늑대인간 몸, LPC 표준 동작 전부 |
| [LPC] Goblin Full Sheet | [OpenGameArt](https://opengameart.org/content/lpc-goblin-full-sheet) | CC-BY / **OGA-BY** / GPL | 걷기, 베기, 다침 |
| [LPC] Spider | [OpenGameArt](https://opengameart.org/content/lpc-spider) | CC-BY / **OGA-BY** / GPL | 서기, 공격, 4방향 걷기, 죽음. 11색 (거대 거미) |
| [LPC] Monsters | [OpenGameArt](https://opengameart.org/content/lpc-monsters) | **SA** | 박쥐(야생 동물), 유령(20-6 유령 참고)만 사용. 슬라임, 벌 등은 **쓰지 않음** |
| [LPC] Bat combined/extended | [OpenGameArt](https://opengameart.org/content/lpc-bat-combinedextended) | **OGA-BY** | 날기, 공격, 죽음, 매달림 |
| [LPC] Rat, Cat and Dog | [OpenGameArt](https://opengameart.org/content/lpc-rat-cat-and-dog) | CC-BY / **SA** / GPL | 쥐 (역병 연출), 4방향 |
| [LPC] bears, deer, lions and more | [OpenGameArt](https://opengameart.org/content/lpc-bears-deer-lions-and-more) | **CC-BY 4.0** (일부 CC0) | 곰(걷기/공격/죽음), 큰쥐, 사슴, 여우 |
| LPC Wild Boar | [OpenGameArt](https://opengameart.org/content/lpc-wild-boar) | **SA** | 멧돼지 걷기, 공격, 죽음 |
| Bunny Rabbit LPC style | [OpenGameArt](https://opengameart.org/content/bunny-rabbit-lpc-style-for-pixelfarm) | CC-BY / **OGA-BY** | 토끼 뛰기, 먹기 |
| [LPC] Fairy | [OpenGameArt](https://opengameart.org/content/lpc-fairy) | **SA** / GPL | 사람 크기 요정 (작은 픽시는 직접 제작) |

### 마법 효과

| 에셋 | 받기 | 가격 | 라이선스 | 내용 |
| --- | --- | --- | --- | --- |
| [LPC] Items and game effects | [OpenGameArt](https://opengameart.org/content/lpc-items-and-game-effects) | 무료 | **SA** / GPL | 32px 주문, 불꽃, 말풍선, 아이템 |
| Pixel Magic Effects (Foozle) | [itch.io](https://foozlecc.itch.io/pixel-magic-sprite-effects) | 무료 (원하는 만큼) | **CC0** | 32px 효과 10종 |
| Free Pixel Effects Pack | [OpenGameArt](https://opengameart.org/content/free-pixel-effects-pack) | 무료 | **CC0** | 효과 20종 (화풍이 조금 부드러움) |
| Extended LPC Magic pack | [OpenGameArt](https://opengameart.org/content/extended-lpc-magic-pack) | 무료 | **SA** / GPL | 큰 주문 효과라 **쓰지 않음** (33-0 효과 범위 규칙 밖). 작은 빛/반짝임 프레임만 참고 |
| Heal Spell | [OpenGameArt](https://opengameart.org/content/heal-spell) | 무료 | CC-BY 3.0 | 치유 반짝임 (3D 렌더라 픽셀화 필요) |
| Smoke Aura | [OpenGameArt](https://opengameart.org/content/smoke-aura) | 무료 | CC0 | 연기 루프 → 색 바꿔 저주 연출 (픽셀화 필요) |

### 농사

| 에셋 | 받기 | 라이선스 | 내용 |
| --- | --- | --- | --- |
| [LPC] Crops | [OpenGameArt](https://opengameart.org/content/lpc-crops) | **SA** / GPL (일부 CC0) | 작물마다 성장 5단계: 당근, 순무, 비트, 파스닙, 양파 4종, 리크, 마늘, 양배추 2종, 포도 2종, 홉, 완두, 콩, 상추, 케일. **밀, 보리, 허브 없음** |
| [LPC] Fruit Trees | [OpenGameArt](https://opengameart.org/content/lpc-fruit-trees) | **SA** | 사과 5종, 배 3종, 체리, 자두. 성장 4단계 + 열매 3단계 |
| [LPC] Farming tilesets, magic animations and UI | [OpenGameArt](https://opengameart.org/content/lpc-farming-tilesets-magic-animations-and-ui-elements) | **SA** / GPL | **밀밭** 타일, 울타리, 자루, 장터 노점 |
| [LPC] Food | [OpenGameArt](https://opengameart.org/content/lpc-food) | **SA** (일부 CC0) | 곡물, 채소, 씨앗 자루, 상자/바구니 담긴 버전 (저장고 재고 표시) |
| [LPC] Farm | [OpenGameArt](https://opengameart.org/content/lpc-farm) | **CC-BY 4.0** (SA 아님) | 헛간, 곡물 창고, 닭장, 벌통, 마구간, 풍차, 버터 교반기, 치즈 압착기 |
| [LPC] Signposts, Graves, Line Cloths and Scarecrow | [OpenGameArt](https://opengameart.org/content/lpc-signposts-graves-line-cloths-and-scare-crow) | **SA** | 허수아비, 빨랫줄, 이정표, 무덤 |
| LPC Revised 농사 물건 | 위 2번 [GitHub](https://github.com/ElizaWy/LPC) | CC-BY / OGA-BY | 갈아엎은 흙, 건초/짚, 여물통, 양동이, 바구니 |

### 중세 건물 내부

| 에셋 | 받기 | 라이선스 | 내용 |
| --- | --- | --- | --- |
| LPC Revised Objects 폴더 | 위 2번 [GitHub](https://github.com/ElizaWy/LPC) | CC-BY / OGA-BY | **왕좌**, 침대 3종, 러그, 커튼, 가마솥, 벽난로, 궤짝 |
| [LPC] Tavern | [OpenGameArt](https://opengameart.org/content/lpc-tavern) | **SA** | 여관 탁자, 의자, 화덕, 양조 통, 깃발, 문장, 러그, 잔. **류트/피리/북 연주 동작**(생성기 캐릭터용) |
| [LPC] City inside | [OpenGameArt](https://opengameart.org/content/lpc-city-inside) | **SA** / GPL | 왕좌, 카펫, 화로, 찬장, 문 |
| LPC Interior Castle Tiles | [OpenGameArt](https://opengameart.org/content/lpc-interior-castle-tiles) | CC-BY / OGA-BY / SA / GPL 중 선택 | 성 내부 타일, 계단 (세부 구성 미확인) |
| [LPC] Castle Mega-Pack | [OpenGameArt](https://opengameart.org/content/lpc-castle-mega-pack) | **SA** | 고딕 아치, 장미창, 버트레스 (교회/성 외관) |
| [LPC] Upholstery | [OpenGameArt](https://opengameart.org/content/lpc-upholstery) | **SA** / CC-BY / OGA-BY | 의자, 소파류 천 씌운 가구 |
| [LPC] Simple Modern Furniture | [OpenGameArt](https://opengameart.org/content/lpc-simple-modern-furniture) | **SA** / GPL | 욕조 (현대식이라 중세풍으로 수정 필요) |
### LPC에 없는 것과 제작 방법

**만드는 방법**: 아래 방법 외에 **생성형 AI 초안 → LPC 규격으로 줄이기 → 팔레트 양자화 → 손질** 방식도 가능 (GDD 28-5). 프레임이 많은 동작은 한 프레임만 AI로 잡고 나머지는 스크립트로

**"언제"** 열: 개발 중 필요할 때 만듦. Epic RPG World에 이미 있는 것은 만들지 않음

| 없는 것 | 방법 | 난이도 | 언제 |
| --- | --- | --- | --- |
| 아기 | 강보에 싸인 작은 스프라이트 (요람 안, 품 안, 바닥). 숨쉬기, 울기, 버둥 | 낮음 | 지금 |
| 유아 | 아동 베이스를 줄여 새로 찍음 (머리 비율 크게). 기기, 걷기, 앉기, 대기, 넘어지기 | 높음 | 지금 |
| 잠/눕기 | 심즈식: 침대 위 **이불 + 베개 위 머리**만 표시. 바닥 쓰러짐은 전용 프레임 1~2개 | 중간 | 지금 |
| 먹기 | 앉기 + 팔 레이어 2~3프레임 + 탁자 위 음식 | 중간 | 지금 |
| 들고 옮기기 | 걷기 + 팔 앞으로 레이어 + 들린 물건 (아기, 바구니, 장작) | 중간 | 지금 |
| 작업 (반죽, 망치질, 실잣기) | 베기/찌르기 프레임 재활용 + 도구 레이어 | 중간 | 지금 |
| 노년 자세 | 노인 머리/주름 + 1px 굽은 자세 + 느린 걷기 + 지팡이 | 낮음 | 지금 |
| 임신 배 | 생성기의 임신 체형 (단계별 2종) | 낮음 | 지금 |
| 아동 옷 부족분 | 성인 옷을 아동 몸에 맞춰 새로 찍음 | 중간 | 지금 |
| 욕구 아이콘 8개, 감정 아이콘 11개 | 16/32px | 낮음 | 지금 (UI라 교체 무관) |
| 유령 | 인물 스프라이트 + 반투명 + 푸른 색조 셰이더 | 낮음 | 지금 |
| 연대기 삽화 처리 | 캡처 → 필사본 팔레트 + 테두리 + 금박 머리글자 | 중간 | 지금 |
| 집요정 | 아동 몸 + 고블린 머리 + 누더기 옷 | 중간 | 지금 |
| 픽시 | 작은 스프라이트 + 요정 날개 축소 재작화 | 중간 | 지금 |
| 트롤 (33-3 다리 밑 트롤) | 트롤 머리 + 근육 체형을 크게 새로 찍음 | 높음 | 필요할 때 (M13) |
| 4방향 유령 | 인물 스프라이트 + 반투명 셰이더로 대체 (위 "유령" 행) | - | - |
| 코볼트, 레이스 | 쓰지 않음 (33-3 허용 목록 밖) | - | 쓰지 않음 |
| 영구 부상과 보조구 | 흉터 오버레이, 절름발이 걷기, 안대, 목발/나무 의족, 갈고리 의수 레이어 (GDD 20-4) | 중간 | 필요할 때 (M11) |
| 사슴/여우 공격 동작 | 걷기 프레임 변형 | 낮음 | 지금 |
| 보리, 허브 작물 | 작물 5단계 형식으로 | 낮음 | 필요할 때 |
| 쟁기, 수확 효과 | 쟁기 물건 + 소/말 끌기 | 중간 | 필요할 때 |
| 마법진, 저주 연기, 주문 발광 | CC0 효과 양자화 + 도트 | 낮음 | 지금 (효과는 교체 무관) |
| 교회 내부 (신도석, 제단, 설교대) | Castle Mega-Pack 창 + 가구 변형 | 중간 | 필요할 때 |
| 캐노피 침대, 요람, 요강, 목욕통, 태피스트리 | 침대/궤짝 변형 | 중간 | 필요할 때 |

### LPC 라이선스 주의

- **동일조건변경허락(CC-BY-SA)**: CC-BY-SA 레이어를 수정해서 만든 그림은 **그 그림도 CC-BY-SA로 공개**해야 함. 게임 코드에는 영향 없음
- **CC-BY-SA 3.0의 DRM 조항**: 기술적 보호 조치를 건 배포와 충돌할 수 있음. 스팀은 DRM 없이 출시 가능(Steamworks DRM 래퍼 미사용). 콘솔/iOS 이식 때 다시 검토
- 가능하면 CC0/CC-BY/OGA-BY 레이어를 우선 고르고, 생성기의 CREDITS 파일은 게임과 함께 배포

---

## 4. 화면 배율

- LPC와 Epic RPG World 모두 32px, 화면 2배 (`04_에셋_목록.md` 1절). Mana Seed 교체 계획은 보류 (`04M_ManaSeed_보류.md`)

## 5. 크레딧

- LPC 전 레이어: 생성기 CREDITS.csv 작가 전원 + 라이선스. 수정한 CC-BY-SA 그림은 CC-BY-SA로 공개
- LPC Revised, OGA 팩: 작가명 + 라이선스 + 링크
- 나머지는 `04_에셋_목록.md` 6절

## 6. 확인 못 한 것

- LPC 다침 동작을 잠 자세로 쓸 수 있는지, 아동용 옷 개수, 생성기에 라이선스 필터가 있는지
- LPC Revised 대장일 소품(모루, 화로)의 세부 구성, Sharm 성 내부 타일의 세부 구성
- 늑대/거미/멧돼지 프레임 크기, [LPC] Monsters 유령의 방향 수
