import needs from '../../src/data/needs.json';
import balance from '../../src/data/balance.json';
import interactions from '../../src/data/interactions.json';
import objects from '../fixtures/objects.json';
import lot from '../fixtures/lot.json';
import { validateSimData, type SimData } from '../../src/sim/data/simData';
import { Simulation } from '../../src/sim/sim';

export function fixtureData(): SimData {
  return validateSimData({ needs, balance, interactions, objects, lot });
}

export function makeSim(seed = 1): Simulation {
  const sim = new Simulation(fixtureData(), seed);
  sim.addPerson('테스트');
  return sim;
}

export function runMinutes(sim: Simulation, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}

import { loadSimData } from '../../tools/data-node';

/** 실제 게임 데이터(오두막 + 내면 + 사회)로 만든 시뮬레이션 데이터 */
export function cottageData(inner = true): SimData {
  return loadSimData({ inner });
}
