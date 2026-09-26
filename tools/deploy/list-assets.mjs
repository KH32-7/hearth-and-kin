// GitHub Pages 빌드에 필요한 비공개 그림 목록 (git 에 없는 것: assets/vendor, assets/generated/world, assets/generated/ui)
// tools/vite-assets.ts 가 dist 로 복사하는 것과 같은 규칙. 한 줄에 경로 하나를 stdout 으로
import { existsSync, readFileSync } from 'node:fs';
import fg from 'fast-glob';

const files = new Set();
const epic = JSON.parse(readFileSync('src/data/artpacks/epic.json', 'utf8'));
for (const p of Object.values(epic.images)) files.add(p);
if (existsSync('src/data/ui/atlas.json')) files.add(JSON.parse(readFileSync('src/data/ui/atlas.json', 'utf8')).image);
for (const f of fg.sync('assets/generated/**/*.png')) files.add(f);
const lpc = JSON.parse(readFileSync('src/data/artpacks/lpc.json', 'utf8'));
const dirs = new Set();
for (const l of Object.values(lpc.layers)) for (const part of l.parts) for (const p of Object.values(part.paths)) dirs.add(p);
for (const d of dirs) {
  const base = d.startsWith('assets/') ? d : `${lpc.roots.lpc}${d}`;
  for (const f of fg.sync(`${base}**/*.png`)) files.add(f);
}
const priv = [...files].filter((f) => existsSync(f) && /^assets\/(vendor|generated\/world|generated\/ui)\//.test(f)).sort();
process.stdout.write(priv.join('\n') + '\n');
