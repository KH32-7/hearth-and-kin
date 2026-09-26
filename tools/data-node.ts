/**
 * Node(테스트/도구)용 데이터 로더: 게임과 같은 파일을 읽어 validateSimData 에 넘길 원본 묶음을 만듦.
 * 선택 파일(작업 중인 콘텐츠)은 없으면 빼고 넘김.
 */
import { existsSync, readFileSync } from 'node:fs';
import { validateSimData, type SimData } from '../src/sim/data/simData';

const j = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));
const opt = (p: string): unknown => (existsSync(p) ? j(p) : undefined);

export function simRaw(opts: { lot?: string; objects?: string; inner?: boolean; town?: string } = {}) {
  const inner = opts.inner === false
    ? undefined
    : {
        emotions: j('src/data/emotions.json'),
        traits: j('src/data/traits.json'),
        virtues: j('src/data/virtues.json'),
        stress: j('src/data/stress.json'),
        moodlets: { moodlets: { ...((opt('src/data/moodlets.json') as { moodlets?: object } | undefined)?.moodlets ?? {}), ...((opt('src/data/moodlets_m3.json') as { moodlets?: object } | undefined)?.moodlets ?? {}), ...((opt('src/data/moodlets_m5.json') as { moodlets?: object } | undefined)?.moodlets ?? {}) } },
        thoughts: opt('src/data/thoughts.json'),
        wishes: opt('src/data/wishes.json'),
        aspirations: opt('src/data/aspirations.json'),
        rewards: opt('src/data/rewards.json'),
        likes: opt('src/data/likes.json'),
      };
  return {
    needs: j('src/data/needs.json'),
    balance: j('src/data/balance.json'),
    // M6: 공공 장소 물건/상호작용 추가 파일 (있으면 합침)
    interactions: { interactions: { ...(j('src/data/interactions.json') as { interactions: object }).interactions, ...((opt('src/data/interactions_town.json') as { interactions?: object } | undefined)?.interactions ?? {}) } },
    objects: { ...(j(opts.objects ?? 'src/data/objects.json') as object), ...((opts.objects ? {} : (opt('src/data/objects_town.json') as object | undefined)) ?? {}) },
    lot: j(opts.lot ?? 'src/data/lots/cottage.json'),
    social: j('src/data/social.json'),
    relations: opts.inner === false ? undefined : opt('src/data/relations.json'),
    neighbors: opt('src/data/neighbors.json'),
    economy: opts.inner === false ? undefined : opt('src/data/economy.json'),
    items: opt('src/data/items.json'),
    skills: opt('src/data/skills.json'),
    careers: opt('src/data/careers.json'),
    recipes: opt('src/data/recipes.json'),
    crops: opt('src/data/crops.json'),
    build: opt('src/data/build.json'),
    story: opt('src/data/story.json'),
    // M6 마을: --town ashford → 지도, 사람, 일과표
    town: opts.town ? j(`src/data/town/${opts.town}.json`) : undefined,
    people: opts.town ? opt('src/data/town/people.json') : undefined,
    schedules: opts.town ? opt('src/data/schedules.json') : undefined,
    catalog: opt('src/data/catalog.json'),
    inner,
  };
}

export function loadSimData(opts: { lot?: string; objects?: string; inner?: boolean; town?: string } = {}): SimData {
  return validateSimData(simRaw(opts) as never);
}
