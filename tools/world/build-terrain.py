"""지형 자동 타일 데이터 (비주얼 개편, docs/07): Epic RPG World 의 Tiled wangset(모서리 방식)을 그대로 읽어
게임용 src/data/artpacks/terrain.json 과 가공 이미지 assets/generated/world/terrain_*.png 를 만듦.
  python tools/world/build-terrain.py
- 재질 레이어마다 (tsx, wangset, 색) 하나. 모서리 코드 = TL TR BR BL 네 자리 (1 = 그 재질, 0 = 아님)
- 물가: 물 픽셀을 투명으로 뽑아 강둑만 남김 (물은 셰이더로 흐름)
- 절벽(3칸): wall-1-3tiles 세트 + Tiled 자동 규칙(wall-1-rule1)과 같은 아래 두 줄 덧붙임표
원본은 assets/vendor (git 에 없음). 가공 이미지도 assets/generated/world (git 에 없음)
"""
import json, os, sys
import xml.etree.ElementTree as ET
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.chdir(ROOT)
V = 'assets/vendor/epic-rpg-world/RafaelMatos'
GL2 = V + '/ERW-Grassland 2.0/TiledMap Editor/Tilesets'
AR = V + '/ERW-Ancient Ruins/TiledMap Editor/Tilesets'
HL = V + '/ERW - Highlands/TiledMap Editor/Tilesets'
VT = V + '/ERW - The Village/TiledMap Editor/tilesets'
OUT_IMG = 'assets/generated/world'
OUT_JSON = 'src/data/artpacks/terrain.json'
T = 32


def resolve(base, rel):
    p = os.path.normpath(os.path.join(base, rel))
    if os.path.exists(p):
        return p
    # 폴더 이름의 띄어쓰기/대소문자가 tsx 와 다른 경우 (예: "Platform - grass to water" ↔ "Platform-grass to water")
    cur = ''
    for seg in p.replace('\\', '/').split('/'):
        if seg in ('', '.'):
            cur = cur or ''
            continue
        if seg == '..':
            cur = os.path.dirname(cur)
            continue
        base_dir = cur or '.'
        cands = os.listdir(base_dir) if os.path.isdir(base_dir) else []
        key = seg.replace(' ', '').lower()
        m = [c for c in cands if c.replace(' ', '').lower() == key]
        cur = os.path.join(cur, m[0] if m else seg) if cur else (m[0] if m else seg)
    return cur


def read_set(tsx, setname, src_override=None):
    r = ET.parse(tsx).getroot()
    img = r.find('image')
    src = src_override or resolve(os.path.dirname(tsx), img.get('source'))
    cols = int(r.get('columns'))
    prob = {int(t.get('id')): float(t.get('probability')) for t in r.findall('tile') if t.get('probability') is not None}
    ws = [w for w in r.iter('wangset') if w.get('name') == setname]
    if not ws:
        raise SystemExit(f'wangset 없음: {tsx} / {setname}')
    tiles = []
    for t in ws[0].iter('wangtile'):
        w = t.get('wangid').split(',')
        tid = int(t.get('tileid'))
        # TL TR BR BL (Tiled 순서: 0 위, 1 오른위, 2 오른, 3 오른아래, 4 아래, 5 왼아래, 6 왼, 7 왼위)
        tiles.append((tid, [w[7], w[1], w[3], w[5]], prob.get(tid, 1.0)))
    return src, cols, tiles


class Atlas:
    """쓰는 타일만 모아 한 장으로 (32px 칸, 행 64칸)"""

    def __init__(self, name):
        self.name = name
        self.cells = []
        self.index = {}

    def add(self, im):
        key = im.tobytes()
        if key in self.index:
            return self.index[key]
        i = len(self.cells)
        self.cells.append(im)
        self.index[key] = i
        return i

    def save(self, special=None):
        cols = 64
        rows = (len(self.cells) + cols - 1) // cols
        out = Image.new('RGBA', (cols * T, max(1, rows) * T), (0, 0, 0, 0))
        for i, im in enumerate(self.cells):
            out.paste(im, ((i % cols) * T, (i // cols) * T))
        # 06 팔레트로 다시 칠함 (형광 초록/주황 흙 → 올리브·겨자 풀, 황토 흙)
        sys.path.insert(0, os.path.dirname(__file__))
        from palette import recolor, remap_cells, desat_cells, PATH
        orig = out.copy()
        out = recolor(out)
        # 재질별 따로: 광장 판석은 흰 돌, 흙길은 누런끼 뺀 회갈
        for cells, ramp in (special or []):
            if ramp == 'DESAT':
                desat_cells(out, cells)
            else:
                remap_cells(out, orig, cells, PATH)
        os.makedirs(OUT_IMG, exist_ok=True)
        path = f'{OUT_IMG}/{self.name}.png'
        out.save(path)
        return path


atlas = Atlas('terrain_0')
sheets = {}


def crop(src, cols, tid, h=1):
    if src not in sheets:
        sheets[src] = Image.open(src).convert('RGBA')
    s = sheets[src]
    x, y = (tid % cols) * T, (tid // cols) * T
    return s.crop((x, y, x + T, y + T * h))


def is_water(px):
    r, g, b, a = px
    # 물 = 푸른 기가 강한 밝은 청록 (강둑의 흙/풀/돌은 제외)
    return a > 0 and b > 120 and b > r + 40 and g > r + 10


def key_water(im):
    im = im.copy()
    p = im.load()
    for y in range(im.height):
        for x in range(im.width):
            if is_water(p[x, y]):
                p[x, y] = (0, 0, 0, 0)
    return im


def water_mask(im):
    m = Image.new('RGBA', im.size, (0, 0, 0, 0))
    src = im.load()
    dst = m.load()
    for y in range(im.height):
        for x in range(im.width):
            if is_water(src[x, y]):
                dst[x, y] = (255, 255, 255, 255)
    return m


def material(tsx, setname, color, keep_water=True, only_color=True):
    src, cols, tiles = read_set(tsx, setname)
    table = {}
    for tid, corners, pr in tiles:
        if only_color and any(c not in ('0', color) for c in corners):
            continue
        code = ''.join('1' if c == color else '0' for c in corners)
        orig = crop(src, cols, tid)
        im = orig if keep_water else key_water(orig)
        if im.getbbox() is None and code != '1111':
            continue
        entry = [atlas.add(im), pr]
        if not keep_water:
            # 물가: 이 타일의 물 모양 (바닥을 도려낼 마스크)
            entry.append(atlas.add(water_mask(orig)))
        table.setdefault(code, []).append(entry)
    return table


def ramp():
    """3칸 절벽 남향 비탈 (platform3t ramps.png 오른쪽 조각: 열 9 왼쪽 바위, 10~11 가운데, 12 오른쪽 바위, 행 1~3)"""
    src = V + '/ERW-Grassland 2.0/Tilesets/platform3t ramps.png'
    cols = 14
    def col(c):
        return [[atlas.add(crop(src, cols, r * cols + c))] for r in (1, 2, 3)]
    mid_a, mid_b = col(10), col(11)
    return {'left': col(9), 'mid': [a + b for a, b in zip(mid_a, mid_b)], 'right': col(12)}


def fill_tiles(path, n=None, tol=6):
    """꽉 찬 바닥 타일 (base grass.png 처럼 한 장에 여러 변형). 평균색이 가운데값에서 tol 안인 것만
    (톤이 다른 변형을 섞으면 32px 네모 얼룩이 됨). 명암 변화는 어두운 풀 레이어(큰 얼룩)로 줌"""
    from PIL import ImageStat
    s = Image.open(path).convert('RGBA')
    cand = []
    for y in range(0, s.height, T):
        for x in range(0, s.width, T):
            im = s.crop((x, y, x + T, y + T))
            if im.getchannel('A').getextrema()[0] == 255:
                cand.append((im, ImageStat.Stat(im.convert('RGB')).mean))
    med = sorted(c[1][1] for c in cand)[len(cand) // 2]
    medr = sorted(c[1][0] for c in cand)[len(cand) // 2]
    out = [[atlas.add(im), 1.0] for im, m in cand if abs(m[1] - med) <= tol / 2 and abs(m[0] - medr) <= tol]
    return out[:n] if n else out


def desnow(src):
    """Highlands 요새 벽의 눈(흰/하늘색) → 사암 (06 팔레트 돌: #8e876c #a79c80 #bab7a3 #d8c989)"""
    import colorsys
    out = f'{OUT_IMG}/fortress_desnow.png'
    im = Image.open(src).convert('RGBA')
    px = im.load()
    ramp = [(0x7e, 0x75, 0x60), (0x95, 0x8b, 0x72), (0xa7, 0x9c, 0x80), (0xb8, 0xae, 0x94)]
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if (b >= r and v > 0.55) or (s < 0.12 and v > 0.75):
                px[x, y] = (*ramp[min(3, int((v - 0.55) / 0.45 * 4))], a)
    os.makedirs(OUT_IMG, exist_ok=True)
    im.save(out)
    return out


def cliff(tsx=None, setname='wall-1-3tiles-transp', src_override=None):
    """3칸 절벽: 모서리 세트 + 자동 규칙 (윗단 남쪽 가장자리 아래로 두 줄). 팩마다 같은 배치"""
    tsx = tsx or GL2 + '/gl2-Tileset - wall 1-3tiles-transp.tsx'
    src, cols, tiles = read_set(tsx, setname, src_override)
    table = {}
    for tid, corners, pr in tiles:
        code = ''.join('1' if c == '1' else '0' for c in corners)
        im = crop(src, cols, tid)
        if im.getbbox() is None and code != '1111':
            continue
        # 규칙(wall-1-rule1): 앞면 윗줄(144~156, 197~204, 226~228 등) 아래로 +16, +32 번 타일이 이어짐
        below = []
        # 앞면 윗줄(윗단이 위쪽 모서리에만 있는 칸)만 아래로 두 줄 이어짐 (그림 배치: 144→160→176, 197→213→229)
        if code in ('1100', '1000', '0100'):
            for k in (16, 32):
                b = crop(src, cols, tid + k)
                below.append(atlas.add(b) if b.getbbox() is not None else -1)
        table.setdefault(code, []).append([atlas.add(im), pr, below])
    return table


def main():
    tsx_t = GL2 + '/Tileset-Terrain-new grass - transparency.tsx'
    tsx_o = GL2 + '/Tileset-Terrain-new grass.tsx'
    mats = {
        # id: (설명, 표)
        'grass_dark': material(tsx_o, 'grass2 - extra shade to main grass', '1'),
        'dirt': material(tsx_t, 'dirt', '2'),
        'dirt2': material(tsx_t, 'dirt', '4'),
        'gravel': material(tsx_t, 'gravel', '3'),
        'stone': material(tsx_t, 'stone', '1'),
        'stone2': material(tsx_t, 'stone', '2'),
        'sand': material(tsx_t, 'sand', '1'),
        'soil': material(GL2 + '/fertilized soil.tsx', 'fertilized soil -standard', '1'),
        'tallgrass': material(tsx_o, 'tall grass - cartoonish style', '1'),
        # 물가: 1 = 뭍. 물 픽셀은 투명 (셰이더 물 위에 강둑만)
        'bank': material(GL2 + '/platform - grass(transparency) to water.tsx', 'grass to water (river)', '1', keep_water=False),
        # Ancient Ruins: 풀 명암 (큰 얼룩), 모래색 판석 광장
        'grass_light': material(AR + '/Terrain - Ancient Ruins.tsx', 'light grass to transparency', '1'),
        'grass_mid': material(AR + '/Terrain - Ancient Ruins.tsx', 'mid tone grass to transparency', '1'),
        'grass_deep': material(AR + '/Terrain - Ancient Ruins.tsx', 'dark grass to transparency', '1'),
        'slab': material(AR + '/Terrain - Ancient Ruins.tsx', 'stone ground to transparency', '1'),
        # The Village: 붉은 자갈 거리, 벽돌 거리, 광장 원형 돌
        'cobble': material(VT + '/tilesets-village.tsx', 'VillageFloors', '3'),
        'brick': material(VT + '/tilesets-village.tsx', 'VillageFloors', '2'),
        'plaza': material(VT + '/tilesets-village.tsx', 'VillageFloors', '5'),
    }
    base = fill_tiles(V + '/ERW-Grassland 2.0/Tilesets/base grass.png')
    data = {
        '$comment': 'tools/world/build-terrain.py 가 만듦. 모서리 코드 = TL TR BR BL (1 = 그 재질). 값 = [[아틀라스 칸, 확률], ...]. 절벽 값 = [[칸, 확률, [아래1, 아래2]]]',
        'tile': T,
        'image': f'{OUT_IMG}/terrain_0.png',
        'cols': 64,
        'base': base,
        'materials': mats,
        'cliff': cliff(),
        # 바위 절벽 (Ancient Ruins wall-1, 사암): 성 바위, 해안 절벽
        'cliffRock': cliff(AR + '/Ancient Ruins-Tileset - wall 1-transp.tsx', 'wall-1-transp'),
        # 성벽 (Highlands 요새 3칸, 눈 → 사암): 마을 성벽, 성
        'cliffFort': cliff(HL + '/Highlands-Tileset - fortress-3tiles tall.tsx', 'fortress', desnow(V + '/ERW - Highlands/tilesets and props/fortress-3 tiles tall.png')),
        'ramp': ramp(),
        # 그리는 순서 (아래 → 위). 게임 바닥 id → 재질
        'order': ['grass_light', 'grass_mid', 'grass_deep', 'grass_dark', 'tallgrass', 'dirt', 'dirt2', 'soil', 'gravel', 'sand', 'slab', 'stone', 'stone2', 'brick', 'cobble', 'plaza'],
        'alias': {
            'grass': None, 'forest_floor': 'grass_dark', 'field_soil': 'soil', 'road_stone': 'stone', 'mud': 'dirt2',
            'bridge': 'slab',
        },
    }
    cells_of = lambda names: sorted({t[0] for n in names for v in mats[n].values() for t in v})
    path = atlas.save([(cells_of(['slab']), 'DESAT'), (cells_of(['dirt', 'dirt2']), 'PATH')])
    with open(OUT_JSON, 'w', encoding='utf8') as f:
        json.dump(data, f, ensure_ascii=False)
    print(path, len(atlas.cells), '칸;', {k: len(v) for k, v in mats.items()}, '절벽', len(data['cliff']))


if __name__ == '__main__':
    main()
