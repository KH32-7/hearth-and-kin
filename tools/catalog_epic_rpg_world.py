"""Epic RPG World 에셋 목록 생성기.

assets/vendor/epic-rpg-world/ 아래 PNG/Tiled 파일을 훑어
docs/06_EpicRPGWorld_에셋목록.md (보기용)와
docs/data/epic_rpg_world_files.csv (검색용 전체 목록)를 만든다.
다시 실행하면 두 파일을 새로 씀.
"""
import csv
import os
import re
import struct
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.path.join(ROOT, "assets", "vendor")
SRCS = [
    os.path.join(VENDOR, "epic-rpg-world", "RafaelMatos"),  # 유니티 컬렉션
    os.path.join(VENDOR, "epic-rpg-world-free-interiors"),  # itch 무료 집 내부
]
DOC = os.path.join(ROOT, "docs", "06_EpicRPGWorld_에셋목록.md")
CSV = os.path.join(ROOT, "docs", "data", "epic_rpg_world_files.csv")

KEEP = {".png", ".gif", ".tsx", ".tmx", ".aseprite", ".txt"}

PACK_KO = {
    "ERW - Cemetery": "묘지",
    "ERW - Desert": "사막",
    "ERW - Highlands": "고원/설원",
    "ERW - Old Prison": "옛 감옥",
    "ERW - Sewers": "하수도",
    "ERW - The Depths": "산속 깊은 곳 (동굴)",
    "ERW - The Village": "마을",
    "ERW - Volcano": "화산",
    "ERW-Ancient Ruins": "고대 유적",
    "ERW-Crypt": "지하묘소",
    "ERW-Grass Land": "초원 (구버전)",
    "ERW-Grassland 2.0": "초원 2.0",
    "ERW-Sea Adventures-GL2 Expansion": "바다 모험 (초원 2.0 확장)",
    "Epic RPG World - Village(interiors) V1.3": "집 내부 (무료판, itch)",
}

USE = {
    "ERW - The Village": "**핵심**. 마을 건물, 벽/지붕 조합, 굴뚝",
    "ERW-Grassland 2.0": "**핵심**. 초원, 나무, 울타리, 다리, 우물, 모닥불, 작은 동물",
    "ERW-Grass Land": "초원 보조, 대장간 소품, UI",
    "ERW - Highlands": "겨울 지형, 작은 성, 트롤",
    "ERW - Cemetery": "묘지, 장례, 유령, 까마귀",
    "ERW-Ancient Ruins": "유적, 제단, 순례지",
    "ERW-Sea Adventures-GL2 Expansion": "해안, 배, 낚시, 가게",
    "ERW - Old Prison": "재판 처벌(감옥) 장면",
    "ERW-Crypt": "지하묘소, 거미, 해골 (괴물은 드물게)",
    "ERW - The Depths": "고블린 (괴물은 드물게)",
    "ERW - Sewers": "쥐 (역병 연출)",
    "ERW - Desert": "거의 안 씀 (카펫 소품 정도)",
    "ERW - Volcano": "거의 안 씀",
    "Epic RPG World - Village(interiors) V1.3": "**핵심**. 집 내부 가구, 소품, 창문, 문, 바닥, 카펫, 촛불/궤짝 애니메이션",
}


def kind_of(path):
    p = path.lower()
    if "character" in p or "enem" in p or "npc" in p or "monster" in p:
        return "캐릭터/괴물"
    if "tileset" in p or p.endswith((".tsx", ".tmx")):
        return "타일셋/맵"
    if "anim" in p or p.endswith(".gif"):
        return "애니메이션"
    if "ui" in re.split(r"[\\/ _\-]", p):
        return "UI"
    if "prop" in p or "object" in p or "house" in p or "building" in p:
        return "소품/건물"
    if "background" in p or "parallax" in p:
        return "배경"
    return "기타"


def png_size(path):
    try:
        with open(path, "rb") as f:
            head = f.read(24)
        if head[:8] == b"\x89PNG\r\n\x1a\n":
            w, h = struct.unpack(">II", head[16:24])
            return w, h
    except OSError:
        pass
    return None, None


SEQ = re.compile(r"^(.*?)(\d+)$")


def compress(names):
    """번호만 다른 파일 이름을 'stem{0..6}' 식으로 묶음."""
    groups = defaultdict(list)
    singles = []
    for n in names:
        stem, ext = os.path.splitext(n)
        m = SEQ.match(stem)
        if m:
            groups[(m.group(1), ext)].append(int(m.group(2)))
        else:
            singles.append(n)
    out = []
    for (prefix, ext), nums in groups.items():
        nums.sort()
        if len(nums) == 1:
            out.append(f"{prefix}{nums[0]}{ext}")
        else:
            out.append(f"{prefix}{{{nums[0]}..{nums[-1]}}}{ext} ({len(nums)}개)")
    return sorted(singles + out, key=str.lower)


def main():
    rows = []
    folders = defaultdict(list)
    for SRC in SRCS:
      if not os.path.isdir(SRC):
        continue
      for dirpath, _, files in os.walk(SRC):
        for fn in files:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in KEEP:
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, SRC).replace("\\", "/")
            pack = rel.split("/")[0]
            w, h = png_size(full) if ext == ".png" else (None, None)
            kb = round(os.path.getsize(full) / 1024, 1)
            kind = kind_of(rel)
            rows.append([pack, PACK_KO.get(pack, ""), kind, rel, ext, w or "", h or "", kb])
            folders[os.path.dirname(rel)].append(fn)

    os.makedirs(os.path.dirname(CSV), exist_ok=True)
    with open(CSV, "w", newline="", encoding="utf-8-sig") as f:
        wr = csv.writer(f)
        wr.writerow(["팩", "팩(한글)", "종류", "경로(팩 폴더 기준)", "확장자", "너비px", "높이px", "KB"])
        wr.writerows(sorted(rows, key=lambda r: r[3].lower()))

    by_pack = defaultdict(list)
    for r in rows:
        by_pack[r[0]].append(r)

    lines = []
    lines += [
        "---",
        "type: reference",
        "tags:",
        "  - domain/gamedev",
        "  - topic/assets",
        "created: 2026-09-26",
        "---",
        "",
        "# Epic RPG World 에셋 목록",
        "",
        "> [!info] 이 문서",
        "> - 유니티 에셋 스토어에서 받은 **Epic RPG World Collection v1.8** (RafaelMatos)을 풀어 `assets/vendor/epic-rpg-world/RafaelMatos/`에 둔 것 + itch에서 받은 무료 **Village(interiors) V1.3** (`assets/vendor/epic-rpg-world-free-interiors/`)의 목록",
        "> - 게임에 쓰는 파일(PNG, GIF, Tiled .tsx/.tmx, Aseprite, 안내 txt)만 셈. 유니티 전용 파일(.asset, .prefab, .anim, .controller, .unity)은 제외",
        "> - 파일 하나하나의 경로, 픽셀 크기, 용량은 `docs/data/epic_rpg_world_files.csv` (엑셀로 열어 필터/검색)",
        "> - 번호만 다른 파일은 `이름{0..6}.png (7개)`처럼 묶어서 표시",
        "> - 다시 만들기: `python tools/catalog_epic_rpg_world.py`",
        "> - 어떤 것을 게임에 쓸지는 `assets/curation.md`, 역할 분담은 `docs/04_에셋_목록.md` 1절",
        "",
        "> [!warning] 확인된 사실",
        "> - 유니티 컬렉션에는 집 내부 가구가 거의 없어서, 같은 제작자의 [Free House Interiors](https://rafaelmatos.itch.io/epic-rpg-world-free-house-interiors)(무료)를 따로 받아 함께 정리함 (2026-09-26)",
        "> - NPC는 좌우 2방향이라 게임의 사람으로는 쓰지 않음 (사람은 LPC)",
        "",
        "## 1. 팩 요약",
        "",
        "| 팩 | 한글 | PNG | GIF | Tiled | 이 게임에서 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    total_png = 0
    for pack in sorted(by_pack):
        rs = by_pack[pack]
        n_png = sum(1 for r in rs if r[4] == ".png")
        n_gif = sum(1 for r in rs if r[4] == ".gif")
        n_tiled = sum(1 for r in rs if r[4] in (".tsx", ".tmx"))
        total_png += n_png
        lines.append(f"| {pack} | {PACK_KO.get(pack, '')} | {n_png} | {n_gif} | {n_tiled} | {USE.get(pack, '')} |")
    lines += ["", f"PNG 합계 {total_png}개", ""]

    lines += ["## 2. 종류별 찾기", "", "| 종류 | 팩별 개수 |", "| --- | --- |"]
    kinds = defaultdict(lambda: defaultdict(int))
    for r in rows:
        kinds[r[2]][PACK_KO.get(r[0], r[0])] += 1
    for k in sorted(kinds):
        detail = ", ".join(f"{p} {n}" for p, n in sorted(kinds[k].items(), key=lambda x: -x[1]))
        lines.append(f"| {k} | {detail} |")
    lines.append("")

    lines += ["## 3. 팩별 상세", ""]
    for pack in sorted(by_pack):
        lines += [f"### {pack} ({PACK_KO.get(pack, '')})", "", f"이 게임에서: {USE.get(pack, '-')}", ""]
        pack_folders = sorted(d for d in folders if d == pack or d.startswith(pack + "/"))
        lines += ["| 폴더 | 종류 | 파일 수 | 파일 |", "| --- | --- | --- | --- |"]
        for d in pack_folders:
            names = folders[d]
            comp = compress(names)
            shown = comp[:40]
            more = f" 외 {len(comp) - 40}묶음" if len(comp) > 40 else ""
            sub = d[len(pack):].lstrip("/") or "(팩 최상위)"
            lines.append(f"| `{sub}` | {kind_of(d)} | {len(names)} | {', '.join(shown)}{more} |")
        lines.append("")

    with open(DOC, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"문서: {DOC}\nCSV: {CSV}\n파일 {len(rows)}개, PNG {total_png}개, 폴더 {len(folders)}개")


if __name__ == "__main__":
    main()
