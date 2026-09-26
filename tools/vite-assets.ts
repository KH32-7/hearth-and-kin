/**
 * 빌드 때 게임이 참조하는 그림 파일을 dist 로 복사 (경로 그대로, 레포 루트 기준).
 * - 세계 팩(epic.json) images, UI 아틀라스, assets/generated/**
 * - LPC: lpc.json 레이어 경로 아래의 png (합성기가 런타임에 고름)
 * 개발 서버는 루트를 그대로 제공하므로 아무것도 안 함.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import fg from 'fast-glob';
import type { Plugin } from 'vite';

export function vendorAssets(): Plugin {
  let outDir = 'dist';
  return {
    name: 'hearth-vendor-assets',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files = new Set<string>();
      const epic = JSON.parse(readFileSync('src/data/artpacks/epic.json', 'utf8')) as { images: Record<string, string> };
      for (const p of Object.values(epic.images)) files.add(p);
      if (existsSync('src/data/ui/atlas.json')) files.add((JSON.parse(readFileSync('src/data/ui/atlas.json', 'utf8')) as { image: string }).image);
      for (const f of fg.sync('assets/generated/**/*.png')) files.add(f);
      const lpc = JSON.parse(readFileSync('src/data/artpacks/lpc.json', 'utf8')) as {
        roots: { lpc: string; gen: string };
        layers: Record<string, { parts: { paths: Record<string, string> }[] }>;
      };
      const dirs = new Set<string>();
      for (const l of Object.values(lpc.layers)) for (const part of l.parts) for (const p of Object.values(part.paths)) dirs.add(p);
      for (const d of dirs) {
        const base = d.startsWith('assets/') ? d : `${lpc.roots.lpc}${d}`;
        for (const f of fg.sync(`${base}**/*.png`)) files.add(f);
      }
      let n = 0;
      for (const f of files) {
        if (!existsSync(f)) continue;
        const dst = join(outDir, f);
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(f, dst);
        n++;
      }
      console.log(`[hearth-vendor-assets] ${n}개 그림 복사`);
    },
  };
}
