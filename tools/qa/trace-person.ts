import { loadSimData } from '../data-node';
import { Simulation } from '../../src/sim/sim';
import { scoreCandidates } from '../../src/sim/action/autonomy';
const name = process.argv[2] ?? '레지널드';
const from = Number(process.argv[3] ?? 700), to = Number(process.argv[4] ?? 900);
const sim = new Simulation(loadSimData({ town: 'ashford' }), 1);
sim.apply({ kind: 'forceLod', lod: 'full' });
const p = sim.persons.find((q) => q.name === name)!;
let last = '';
for (let i = 0; i < to; i++) {
  sim.tick();
  if (i < from) continue;
  const a = p.action ? `${p.action.item.interactionId}/${p.action.phase}` : '-';
  const s = `${a} q${p.queue.length} idle${Math.max(0, p.idleUntil - sim.world.minute)} status ${p.status} lod ${p.lod}`;
  if (s !== last || i % 30 === 0) {
    const buf: never[] = [];
    scoreCandidates(sim.data, sim.world, p, buf as never, undefined, undefined, (o) => (sim as unknown as { canUse(p: unknown, o: unknown): boolean }).canUse(p, o));
    const top = (buf as { interactionId: string; score: number }[]).sort((x, y) => y.score - x.score).slice(0, 4).map((c) => `${c.interactionId}:${c.score.toFixed(2)}`).join(' ');
    console.log(sim.world.minuteOfDay(), `H${p.need('hunger').toFixed(0)} B${p.need('bladder').toFixed(0)} E${p.need('energy').toFixed(0)} Hy${p.need('hygiene').toFixed(0)}`, `@${p.x.toFixed(0)},${p.y.toFixed(0)}`, s, '|', top, '| career', p.career?.id ?? '', p.schedule);
    last = s;
  }
}
