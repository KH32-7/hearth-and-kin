"""
직접 찍는 UI 판 (구매 팩에 없는 모양). 색은 Cute Fantasy UI 양피지 팔레트에 맞춤.
  python tools/ui/draw-panels.py
결과: assets/original/ui/*.png (프로젝트 저작물, 커밋 가능, CREDITS.json 'ui:original-icons')

- panel_scene      장면 대사창 판 (9-slice 9px). 원본 틀 명암 순서를 얇게: 갈색 외곽선 → 밝은 테두리 → 바탕 → 아래 두께 1px, 안쪽 장식선
- card_choice(_on) 장면 선택지 카드 (9-slice 4px). 선택은 외곽선·테두리·아래 띠가 초록
- card_stitch      바느질 초상 칸 원본 무늬 한 땀(5px) — 크기별 카드는 src/ui/skin.ts 가 캔버스로 같은 규칙으로 찍음 (늘리면 무늬가 깨져서)
GDD 27-13.
"""
from __future__ import annotations

import os

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'original', 'ui')

T = (0, 0, 0, 0)
OUTLINE = (138, 72, 54, 255)
FILL = (246, 202, 159, 255)
RIM = (255, 236, 206, 255)
BAND = (230, 156, 105, 255)
G_OUT = (62, 137, 72, 255)
G_RIM = (165, 230, 120, 255)
G_BAND = (99, 170, 77, 255)


def draw(w: int, h: int, r: int, outline, rim, band_col, inner_line: bool) -> Image.Image:
    im = Image.new('RGBA', (w, h), T)
    p = im.load()

    def k(y: int) -> int:
        if y < r:
            return r - y
        if y >= h - r:
            return r - (h - 1 - y)
        return 0

    for y in range(h):
        for x in range(k(y), w - k(y)):
            p[x, y] = FILL
    # 아래 두께 1px
    y = h - 2
    for x in range(k(y), w - k(y)):
        p[x, y] = band_col
    # 밝은 테두리: 위와 옆 (아래에는 넣지 않음 — 넣으면 줄무늬처럼 보임)
    for y in range(1, h - 2):
        a, b = k(y), w - 1 - k(y)
        p[a + 1, y] = rim
        p[b - 1, y] = rim
    for x in range(r, w - r):
        p[x, 1] = rim
    # 외곽선
    for y in range(h):
        for x in range(w):
            if p[x, y][3] == 0:
                continue
            edge = any(not (0 <= x + dx < w and 0 <= y + dy < h) or p[x + dx, y + dy][3] == 0
                       for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if edge:
                p[x, y] = outline
    if inner_line:
        ins = 4
        for x in range(ins + 2, w - ins - 2):
            p[x, ins] = BAND
            p[x, h - 2 - ins] = BAND
        for y in range(ins + 2, h - 2 - ins):
            p[ins, y] = BAND
            p[w - 1 - ins, y] = BAND
    return im


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    draw(32, 32, 4, OUTLINE, RIM, BAND, True).save(os.path.join(OUT, 'panel_scene.png'))
    draw(24, 24, 3, OUTLINE, RIM, BAND, False).save(os.path.join(OUT, 'card_choice.png'))
    draw(24, 24, 3, G_OUT, G_RIM, G_BAND, False).save(os.path.join(OUT, 'card_choice_on.png'))
    print('assets/original/ui: panel_scene, card_choice, card_choice_on')


if __name__ == '__main__':
    main()
