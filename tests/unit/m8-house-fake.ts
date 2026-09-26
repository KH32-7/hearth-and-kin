/**
 * M8 가문 모듈 테스트용 가짜 Host (src/sim/house/clans.ts HouseAllHost). 리드의 sim.ts 구현 없이
 * 가문·명예·상속·가보·하인을 돌려 봄. 모든 부수 효과를 기록 배열에 남김
 */
import { readFileSync } from 'node:fs';
import { Rng } from '../../src/sim/core/rng';
import { Person, type LifeStage } from '../../src/sim/people/person';
import { createHouse, parseClans, type ClansData, type House, type HouseAllHost, type ServantRole } from '../../src/sim/house/clans';
import type { Heirloom, HeirloomRef } from '../../src/sim/house/heirlooms';

export const clansData = (): ClansData => parseClans(JSON.parse(readFileSync('src/data/clans.json', 'utf8')));

const SKILL_CAT: Record<string, string> = JSON.parse(readFileSync('src/data/skills.json', 'utf8')).skills
  ? Object.fromEntries(Object.entries(JSON.parse(readFileSync('src/data/skills.json', 'utf8')).skills as Record<string, { category?: string }>).map(([k, v]) => [k, v.category ?? '']))
  : {};

export interface FakeWorld {
  host: HouseAllHost & {
    persons: Person[];
    dayN: number;
    lifespanN: number;
    estate: Map<number, string>;
    moneyOf: Map<number, number>;
    houses: Map<number, number>;
    friend: Map<string, number>;
    objects: Map<number, { defId: string; household: number; damaged: boolean }>;
    priest: boolean;
    log: {
      moodlets: { p: number; id: string }[];
      memories: { p: number; kind: string }[];
      notices: { p: number; kind: string; args?: Record<string, string | number> }[];
      news: { kind: string }[];
      chronicle: { trigger: string; subjects: number[] }[];
      rumors: { p: number; kind: string }[];
      cards: { p: number; card: string; other: number; vars?: Record<string, string | number> }[];
      wishes: { p: number; id: string }[];
      scenes: { kind: string }[];
      funerals: number[];
      chooseControlled: number[];
      splits: { ids: number[]; hh: number; reason: string }[];
      accused: { from: number; to: number }[];
      transfers: { from: number; to: number; amount: number }[];
    };
    setFriend(a: Person, b: Person, v: number): void;
    addPerson(name: string, household: number, opts?: Partial<Pick<Person, 'sex' | 'lifeStage' | 'ageDays' | 'estate' | 'mother' | 'father' | 'spouse' | 'clanAffection'>>): Person;
    kill(p: Person): void;
    addObject(defId: string, household: number): number;
    moodletsOf(p: Person): string[];
  };
  house: House;
}

export function fakeWorld(seed = 1): FakeWorld {
  let pid = 0;
  let uid = 1000;
  let nextHh = 500;
  const log: FakeWorld['host']['log'] = {
    moodlets: [],
    memories: [],
    notices: [],
    news: [],
    chronicle: [],
    rumors: [],
    cards: [],
    wishes: [],
    scenes: [],
    funerals: [],
    chooseControlled: [],
    splits: [],
    accused: [],
    transfers: [],
  };
  const persons: Person[] = [];
  const estate = new Map<number, string>();
  const moneyOf = new Map<number, number>();
  const houses = new Map<number, number>();
  const friend = new Map<string, number>();
  const objects = new Map<number, { defId: string; household: number; damaged: boolean }>();
  const values: Record<string, number> = { anvil: 400, lute: 250, bookshelf: 180, tapestry: 300, candlestick: 60, chest_clothes: 90, knife: 20 };
  const host: FakeWorld['host'] = {
    persons,
    rng: new Rng(seed),
    dayN: 10,
    lifespanN: 1,
    estate,
    moneyOf,
    houses,
    friend,
    objects,
    priest: true,
    log,
    day() {
      return host.dayN;
    },
    lifespan() {
      return host.lifespanN;
    },
    controlled: (hh) => hh === 1,
    householdEstate: (hh) => estate.get(hh) ?? 'freeman',
    moodlet: (p, id) => void log.moodlets.push({ p: p.id, id }),
    memory: (p, kind) => void log.memories.push({ p: p.id, kind }),
    notice: (p, kind, args) => void log.notices.push({ p: p.id, kind, args }),
    news: (kind) => void log.news.push({ kind }),
    chronicle: (trigger, subjects) => void log.chronicle.push({ trigger, subjects: subjects.map((s) => s.id) }),
    rumor: (p, kind) => void log.rumors.push({ p: p.id, kind }),
    offerCard: (p, card, vars, other) => void log.cards.push({ p: p.id, card, other: other?.id ?? 0, vars }),
    friendship: (a, b) => friend.get(`${a.id}:${b.id}`) ?? 0,
    skillLevel: (p, sk) => p.skills[sk] ?? 0,
    money: (hh) => moneyOf.get(hh) ?? 0,
    savingsS: () => 1000,
    addWish: (p, id) => {
      log.wishes.push({ p: p.id, id });
      return true;
    },
    transferMoney: (from, to, amount) => {
      if ((moneyOf.get(from) ?? 0) < amount) return false;
      moneyOf.set(from, (moneyOf.get(from) ?? 0) - amount);
      moneyOf.set(to, (moneyOf.get(to) ?? 0) + amount);
      log.transfers.push({ from, to, amount });
      return true;
    },
    title: () => null,
    accuse: (from, to) => void log.accused.push({ from: from.id, to: to.id }),
    skillCategory: (sk) => SKILL_CAT[sk] ?? null,
    houseValue: (hh) => houses.get(hh) ?? 0,
    spend: (hh, amount) => {
      const m = moneyOf.get(hh) ?? 0;
      if (m < amount) return false;
      moneyOf.set(hh, m - amount);
      return true;
    },
    priestAvailable: () => host.priest,
    funeral: (p) => void log.funerals.push(p.id),
    scene: (kind) => void log.scenes.push({ kind }),
    chooseControlled: (clanId) => void log.chooseControlled.push(clanId),
    splitHousehold: (ps, reason) => {
      const hh = nextHh++;
      for (const p of ps) p.household = hh;
      log.splits.push({ ids: ps.map((p) => p.id), hh, reason });
      return hh;
    },
    // 가보
    defIdOf: (ref: HeirloomRef) => (ref.kind === 'object' ? objects.get(ref.uid)?.defId ?? null : ref.itemId),
    valueOf: (ref: HeirloomRef) => values[ref.kind === 'object' ? objects.get(ref.uid)?.defId ?? '' : ref.itemId] ?? 10,
    detach: (ref: HeirloomRef) => {
      if (ref.kind === 'object') objects.delete(ref.uid);
    },
    attach: (h: Heirloom, household: number): HeirloomRef | null => {
      if (h.ref.kind === 'object') {
        const o = objects.get(h.ref.uid);
        if (o) {
          o.household = household;
          return h.ref;
        }
        const n = ++uid;
        objects.set(n, { defId: h.defId, household, damaged: !!h.damaged });
        return { kind: 'object', uid: n };
      }
      return { ...h.ref, household };
    },
    setDamaged: (ref: HeirloomRef, d: boolean) => {
      if (ref.kind === 'object') {
        const o = objects.get(ref.uid);
        if (o) o.damaged = d;
      }
    },
    addMoney: (hh, amount) => void moneyOf.set(hh, (moneyOf.get(hh) ?? 0) + amount),
    // 하인
    householdSize: (hh) => persons.filter((p) => p.household === hh).length,
    createServant: (role: ServantRole, hh: number) => host.addPerson(`하인${role}`, hh, { lifeStage: 'adult' }),
    removeServant: (p) => {
      const i = persons.indexOf(p);
      if (i >= 0) persons.splice(i, 1);
    },
    setFriend(a, b, v) {
      friend.set(`${a.id}:${b.id}`, v);
      friend.set(`${b.id}:${a.id}`, v);
    },
    addPerson(name, household, opts = {}) {
      const p = new Person(++pid, name, 0, 0);
      p.household = household;
      p.lifeStage = (opts.lifeStage ?? 'adult') as LifeStage;
      Object.assign(p, opts);
      persons.push(p);
      return p;
    },
    kill(p) {
      const i = persons.indexOf(p);
      if (i >= 0) persons.splice(i, 1);
      for (const q of persons) if (q.spouse === p.id) q.spouse = 0;
    },
    addObject(defId, household) {
      const n = ++uid;
      objects.set(n, { defId, household, damaged: false });
      return n;
    },
    moodletsOf(p) {
      return log.moodlets.filter((m) => m.p === p.id).map((m) => m.id);
    },
  };
  const house = createHouse(host, clansData());
  return { host, house };
}

/** 부부 + 자녀들 (나이 많은 순으로 넘김). 가구 hh, 가문 등록까지 */
export function family(w: FakeWorld, hh: number, kids: { name: string; sex?: 'male' | 'female'; stage?: LifeStage; ageDays?: number }[], estate = 'freeman', name = 'house.h_player') {
  const { host, house } = w;
  host.estate.set(hh, estate);
  const dad = host.addPerson('아버지', hh, { sex: 'male', lifeStage: 'elder', ageDays: 10 });
  const mom = host.addPerson('어머니', hh, { sex: 'female', lifeStage: 'elder', ageDays: 5 });
  dad.spouse = mom.id;
  mom.spouse = dad.id;
  const children = kids.map((k) => host.addPerson(k.name, hh, { sex: k.sex ?? 'male', lifeStage: k.stage ?? 'adult', ageDays: k.ageDays ?? 0, mother: mom.id, father: dad.id }));
  const clan = house.clans.register({ households: [hh], name, estate, headId: dad.id });
  return { dad, mom, children, clan };
}
