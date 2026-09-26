/**
 * 21 프리셋 한 세대 헤드리스 (BRIEF M8, GDD 29-1 "시작 신분별 한 인생 생존/유지", "한 세대에 신분 상승", 29-4 봇).
 * 한 부지 모드 (마을 없이 조작 가문만, 가속: 전체 세밀도 틱이지만 인물이 적어 빠름). 프리셋 적용 → 가장이 죽을 때까지 (최대 --days).
 *   npx tsx tools/sim-lives.ts [--seeds 50] [--presets all|serf_poor,...] [--bot both|random|strategy] [--days 110] [--procs 20]
 * 무작위 봇: 조작 명령 없음 (자율 + 카드 시간 초과 자동 선택). 전략 봇: 29-4 신분별 목표 스크립트 (해방금, 도제→걸작→길드, 상인, 작위, 기사 서임)
 * 판정: "파산/몰락 없이" = 가정 파산 알림 0 이고 가정 대표 신분이 떨어지지 않음. 상승 = 끝 신분 순위 > 시작 신분 순위
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadSimData } from './data-node';
import { Simulation } from '../src/sim/sim';
import type { Person } from '../src/sim/people/person';

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};

interface Job { preset: string; seed: number; bot: 'random' | 'strategy' }
interface Res extends Job { survived: boolean; bankrupt: boolean; fell: boolean; ascended: boolean; startEstate: string; endEstate: string; days: number; headDied: boolean; money: number; error?: string }

const RANK: Record<string, number> = { serf: 0, freeman: 1, artisan: 2, merchant: 3, clergy: 4, knight: 5, noble: 6 };

function runOne(job: Job, maxDays: number): Res {
  const sim = new Simulation(loadSimData({}), job.seed);
  const r = sim.apply({ kind: 'house', op: 'applyPreset', args: { preset: job.preset } }) as { ok: boolean; reason?: string; result?: { estate: string; ids: number[]; specs: { role: string }[] } };
  const base: Res = { ...job, survived: false, bankrupt: false, fell: false, ascended: false, startEstate: '', endEstate: '', days: 0, headDied: false, money: 0 };
  if (!r.ok || !r.result) return { ...base, error: r.reason ?? 'preset' };
  const H = sim.house!;
  const start = H.householdEstate(1);
  const headId = r.result.ids[r.result.specs.findIndex((s) => s.role === 'head')];
  let bankrupt = false;
  let fell = false;
  const onB = H.onBankrupt.bind(H);
  H.onBankrupt = (hh: number) => {
    if (hh === 1) bankrupt = true;
    onB(hh);
  };
  let lowest = RANK[start] ?? 0;
  let day = 0;
  let headDied = false;
  for (; day < maxDays; day++) {
    for (let t = 0; t < 1440; t++) sim.tick();
    const e = H.householdEstate(1);
    if ((RANK[e] ?? 0) < lowest) {
      fell = true;
      lowest = RANK[e] ?? 0;
    }
    if (job.bot === 'strategy') strategy(sim, start);
    if (!sim.persons.some((q) => q.id === headId)) {
      headDied = true;
      break;
    }
    if (!sim.persons.some((q) => q.household === 1)) break;
  }
  const end = H.householdEstate(1);
  return {
    ...base,
    bankrupt,
    fell,
    survived: !bankrupt && !fell && sim.persons.some((q) => q.household === 1),
    ascended: (RANK[end] ?? 0) > (RANK[start] ?? 0),
    startEstate: start,
    endEstate: end,
    days: day,
    headDied,
    money: sim.econ?.account(1)?.money ?? 0,
  };
}

/** 전략 봇 (29-4 신분별 목표 스크립트): 날마다 할 수 있으면 다음 단계 */
function strategy(sim: Simulation, _start: string): void {
  const H = sim.house!;
  const hh = 1;
  const est = H.householdEstate(hh);
  const fam = sim.persons.filter((q) => q.household === hh);
  const head = H.headOf(hh);
  if (!head) return;
  const act = (op: string, args: Record<string, unknown> = {}) => sim.apply({ kind: 'house', op, args }) as { ok: boolean };
  const adults = fam.filter((q) => q.lifeStage === 'young' || q.lifeStage === 'adult');
  if (est === 'serf') act('payEmancipation');
  else if (est === 'freeman') {
    // 도제 → 직인 → 걸작 → 장인 (길드 가입)
    const E = H.estates;
    for (const p of adults) {
      const st = E.guildStage(p);
      if (!st) act('startApprenticeship', { personId: p.id, craft: 'blacksmith' });
      else if (st === 'masterpiece') act('submitMasterpiece', { personId: p.id, quality: 3 + Math.min(2, (sim.skills?.level(p, 'smithing') ?? 0) / 3) });
      else if (st === 'master') act('joinGuild', { personId: p.id });
    }
  } else if (est === 'artisan') act('becomeMerchant', { personId: head.id });
  else if (est === 'merchant') act('buyTitle');
  else if (est === 'knight') act('buyTitle');
}

async function main(): Promise<void> {
  const one = arg('one', '');
  const maxDays = Number(arg('days', '110'));
  if (one) {
    // 자식 프로세스: 작업 여러 개를 받아 JSON 한 줄씩
    for (const j of one.split(',')) {
      const [preset, seed, bot] = j.split(':');
      let res: Res;
      try {
        res = runOne({ preset, seed: Number(seed), bot: bot as Job['bot'] }, maxDays);
      } catch (e) {
        res = { preset, seed: Number(seed), bot: bot as Job['bot'], survived: false, bankrupt: false, fell: false, ascended: false, startEstate: '', endEstate: '', days: 0, headDied: false, money: 0, error: String((e as Error).stack ?? e).slice(0, 400) };
      }
      process.stdout.write(`RES ${JSON.stringify(res)}\n`);
    }
    return;
  }
  const t0 = Date.now();
  const SEEDS = Number(arg('seeds', '50'));
  const BOT = arg('bot', 'both');
  const probe = new Simulation(loadSimData({}), 1);
  const all = probe.house!.presetList();
  const presets = arg('presets', 'all') === 'all' ? all : arg('presets', '').split(',');
  const bots: Job['bot'][] = BOT === 'both' ? ['random', 'strategy'] : [BOT as Job['bot']];
  const jobs: Job[] = [];
  for (const bot of bots) for (const preset of presets) for (let s = 1; s <= SEEDS; s++) jobs.push({ preset, seed: s, bot });
  const PROCS = Math.min(Number(arg('procs', '20')), jobs.length);
  const chunks: Job[][] = Array.from({ length: PROCS }, () => []);
  jobs.forEach((j, i) => chunks[i % PROCS].push(j));
  const results: Res[] = [];
  let done = 0;
  await Promise.all(chunks.map((c) => new Promise<void>((resolve) => {
    const cp = spawn(process.execPath, [...process.execArgv, process.argv[1], '--one', c.map((j) => `${j.preset}:${j.seed}:${j.bot}`).join(','), '--days', String(maxDays)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    cp.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      let k;
      while ((k = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, k);
        buf = buf.slice(k + 1);
        if (!line.startsWith('RES ')) continue;
        results.push(JSON.parse(line.slice(4)));
        done++;
        if (done % 25 === 0) process.stdout.write(`${done}/${jobs.length} (${((Date.now() - t0) / 1000).toFixed(0)}초)\n`);
      }
    });
    cp.on('close', () => resolve());
  })));
  // 집계: 프리셋 × 봇
  const wilson = (k: number, n: number): [number, number] => {
    if (!n) return [0, 1];
    const z = 1.96;
    const p = k / n;
    const d = 1 + (z * z) / n;
    const c = (p + (z * z) / (2 * n)) / d;
    const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
    return [c - h, c + h];
  };
  const table: Record<string, unknown>[] = [];
  const errors = results.filter((r) => r.error);
  for (const bot of bots) for (const preset of presets) {
    const rs = results.filter((r) => r.bot === bot && r.preset === preset && !r.error);
    const n = rs.length;
    const surv = rs.filter((r) => r.survived).length;
    const asc = rs.filter((r) => r.ascended).length;
    table.push({ bot, preset, n, survival: +(surv / Math.max(1, n)).toFixed(3), survivalCI: wilson(surv, n).map((x) => +x.toFixed(3)), ascent: +(asc / Math.max(1, n)).toFixed(3), ascentCI: wilson(asc, n).map((x) => +x.toFixed(3)), headDied: rs.filter((r) => r.headDied).length, avgDays: Math.round(rs.reduce((a, r) => a + r.days, 0) / Math.max(1, n)) });
  }
  // 29-1 목표 판정
  const target = (preset: string, bot: string) => {
    const w = preset.split('_')[1];
    const row = table.find((x) => x.preset === preset && x.bot === bot) as { survivalCI: number[] } | undefined;
    if (!row || bot !== 'random') return null;
    const [lo, hi] = row.survivalCI;
    if (w === 'normal') return lo >= 0.7 && hi <= 0.9;
    if (w === 'poor') return lo >= 0.45;
    return lo >= 0.85;
  };
  const checks = presets.map((p) => ({ preset: p, pass: target(p, 'random') }));
  const ascBy = (bot: string) => {
    const rs = results.filter((r) => r.bot === bot && !r.error);
    const k = rs.filter((r) => r.ascended).length;
    return { rate: +(k / Math.max(1, rs.length)).toFixed(3), ci: wilson(k, rs.length).map((x) => +x.toFixed(3)), n: rs.length };
  };
  const asc = { random: ascBy('random'), strategy: ascBy('strategy') };
  const out = { seeds: SEEDS, days: maxDays, table, checks, ascent: asc, errors: errors.slice(0, 10), errorCount: errors.length, seconds: Math.round((Date.now() - t0) / 1000) };
  mkdirSync('artifacts/lives', { recursive: true });
  writeFileSync(arg('out', 'artifacts/lives/presets.json'), JSON.stringify(out, null, 1));
  for (const row of table) console.log(JSON.stringify(row));
  for (const c of checks) console.log(`${c.pass === null ? '-' : c.pass ? '통과' : '✗'} ${c.preset} 무작위 봇 생존`);
  console.log(`상승: 무작위 ${JSON.stringify(asc.random)} (목표 < 10%) / 전략 ${JSON.stringify(asc.strategy)} (목표 25~40%)`);
  console.log(`오류 ${errors.length}건, ${out.seconds}초`);
}

void main();
export type { Person };
