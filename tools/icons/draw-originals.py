"""
직접 그린 16x16 픽셀 아이콘 (구매 팩에 없는 그림). 사람 손으로 찍은 점 배열 → PNG.
  python tools/icons/draw-originals.py
결과: assets/original/ui/*.png (프로젝트 저작물, 커밋 가능). CREDITS.json 에 original 로 기록.
색은 Raven Fantasy 아이콘과 맞춤: 외곽선 (27,42,52), 흰 면, 하늘색 음영 (101,212,255), 파랑 (62,101,184)
"""
from __future__ import annotations

import os

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'original', 'ui')

PAL = {
    '.': (0, 0, 0, 0),
    'o': (27, 42, 52, 255),     # 외곽선
    'w': (255, 255, 255, 255),  # 흰 면
    'l': (206, 226, 240, 255),  # 밝은 음영
    's': (140, 170, 200, 255),  # 구름 그늘
    'b': (101, 212, 255, 255),  # 빗방울 하이라이트
    'B': (62, 101, 184, 255),   # 빗방울
}

ICONS = {
    # 날씨 이야기: 비구름 (구름 + 빗줄기 세 가닥)
    'topic_weather': [
        '................',
        '................',
        '......oooo......',
        '....ooowwwoo....',
        '...owwwwwwlwo...',
        '..oowwwwwwwlwoo.',
        '.owwwwwwwwwwwlwo',
        'owwwwwwwwwwwwwlo',
        'owlwwwwwwwwwwwso',
        'oslllwwwwwlllsso',
        '.osssssssssssso.',
        '..oooooooooooo..',
        '...b....b....b..',
        '..bB...bB...bB..',
        '..B....B....B...',
        '................',
    ],
}


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for name, rows in ICONS.items():
        assert len(rows) == 16 and all(len(r) == 16 for r in rows), name
        im = Image.new('RGBA', (16, 16))
        for y, r in enumerate(rows):
            for x, ch in enumerate(r):
                im.putpixel((x, y), PAL[ch])
        im.save(os.path.join(OUT, f'{name}.png'))
        print(f'{name}.png')


if __name__ == '__main__':
    main()
