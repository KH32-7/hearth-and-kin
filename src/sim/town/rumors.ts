/**
 * 소문 장소 전파 (GDD 14-6, 18-1 장소별 전파 배수): 한 시간마다 같은 장소에 있는 사람끼리,
 * 저녁에는 식구끼리 전해짐. 29-1: 큰 추문이 인구 절반까지 3~7일.
 * 세밀도와 무관 (간이/요약 인물은 일과표가 정한 장소 p.place 로 셈). M9 에서 추문 내용/명예 영향 확장
 */
import type { Rng } from '../core/rng';
import type { StoryData } from '../data/simData';
import type { Person } from '../people/person';
import type { Town } from './town';

export interface Rumor {
  id: number;
  kind: string;
  /** 소문의 주인공 (인물 id) */
  subjects: number[];
  args: Record<string, string | number>;
  day: number;
  /** 추문(큰 소문)이면 퍼지는 속도 배수 */
  juicy: number;
  knownBy: Set<number>;
  /** 인구 절반이 안 날 (측정) */
  halfDay: number | null;
}

export class Rumors {
  readonly list: Rumor[] = [];
  private nextId = 1;
  private groups = new Map<string, Person[]>();

  constructor(private rng: Rng, private s: StoryData['rumor'], private town: Town) {}

  add(kind: string, subjects: Person[], args: Record<string, string | number>, day: number, juicy = 1, knownBy: Person[] = subjects): Rumor {
    const r: Rumor = { id: this.nextId++, kind, subjects: subjects.map((p) => p.id), args, day, juicy, knownBy: new Set(knownBy.map((p) => p.id)), halfDay: null };
    this.list.push(r);
    if (this.list.length > 120) this.list.shift();
    return r;
  }

  /** 한 시간마다: 장소별로 모인 사람 쌍에서 전파 (쌍 수 상한), 저녁 7~9시에는 식구끼리 */
  hourly(persons: Person[], hour: number, day: number): void {
    if (!this.list.length) return;
    this.groups.clear();
    for (const p of persons) {
      if (p.infant) continue;
      const place = p.lod === 'full' ? this.town.placeOf(p.x, p.y)?.id ?? (this.town.lotOf(p.x, p.y)?.id === p.homeLot ? `home:${p.household}` : null) : p.place;
      if (!place) continue;
      let g = this.groups.get(place);
      if (!g) {
        g = [];
        this.groups.set(place, g);
      }
      g.push(p);
    }
    const evening = hour >= 19 && hour < 21;
    for (const [place, g] of this.groups) {
      if (g.length < 2) continue;
      const home = place.startsWith('home:');
      if (home && !evening) continue;
      const mult = home ? this.s.householdEvening / this.s.base : this.town.place(place)?.spread ?? 1;
      // 한 시간에 사람마다 한 명과 어울림 (무작위 짝, 장소당 상한)
      const n = Math.min(g.length, this.s.maxPairsPerPlace);
      for (let k = 0; k < n; k++) {
        const i = Math.floor(this.rng.next() * g.length);
        let j = Math.floor(this.rng.next() * (g.length - 1));
        if (j >= i) j++;
        this.share(g[i], g[j], mult);
      }
    }
    // 절반 도달 기록
    const n = persons.length;
    for (const r of this.list) if (r.halfDay === null && r.knownBy.size >= n / 2) r.halfDay = day - r.day;
  }

  private share(a: Person, b: Person, mult: number): void {
    for (const r of this.list) {
      const ka = r.knownBy.has(a.id);
      const kb = r.knownBy.has(b.id);
      if (ka === kb) continue;
      if (this.rng.next() < Math.min(0.9, this.s.base * mult * r.juicy)) r.knownBy.add(ka ? b.id : a.id);
    }
  }

  /** 오래된 소문은 잊힘 */
  daily(day: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) if (day - this.list[i].day > this.s.forgetDays) this.list.splice(i, 1);
  }

  /** 사람이 떠나면 */
  forget(id: number): void {
    for (const r of this.list) r.knownBy.delete(id);
  }
}
