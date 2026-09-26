"""
HUD 아이콘 + UI 프레임 조각 아틀라스 생성기.

구매 에셋(assets/vendor/, .gitignore)에서 고른 칸을 픽셀 그대로 복사해
  assets/generated/ui/ui-atlas.png   (아틀라스, 항목 사이 2px 투명 여백)
  src/data/ui/atlas.json             (키 -> 좌표표, src/ui/skin.ts 가 읽음)
  assets/generated/ui/preview.png    (확인용: 아이콘 4배 + 이름, UI 조각 + 9-slice 늘림 예시)
를 만든다. 확대/필터/다시 그리기 없음. 원본 파일은 읽기만 함.

아이콘을 바꾸려면 아래 ICONS 표의 원본 칸만 고치고 다시 실행:
  python tools/build-ui-atlas.py
선별 이유는 assets/curation.md "UI 아이콘" 절.
"""
from __future__ import annotations

import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT_PNG = 'assets/generated/ui/ui-atlas.png'
OUT_JSON = 'src/data/ui/atlas.json'
OUT_PREVIEW = 'assets/generated/ui/preview.png'

GAP = 2  # 항목 사이 투명 여백(px). 요구는 1px 이상

# ---------------------------------------------------------------- 원본 (레포 루트 기준 상대경로)
RAVEN = 'assets/vendor/raven-fantasy-icons/premium/Premium - Raven Fantasy Icons/Full Spritesheet/16x16.png'
RAVEN_TREES = 'assets/vendor/raven-fantasy-icons/premium/Premium - Raven Fantasy Icons/New updates/Trees and Logs/Original/16/{n}.png'
RAVEN_SYM = 'assets/vendor/raven-fantasy-icons/extras/Symbols and Runes/Original/16/{n}.png'
GUI = 'assets/vendor/raven-gui-starter/Raven Fantasy - PixelArt Menu, GUI, HUD and UI Kit - Starter Set/Content/Raven Fantasy GUI Starter Set.png'
KENMI_SEL = 'assets/vendor/kenmi-cute-fantasy-ui/Cute_Fantasy_UI/UI/UI_Selectors.png'
KENMI_POP = 'assets/vendor/kenmi-cute-fantasy-ui/Cute_Fantasy_UI/UI/UI_Pop_Up.png'
KENMI_FRAMES = 'assets/vendor/kenmi-cute-fantasy-ui/Cute_Fantasy_UI/UI/UI_Frames.png'


def raven(n: int):
    """Raven Fantasy Icons 전체 시트의 a번호(1부터, 한 줄 16개) -> (파일, 사각형). Separated Files/16x16/a{n}.png 와 같은 픽셀"""
    i = n - 1
    return (RAVEN, ((i % 16) * 16, (i // 16) * 16, 16, 16))


def trees(name: str):
    return (RAVEN_TREES.format(n=name), (0, 0, 16, 16))


def orig(name: str):
    """직접 그린 아이콘 (tools/icons/draw-originals.py → assets/original/ui/)"""
    return (f'assets/original/ui/{name}.png', (0, 0, 16, 16))


def sym(n: int):
    return (RAVEN_SYM.format(n=n), (0, 0, 16, 16))


# ---------------------------------------------------------------- 아이콘 (16x16, 전부 Raven Fantasy 계열)
# 키 -> (원본, 뜻(미리보기 라벨), 원본 표시용 이름)
ICONS: dict[str, tuple[tuple[str, tuple[int, int, int, int]], str, str]] = {
    # 욕구 8
    'need.hunger': (raven(2262), '허기 (닭다리)', 'a2262'),
    'need.energy': (sym(385), '기력 (초승달)', 'sym385'),
    'need.hygiene': (raven(2510), '청결 (물방울)', 'a2510'),
    'need.bladder': (raven(2175), '용변 (요강 단지)', 'a2175'),
    'need.fun': (raven(3331), '재미 (음표)', 'a3331'),
    'need.social': (raven(3334), '교류 (말풍선)', 'a3334'),
    'need.warmth': (raven(3489), '온기 (불꽃)', 'a3489'),
    'need.comfort': (raven(313), '안락 (깃털)', 'a313'),
    # 행동 (interactions.json 의 icon 키) + goto
    'fire': (raven(3494), '불 지피기 (모닥불)', 'a3494'),
    'stew': (raven(2323), '스튜 (스튜 그릇)', 'a2323'),
    'warmth': (raven(3489), '불 쬐기 (불꽃)', 'a3489'),
    'water': (raven(300), '물 (물 담긴 나무 양동이)', 'a300'),
    'bread': (raven(2209), '빵 (빵 덩이)', 'a2209'),
    'hygiene': (raven(2510), '세수 (물방울)', 'a2510'),
    'bath': (raven(2509), '목욕 (비누 거품)', 'a2509'),
    'bladder': (raven(2175), '요강 쓰기 (단지)', 'a2175'),
    'outhouse': (raven(16), '뒷간 (나무 헛간)', 'a16'),
    'sleep': (raven(3615), '잠 (Zz)', 'a3615'),
    'comfort': (raven(313), '앉기/쉬기 (깃털)', 'a313'),
    'clothes': (raven(6465), '옷 갈아입기 (튜닉)', 'a6465'),
    'book': (raven(1681), '책 (붉은 책)', 'a1681'),
    'lute': (raven(3331), '류트 연주 (음표)', 'a3331'),
    'eye': (raven(2708), '구경 (눈)', 'a2708'),
    'plant': (raven(1269), '식물 돌보기 (꽃 가지)', 'a1269'),
    'yarn': (raven(310), '실잣기 (털실 뭉치)', 'a310'),
    'axe': (raven(4473), '장작 패기 (도끼)', 'a4473'),
    'candle': (raven(227), '초 (촛대)', 'a227'),
    'social': (raven(3334), '대화 (말풍선)', 'a3334'),
    'logs': (trees('tp14'), '장작 정리 (통나무)', 'Trees tp14'),
    'goto': (raven(105), '이동 (깃발)', 'a105'),
    # 살림 6
    'item.firewood': (trees('tp14'), '장작 (통나무)', 'Trees tp14'),
    'item.water': (raven(300), '물 (양동이)', 'a300'),
    'item.flour': (raven(2106), '밀가루 (밀 이삭)', 'a2089'),
    'item.bread': (raven(2209), '빵', 'a2209'),
    'item.ingredients': (raven(2025), '식재료 (당근)', 'a2025'),
    'item.yarn': (raven(310), '털실', 'a310'),
    'item.ale': (raven(2199), '에일 (거품 난 맥주잔)', 'a2199'),
    'item.herbs': (raven(2083), '약초 (잎 가지)', 'a2083'),
    'item.preserves': (raven(2231), '저장식 (잼 단지)', 'a2231'),
    # 기타
    'ui.temp': (raven(1505), '기온 (붉은 관, 온도계 대용)', 'a1505'),
    'ui.clock': (raven(343), '시간 (모래시계)', 'a343'),
    'ui.cancel': (raven(2560), '취소 (X)', 'a2560'),
    'ui.auto': (raven(18), '자동 (톱니)', 'a18'),
    'ui.coin': (raven(371), '돈 (금화)', 'a371'),
    'ui.crest': (raven(7769), '신분 문장 (흰 방패에 붉은 십자)', 'a7769'),
    # 감정 11 (emotions.json 의 icon 키). 얼굴 이모지는 Raven 상태이상 소형 얼굴 몇 개뿐이라 상징 위주, 색은 emotions.json color 에 맞춤
    'emo.happy': (raven(3575), '행복 (금빛 햇살)', 'a3575'),
    'emo.energized': (raven(3521), '활기 (번개)', 'a3521'),
    'emo.focused': (sym(99), '집중 (푸른 조준 원)', 'sym99'),
    'emo.excited': (raven(2597), '설렘 (분홍 두 하트)', 'a2597'),
    'emo.inspired': (sym(714), '영감 (보라 반짝임)', 'sym714'),
    'emo.pious': (raven(2606), '경건 (빛나는 흰 십자)', 'a2606'),
    'emo.sad': (raven(2936), '슬픔 (눈물방울)', 'a2936'),
    'emo.angry': (raven(2668), '분노 (붉은 화남 표시)', 'a2668'),
    'emo.tense': (raven(2670), '긴장 (식은땀 얼굴)', 'a2670'),
    'emo.ashamed': (raven(2666), '수치 (붉어진 얼굴)', 'a2666'),
    'emo.neutral': (sym(2), '무난 (회색 원)', 'sym2'),
    # 대화 주제 9 (GDD 14-3 주제 말풍선). 음식은 stew, 소문은 eye 를 그대로 씀 (fx.json topics)
    'topic.weather': (orig('topic_weather'), '날씨 (비구름, 직접 그림)', 'original'),
    'topic.love': (raven(3095), '사랑 (붉은 하트 둘)', 'a3095'),
    'topic.work': (raven(334), '일 (망치)', 'a334'),
    'topic.faith': (raven(3099), '신앙 (붉은 십자)', 'a3099'),
    'topic.family': (raven(65), '가족 (작은 집)', 'a65'),
    'topic.war': (raven(395), '전쟁 (쇠칼)', 'a395'),
    'topic.plague': (raven(3184), '역병 (초록 기운 해골)', 'a3184'),
    # 사회 결과 연출
    'fx.social_ok': (raven(3120), '대화 성공 (금 하트)', 'a3120'),
}

# ---------------------------------------------------------------- UI 조각 (좌표만, 픽셀 그대로 복사)
# 키 -> (원본, 사각형, slice[top,right,bottom,left] 또는 None, 설명)
PIECES: dict[str, tuple[str, tuple[int, int, int, int], list[int] | None, str]] = {
    # 9-slice 패널 48x48 (Raven GUI). 모서리 5px 안에 점선 꺾임이 다 들어감
    'panel.brown': (GUI, (16, 0, 48, 48), [5, 5, 5, 5], '갈색 패널 (점선 테두리)'),
    'panel.cream': (GUI, (64, 0, 48, 48), [5, 5, 5, 5], '크림 패널'),
    'panel.dark': (GUI, (112, 0, 48, 48), [4, 4, 4, 4], '어두운 패널 (가운데 반투명 a=192)'),
    # 가로 막대 틀 (빈 바). 채움 막대는 slice 가운데 영역 안에 그림 (bar.frame: 42x2, bar.frame_metal: 40x4)
    'bar.frame': (GUI, (16, 68, 48, 8), [3, 3, 3, 3], '가로 막대 틀 (갈색)'),
    'bar.frame_metal': (GUI, (16, 52, 48, 8), [2, 4, 2, 4], '가로 막대 틀 (쇠 마개)'),
    # 낮밤 시계 원판 30x31 (받침 다리 포함). 반쪽은 원판 안쪽 좌표 (왼쪽 밤/달, 오른쪽 낮/해)
    'clock.dial': (GUI, (81, 97, 30, 31), None, '낮밤 시계 원판'),
    'clock.night': (GUI, (81, 97, 15, 30), None, '원판 왼쪽 반 (밤, 달)'),
    'clock.day': (GUI, (96, 97, 15, 30), None, '원판 오른쪽 반 (낮, 해)'),
    # 작은 사각 버튼: 눌림은 윗면이 2px 내려간 모양. 같은 16x14 칸으로 잘라 바꿔 끼우기만 하면 됨
    'button.square': (GUI, (0, 208, 16, 14), None, '작은 사각 버튼'),
    'button.square_pressed': (GUI, (0, 320, 16, 14), None, '작은 사각 버튼 (눌림)'),
    # 둥근 버튼 (원형 메뉴 항목 배경 겸용)
    'button.round': (GUI, (1, 160, 14, 15), None, '둥근 버튼'),
    'button.round_pressed': (GUI, (1, 272, 14, 15), None, '둥근 버튼 (눌림)'),
    # 슬롯 (원형 메뉴/살림 칸 배경)
    'slot.brown': (GUI, (155, 107, 26, 26), [5, 5, 5, 5], '갈색 사각 슬롯'),
    'slot.cream': (GUI, (203, 107, 26, 26), [5, 5, 5, 5], '크림 사각 슬롯'),
    'slot.dark': (GUI, (252, 108, 24, 24), [4, 4, 4, 4], '어두운 사각 슬롯'),
    'slot.metal': (GUI, (0, 48, 16, 16), None, '쇠빛 둥근 사각 슬롯'),
    'slot.wood': (GUI, (0, 64, 16, 16), None, '나무빛 둥근 사각 슬롯'),
    # 선택 표시 (Kenmi UI_Selectors 첫 줄, 모서리만 있는 2프레임 깜빡임). 두 프레임 같은 크기로 자름
    'ui.select.0': (KENMI_SEL, (107, 10, 26, 28), [10, 10, 10, 10], '선택 표시 프레임 0'),
    'ui.select.1': (KENMI_SEL, (155, 10, 26, 28), [10, 10, 10, 10], '선택 표시 프레임 1'),
    # 말풍선 (Kenmi UI_Pop_Up, 흰 바탕 + 검은 테두리, 아래 꼬리 포함). 꼬리는 왼쪽 고정 칸 안에 들어가게 slice 를 잡음:
    # 늘리면 가운데 띠(꼬리 오른쪽 4px)만 늘어나 꼬리는 모양 그대로 왼쪽에 남음. 원래 크기에선 꼬리가 가운데
    'bubble.speech': (KENMI_POP, (14, 14, 20, 24), [3, 4, 7, 12], '말풍선 (사각, 꼬리 포함)'),
    'bubble.thought': (KENMI_POP, (61, 13, 22, 26), [5, 5, 9, 13], '생각 풍선 대용 (둥근 말풍선, 꼬리 포함)'),
    # 초상화 판 (Kenmi UI_Frames 양피지 카드, 모서리 장식). 9-slice 아님, 속이 채워진 판이라 초상화를 위에 얹어 그림
    'portrait.frame': (KENMI_FRAMES, (1064, 104, 32, 32), None, '초상화 판 (양피지, 모서리 장식)'),
}

# ---------------------------------------------------------------- 유틸


def p(rel: str) -> str:
    return os.path.join(ROOT, rel)


_cache: dict[str, Image.Image] = {}


def load(rel: str) -> Image.Image:
    if rel not in _cache:
        full = p(rel)
        if not os.path.exists(full):
            sys.exit(f'원본 없음: {rel}\n  assets/vendor/ 에 구매 에셋을 풀어 둔 뒤 다시 실행하세요.')
        _cache[rel] = Image.open(full).convert('RGBA')
    return _cache[rel]


def crop(rel: str, r: tuple[int, int, int, int]) -> Image.Image:
    x, y, w, h = r
    im = load(rel)
    if x < 0 or y < 0 or x + w > im.width or y + h > im.height:
        sys.exit(f'사각형이 원본 밖: {rel} {r}')
    return im.crop((x, y, x + w, y + h))


def src_str(rel: str, r: tuple[int, int, int, int]) -> str:
    return f'{rel}#{r[0]},{r[1]},{r[2]},{r[3]}'


def scan_raven_refs() -> None:
    """데이터 파일(items/recipes/careers/crops/skills …)의 "raven:a번호" 아이콘을 모두 아틀라스에 넣음 (콘텐츠 작업자가 번호로 제안)"""
    import glob
    import re
    refs: set[int] = set()
    for f in glob.glob(p('src/data/*.json')):
        with open(f, encoding='utf8') as fh:
            for m in re.finditer(r'"raven:a(\d+)"', fh.read()):
                refs.add(int(m.group(1)))
    for n in sorted(refs):
        key = f'raven:a{n}'
        if key not in ICONS:
            ICONS[key] = (raven(n), f'데이터 참조 a{n}', f'a{n}')


def build() -> None:
    scan_raven_refs()
    # 1) 복사할 고유 블록 모으기 (같은 원본 칸은 한 번만 넣고 키들이 같은 좌표를 가리킴)
    blocks: dict[tuple[str, tuple[int, int, int, int]], Image.Image] = {}
    for key, ((rel, r), _, _) in ICONS.items():
        blocks.setdefault((rel, r), crop(rel, r))
        if r[2:] != (16, 16):
            sys.exit(f'아이콘은 16x16 이어야 함: {key}')

    # 시계 반쪽은 원판 블록 안의 부분 사각형으로 처리
    sub_of: dict[str, tuple[tuple[str, tuple[int, int, int, int]], int, int]] = {}
    piece_blocks: list[tuple[str, tuple[int, int, int, int]]] = []
    for key, (rel, r, _, _) in PIECES.items():
        parent = None
        for other, (orel, orr, _, _) in PIECES.items():
            if other == key or orel != rel:
                continue
            if (orr[0] <= r[0] and orr[1] <= r[1] and r[0] + r[2] <= orr[0] + orr[2] and r[1] + r[3] <= orr[1] + orr[3]
                    and (orr[2] * orr[3]) > (r[2] * r[3])):
                parent = (orel, orr)
        if parent:
            sub_of[key] = (parent, r[0] - parent[1][0], r[1] - parent[1][1])
        elif (rel, r) not in blocks:
            blocks[(rel, r)] = crop(rel, r)
            piece_blocks.append((rel, r))

    # 2) 배치: 아이콘은 16열 격자, UI 조각은 그 아래 선반(shelf) 배치
    icon_blocks = [b for b in blocks if b not in piece_blocks]
    cols = 16
    pitch = 16 + GAP
    width = GAP + cols * pitch
    width = max(width, GAP + max(r[2] for _, r in piece_blocks) + GAP)
    pos: dict[tuple[str, tuple[int, int, int, int]], tuple[int, int]] = {}
    for i, b in enumerate(icon_blocks):
        pos[b] = (GAP + (i % cols) * pitch, GAP + (i // cols) * pitch)
    y = GAP + ((len(icon_blocks) + cols - 1) // cols) * pitch + GAP
    x = GAP
    shelf_h = 0
    for b in sorted(piece_blocks, key=lambda b: (-b[1][3], -b[1][2])):
        w, h = b[1][2], b[1][3]
        if x + w + GAP > width:
            x = GAP
            y += shelf_h + GAP
            shelf_h = 0
        pos[b] = (x, y)
        x += w + GAP
        shelf_h = max(shelf_h, h)
    height = y + shelf_h + GAP

    atlas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    for b, (bx, by) in pos.items():
        atlas.paste(blocks[b], (bx, by))  # 알파 합성 없이 픽셀 그대로

    # 3) 좌표표
    sprites: dict[str, dict] = {}
    for key, ((rel, r), _, _) in ICONS.items():
        bx, by = pos[(rel, r)]
        sprites[key] = {'x': bx, 'y': by, 'w': 16, 'h': 16, 'src': src_str(rel, r)}
    for key, (rel, r, sl, _) in PIECES.items():
        if key in sub_of:
            parent, dx, dy = sub_of[key]
            bx, by = pos[parent]
            bx, by = bx + dx, by + dy
        else:
            bx, by = pos[(rel, r)]
        e = {'x': bx, 'y': by, 'w': r[2], 'h': r[3], 'src': src_str(rel, r)}
        if sl:
            if sl[0] + sl[2] >= r[3] or sl[1] + sl[3] >= r[2]:
                sys.exit(f'slice 가 너무 큼: {key}')
            e['slice'] = sl
        sprites[key] = e

    os.makedirs(os.path.dirname(p(OUT_PNG)), exist_ok=True)
    os.makedirs(os.path.dirname(p(OUT_JSON)), exist_ok=True)
    atlas.save(p(OUT_PNG), optimize=True)
    doc = {'image': OUT_PNG, 'sprites': dict(sorted(sprites.items()))}
    with open(p(OUT_JSON), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write('\n')

    verify(doc, pos, blocks)
    preview(doc)
    print(f'아틀라스 {width}x{height}, 항목 {len(sprites)}개 (고유 블록 {len(blocks)}개)')
    print(f'  {OUT_PNG}\n  {OUT_JSON}\n  {OUT_PREVIEW}')


def verify(doc: dict, pos: dict, blocks: dict) -> None:
    """다시 읽어서: 모든 항목이 원본 픽셀과 한 점도 다르지 않음 + 블록 둘레 1px 이상 투명"""
    atlas = Image.open(p(OUT_PNG)).convert('RGBA')
    for key, s in doc['sprites'].items():
        rel, r = s['src'].split('#')
        r = tuple(int(v) for v in r.split(','))
        got = atlas.crop((s['x'], s['y'], s['x'] + s['w'], s['y'] + s['h'])).tobytes()
        if got != crop(rel, r).tobytes():
            sys.exit(f'검증 실패(픽셀 다름): {key}')
    a = atlas.getchannel('A').load()
    W, H = atlas.size
    for (rel, r), (bx, by) in pos.items():
        w, h = r[2], r[3]
        for xx in range(bx - 1, bx + w + 1):
            for yy in (by - 1, by + h):
                if 0 <= xx < W and 0 <= yy < H and a[xx, yy] != 0:
                    sys.exit(f'검증 실패(여백 없음): {rel} {r}')
        for yy in range(by - 1, by + h + 1):
            for xx in (bx - 1, bx + w):
                if 0 <= xx < W and 0 <= yy < H and a[xx, yy] != 0:
                    sys.exit(f'검증 실패(여백 없음): {rel} {r}')
        if bx < 1 or by < 1 or bx + w > W - 1 or by + h > H - 1:
            sys.exit(f'검증 실패(가장자리 여백 없음): {rel} {r}')


def _font(size: int):
    for f in ('C:/Windows/Fonts/malgun.ttf', '/System/Library/Fonts/AppleSDGothicNeo.ttc',
              '/usr/share/fonts/truetype/nanum/NanumGothic.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def _nine(img: Image.Image, sl: list[int], w: int, h: int) -> Image.Image:
    """확인용 9-slice 늘림 (가장자리/가운데를 최근접으로 늘림, 미리보기 전용)"""
    t, r, b, l = sl
    W, H = img.size
    out = Image.new('RGBA', (w, h))
    xs = [(0, l, 0, l), (l, W - r, l, w - r), (W - r, W, w - r, w)]
    ys = [(0, t, 0, t), (t, H - b, t, h - b), (H - b, H, h - b, h)]
    for sx0, sx1, dx0, dx1 in xs:
        for sy0, sy1, dy0, dy1 in ys:
            part = img.crop((sx0, sy0, sx1, sy1)).resize((dx1 - dx0, dy1 - dy0), Image.NEAREST)
            out.paste(part, (dx0, dy0))
    return out


def preview(doc: dict) -> None:
    atlas = Image.open(p(OUT_PNG)).convert('RGBA')
    font = _font(13)
    small = _font(11)
    S = 4  # 아이콘 확대 배율 (미리보기 전용)
    cell_w, cell_h = 250, 16 * S + 12
    icon_keys = list(ICONS.keys())
    cols = 4
    rows = (len(icon_keys) + cols - 1) // cols
    piece_keys = list(PIECES.keys())
    top = 30
    icons_h = rows * cell_h
    pieces_y = top + icons_h + 30
    piece_h = 0
    # UI 조각 줄 높이 계산 (2배 + 9-slice 늘림 예시)
    layout = []
    x, y, row_h = 10, pieces_y, 0
    W = cols * cell_w + 20
    for k in piece_keys:
        s = doc['sprites'][k]
        w = s['w'] * 2
        h = s['h'] * 2
        demo = None
        if 'slice' in s:
            dw, dh = (max(96, s['w'] * 2), max(40, s['h'])) if s['h'] > 12 else (160, s['h'])
            demo = (dw, dh)
            w += 10 + dw * 2
            h = max(h, dh * 2)
        bw = max(w, 150) + 20
        bh = h + 22
        if x + bw > W:
            x = 10
            y += row_h
            row_h = 0
        layout.append((k, x, y, demo))
        x += bw
        row_h = max(row_h, bh)
    total_h = y + row_h + 10

    img = Image.new('RGBA', (W, total_h), (92, 84, 96, 255))
    d = ImageDraw.Draw(img)
    d.text((10, 6), 'UI 아이콘 (원본 16px, 4배 최근접 확대 / 오른쪽 작은 것은 1배)', font=font, fill=(255, 240, 200, 255))
    for i, k in enumerate(icon_keys):
        s = doc['sprites'][k]
        cx = 10 + (i % cols) * cell_w
        cy = top + (i // cols) * cell_h
        ic = atlas.crop((s['x'], s['y'], s['x'] + 16, s['y'] + 16))
        d.rectangle([cx, cy, cx + 16 * S + 3, cy + 16 * S + 3], fill=(150, 142, 150, 255))
        img.alpha_composite(ic.resize((16 * S, 16 * S), Image.NEAREST), (cx + 2, cy + 2))
        img.alpha_composite(ic, (cx + 16 * S + 8, cy + 2))
        img.alpha_composite(ic.resize((32, 32), Image.NEAREST), (cx + 16 * S + 8, cy + 22))
        d.text((cx + 16 * S + 46, cy + 4), k, font=font, fill=(255, 255, 255, 255))
        d.text((cx + 16 * S + 46, cy + 22), ICONS[k][1], font=small, fill=(255, 225, 160, 255))
        d.text((cx + 16 * S + 46, cy + 38), ICONS[k][2], font=small, fill=(190, 190, 200, 255))
    d.text((10, pieces_y - 24), 'UI 조각 (2배) / slice 있는 것은 오른쪽에 9-slice 늘림 예시(2배)', font=font,
           fill=(255, 240, 200, 255))
    for k, x, y, demo in layout:
        s = doc['sprites'][k]
        piece = atlas.crop((s['x'], s['y'], s['x'] + s['w'], s['y'] + s['h']))
        d.text((x, y), f"{k}  {s['w']}x{s['h']}" + (f"  slice {s['slice']}" if 'slice' in s else ''), font=small,
               fill=(255, 255, 255, 255))
        img.alpha_composite(piece.resize((s['w'] * 2, s['h'] * 2), Image.NEAREST), (x, y + 16))
        if demo:
            n = _nine(piece, s['slice'], *demo)
            img.alpha_composite(n.resize((demo[0] * 2, demo[1] * 2), Image.NEAREST), (x + s['w'] * 2 + 10, y + 16))
    img.save(p(OUT_PREVIEW), optimize=True)


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')  # 윈도 콘솔 한글
    except Exception:
        pass
    build()
