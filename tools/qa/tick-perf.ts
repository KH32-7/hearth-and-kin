/** 틱 시간 측정: 애쉬포드 N일 (기본 2) */
import { loadSimData } from '../data-node';
import { Simulation } from '../../src/sim/sim';
const days = Number(process.argv[2] ?? 2);
const d = loadSimData({ town: 'ashford' });
const sim = new Simulation(d, 9);
const t0 = performance.now();
for (let i = 0; i < days * 1440; i++) sim.tick();
const ms = performance.now() - t0;
console.log(`${days}일 ${(ms / 1000).toFixed(1)}초, 틱 ${(ms / (days * 1440)).toFixed(3)}ms, house=${!!sim.house}`);
