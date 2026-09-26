/**
 * 에셋 크레딧 검사 (CLAUDE.md 에셋 규칙): 게임이 읽는 모든 이미지가 CREDITS.json 항목으로 덮이는지,
 * CC-BY-SA 로 가공한 생성 파일이 SHARE_ALIKE.md 에 있는지, AI 생성 파일이 AI_GENERATED.md 에 있는지.
 *   npx tsx tools/check-credits.ts
 */
import fs from 'node:fs';
import path from 'node:path';

interface Credit { id: string; pack: string; files: string; licenses: string[]; attribution?: string; modified?: boolean }
const credits = JSON.parse(fs.readFileSync('assets/CREDITS.json', 'utf8')) as Credit[];
const shareAlike = fs.readFileSync('assets/SHARE_ALIKE.md', 'utf8');
const aiDoc = fs.existsSync('assets/AI_GENERATED.md') ? fs.readFileSync('assets/AI_GENERATED.md', 'utf8') : '';
const errors: string[] = [];
const warnings: string[] = [];

for (const c of credits) {
  if (!c.id || !c.files) errors.push(`CREDITS 항목에 id/files 없음: ${JSON.stringify(c).slice(0, 80)}`);
  if (!c.licenses?.length) errors.push(`${c.id}: 라이선스 없음`);
  if (!c.attribution && c.licenses?.some((l) => /BY/.test(l))) warnings.push(`${c.id}: 표기 문구(attribution) 없음`);
}
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
const covered = (file: string): boolean => {
  const f = norm(file);
  return credits.some((c) => {
    const base = norm(c.files);
    return f === base || f.startsWith(base + '/') || (base.includes('*') && new RegExp('^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(f));
  });
};

// 게임이 읽는 이미지: 아트 팩, UI 아틀라스
const used = new Set<string>();
for (const f of fs.readdirSync('src/data/artpacks')) {
  if (!f.endsWith('.json')) continue;
  const pack = JSON.parse(fs.readFileSync(path.join('src/data/artpacks', f), 'utf8')) as { images?: Record<string, string> };
  for (const p of Object.values(pack.images ?? {})) used.add(p);
}
const uiAtlas = 'src/data/ui/atlas.json';
if (fs.existsSync(uiAtlas)) {
  const a = JSON.parse(fs.readFileSync(uiAtlas, 'utf8')) as { image?: string; images?: Record<string, string> };
  if (a.image) used.add(a.image);
  for (const p of Object.values(a.images ?? {})) used.add(p);
}
let vendorN = 0;
let genN = 0;
for (const p of used) {
  if (p.startsWith('assets/vendor/')) {
    vendorN++;
    if (!covered(p)) errors.push(`크레딧 없는 원본 이미지: ${p}`);
  } else if (p.startsWith('assets/generated/')) {
    genN++;
    // 생성물은 build-world/build-catalog/build-ui-atlas 가 원본에서 만듦: 원본 팩은 CREDITS 에, SA 가공물은 SHARE_ALIKE 에
    const base = path.basename(p);
    if (/_sa_/.test(base) && !shareAlike.includes(base.replace(/_\d+\.png$/, '_*.png')) && !shareAlike.includes(base)) errors.push(`CC-BY-SA 아틀라스 ${p} 가 SHARE_ALIKE.md 에 없음`);
  } else if (p.startsWith('assets/original/')) {
    // 직접 그린 원본 (이 레포 저작물)
  } else if (p.startsWith('assets/ai/') || /ai[_-]gen/i.test(p)) {
    if (!aiDoc.includes(path.basename(p))) errors.push(`AI 생성 파일 ${p} 가 AI_GENERATED.md 에 없음`);
  } else warnings.push(`분류 안 된 이미지 경로: ${p}`);
}
// SA 로 수정했다고 표시된 크레딧 → SHARE_ALIKE 에 원본 팩 이름이 있어야
for (const c of credits) {
  if (c.modified && c.licenses?.length === 1 && /SA/.test(c.licenses[0]) && !shareAlike.includes(c.id) && !shareAlike.includes(c.pack) && !shareAlike.includes(norm(c.files))) {
    errors.push(`${c.id}: CC-BY-SA 단독 라이선스를 가공했는데 SHARE_ALIKE.md 에 없음`);
  }
}
// 폰트: 넥슨 워헤이븐체 (수정 없이 배포 파일 그대로)
const fontDir = 'assets/fonts';
if (fs.existsSync(fontDir)) {
  for (const f of fs.readdirSync(fontDir)) {
    if (!/\.(woff2?|ttf|otf)$/i.test(f)) continue;
    if (!covered(path.join(fontDir, f).replace(/\\/g, '/'))) warnings.push(`폰트 ${f} 크레딧 없음`);
  }
}
console.log(`크레딧 ${credits.length}항목, 게임이 읽는 이미지 ${used.size} (원본 ${vendorN}, 생성 ${genN})`);
for (const w of warnings.slice(0, 20)) console.log(`  경고: ${w}`);
if (errors.length) {
  for (const e of errors) console.log(`  ✗ ${e}`);
  console.log(`check:credits 실패 ${errors.length}건`);
  process.exit(1);
}
console.log('check:credits 통과');
