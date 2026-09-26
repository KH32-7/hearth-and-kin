/**
 * 기능 목록 커버리지 (BRIEF 6장): tests/features.json 의 기능마다 테스트 id(파일::테스트 이름 앞부분)가 실제로 있는지,
 * 마일스톤별 커버리지. --run 이면 vitest 를 돌려 통과한 테스트의 기능에 lastPass(날짜)를 적음.
 *   npx tsx tools/check-features.ts [--run] [--strict]   (--strict: 커버리지 100% 아니면 실패, 출시용)
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

interface Feature { area: string; name: string; doc: string; milestone: string; tests: string[]; lastPass: string | null }
const file = 'tests/features.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { $comment: string; features: Record<string, Feature> };
const args = process.argv.slice(2);
const errors: string[] = [];
const titles = new Map<string, string[]>();
const titlesOf = (f: string): string[] => {
  if (!titles.has(f)) {
    const src = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    const out: string[] = [];
    for (const m of src.matchAll(/\b(?:it|test)\(\s*(['`])((?:(?!\1).)+)\1/g)) out.push(m[2]);
    titles.set(f, out);
  }
  return titles.get(f)!;
};
for (const [id, f] of Object.entries(data.features)) {
  for (const t of f.tests) {
    const [path, name] = t.split('::');
    if (!fs.existsSync(path)) errors.push(`${id}: 테스트 파일 없음 ${path}`);
    else if (!titlesOf(path).some((x) => x.startsWith(name) || x.includes(name))) errors.push(`${id}: ${path} 에 "${name}" 테스트 없음`);
  }
}
if (args.includes('--run')) {
  // 유닛 테스트 결과로 lastPass
  execSync('npx vitest run --reporter=json --outputFile=artifacts/vitest.json', { stdio: 'ignore' });
  const res = JSON.parse(fs.readFileSync('artifacts/vitest.json', 'utf8')) as { testResults: { name: string; assertionResults: { title: string; status: string }[] }[] };
  const passed = new Set<string>();
  for (const r of res.testResults) {
    const rel = r.name.replace(/\\/g, '/').replace(/^.*?(tests\/)/, '$1');
    for (const a of r.assertionResults) if (a.status === 'passed') passed.add(`${rel}::${a.title}`);
  }
  // E2E 결과 (playwright --reporter=json 로 artifacts/playwright.json 을 남겼다면)
  if (fs.existsSync('artifacts/playwright.json')) {
    const pw = JSON.parse(fs.readFileSync('artifacts/playwright.json', 'utf8')) as { suites: unknown[] };
    const walk = (s: { file?: string; specs?: { title: string; ok: boolean; file?: string }[]; suites?: unknown[] }, f?: string) => {
      const file2 = s.file ?? f;
      for (const sp of s.specs ?? []) if (sp.ok) passed.add(`tests/e2e/${(sp.file ?? file2 ?? '').replace(/^.*[\\/]/, '')}::${sp.title}`);
      for (const c of (s.suites ?? []) as never[]) walk(c, file2);
    };
    for (const s of pw.suites as never[]) walk(s);
  }
  const today = new Date().toISOString().slice(0, 10);
  for (const f of Object.values(data.features)) {
    if (f.tests.length && f.tests.every((t) => [...passed].some((p) => { const [a, b] = t.split('::'); const [c, d] = p.split('::'); return a === c && (d.startsWith(b) || d.includes(b)); }))) f.lastPass = today;
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
}
const all = Object.values(data.features);
const covered = all.filter((f) => f.tests.length > 0);
const byMs = new Map<string, { n: number; c: number; p: number }>();
for (const f of all) {
  const m = byMs.get(f.milestone) ?? { n: 0, c: 0, p: 0 };
  m.n++;
  if (f.tests.length) m.c++;
  if (f.lastPass) m.p++;
  byMs.set(f.milestone, m);
}
const order = [...byMs.keys()].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
console.log(`기능 ${all.length}개, 테스트 연결 ${covered.length} (${Math.round((covered.length / all.length) * 100)}%)`);
for (const m of order) {
  const v = byMs.get(m)!;
  console.log(`  ${m.padEnd(4)} ${String(v.c).padStart(3)}/${String(v.n).padEnd(3)} 연결, 통과 기록 ${v.p}`);
}
for (const e of errors) console.log(`  ✗ ${e}`);
if (errors.length || (args.includes('--strict') && covered.length < all.length)) {
  console.log('check:features 실패');
  process.exit(1);
}
console.log('check:features 통과 (테스트 id 모두 존재)');
