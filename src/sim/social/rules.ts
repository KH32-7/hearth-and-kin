/**
 * 사회 상호작용 규칙 (GDD 14-3): 요구조건 판정, 성공 확률 계산, 대화 주제.
 * 순수 함수 (sim 상태를 바꾸지 않음) → 유닛 테스트와 메뉴 표시가 같은 판정을 씀
 */
import type { Availability } from '../action/interactions';
import type { RelationsData, SocialDef } from '../data/schema';
import { EMOTION_INDEX, EMOTION_IDS, POSITIVE } from '../inner/emotion';
import type { Person } from '../people/person';
import { ESTATE_RANK, Relations, successChance, type RelationRules } from './relations';

export const DEFAULT_RELATIONS: RelationsData = {
  decayPerDay: { friendship: 1, romance: 1.5, scale: 'lifespan' },
  familyFriendshipDecayMult: 0.5,
  romanticDecayMult: 0.5,
  names: { enemy: -60, rival: -30, friend: 30, bestFriend: 70, bestFriendMemories: 5, loverRomance: 50 },
  firstImpression: { friendship: [-20, 20], respect: [-30, 30], estateRespectPerStep: 6, hygienePenaltyBelow: 30, hygienePenalty: 6, traitPairs: [] },
  success: { moodPositiveBonus: 8, moodNegativeMalus: -10, angryMeanBonus: 10, estateStepMod: 3, sharedTopicBonus: 5, rudePunishChance: 0.35 },
  multitask: { radius: 3, socialPerMinute: 0.5, friendshipPerHour: 2, chatMoodletChancePerHour: 0.3, tags: ['eat_good', 'eat_plain', 'rest', 'drink', 'craft'] },
  familyMeal: { moodlet: 'family_meal', minPeople: 2, radius: 3 },
  engine: { sleptBadlyBelow: 45, floorBeds: ['bedroll', 'straw_pallet'], ateAloneChance: 0.3, stockLow: { default: 1 }, smokeRoomMaxCells: 16, smokeMinutes: 120 },
  visit: { arriveAfterMinutes: [20, 60], stayMinutes: [150, 240], allowInteractions: ['hearth.warm_up', 'seat.sit', 'chamber_pot.use', 'outhouse.use', 'window.chat'], leaveIfNeedBelow: 15 },
};

export function relationRules(d: RelationsData): RelationRules {
  return {
    decayPerDay: { friendship: d.decayPerDay.friendship, romance: d.decayPerDay.romance },
    familyFriendshipDecayMult: d.familyFriendshipDecayMult,
    romanticDecayMult: d.romanticDecayMult,
    names: d.names,
    firstImpression: d.firstImpression,
  };
}

const PARTNER_FLAGS = ['lover', 'engaged', 'spouse'];

/** 로맨스를 다루는가: 로맨스 분류이거나 성공하면 로맨스가 오름 (유혹하기 등). 포옹(태그만), 따귀(로맨스 감소)는 아님 */
export function isRomantic(def: SocialDef): boolean {
  return def.category === 'romance' || def.success.romance > 0;
}

export function isAdult(p: Person): boolean {
  return p.stage === 'adult' || p.stage === 'elder';
}

export function rank(p: Person): number {
  return ESTATE_RANK[p.estate] ?? 1;
}

function emo(p: Person): string | null {
  return p.emotionStage >= 1 ? EMOTION_IDS[p.emotion] : null;
}

/** 상호작용 요구조건 (메뉴 회색 표시 + 자율 후보 거르기) */
export function checkSocialRequires(rel: Relations, p: Person, t: Person, def: SocialDef, stock: Record<string, number>): Availability {
  const q = def.requires;
  const r = rel.get(p.id, t.id);
  const met = !!r?.met;
  const no = (reasonKey: string, reasonArgs?: Record<string, string | number>): Availability => ({ ok: false, reasonKey, reasonArgs });
  // 로맨스: 17세 이용가 원칙. 성인끼리만, 가족(같은 가구) 사이에는 연인/배우자일 때만.
  // 분류와 상관없이 로맨스 태그가 있거나 로맨스를 올리는 것 전부 (유혹하기 등 특수 분류 포함)
  if (isRomantic(def)) {
    if (!isAdult(p) || !isAdult(t)) return no('reason.not_adult');
    if (p.household === t.household && !PARTNER_FLAGS.some((f) => r?.flags.has(f))) return no('reason.family');
  }
  if (q.adult && (!isAdult(p) || !isAdult(t))) return no('reason.not_adult');
  if (q.met === true && !met) return no('reason.not_met');
  if (q.met === false && met) return no('reason.already_met');
  const name = rel.name(p.id, t.id);
  if (q.relAny && !q.relAny.includes(name)) return no('reason.relation', { rel: `rel.${q.relAny[0]}` });
  if (q.relNone && q.relNone.includes(name)) return no('reason.relation_not', { rel: `rel.${name}` });
  const f = r?.friendship ?? 0;
  const ro = r?.romance ?? 0;
  if (q.friendshipGte !== undefined && f < q.friendshipGte) return no('reason.friendship_low', { n: q.friendshipGte });
  if (q.friendshipLte !== undefined && f > q.friendshipLte) return no('reason.friendship_high', { n: q.friendshipLte });
  if (q.romanceGte !== undefined && ro < q.romanceGte) return no('reason.romance_low', { n: q.romanceGte });
  if (q.romanceLte !== undefined && ro > q.romanceLte) return no('reason.romance_high', { n: q.romanceLte });
  if (q.respectGte !== undefined && rel.respect(t.id, p.id) < q.respectGte) return no('reason.respect_low', { n: q.respectGte });
  if (q.actorEmotionAny && !q.actorEmotionAny.includes(emo(p) ?? 'neutral')) return no('reason.actor_mood');
  if (q.targetEmotionAny && !q.targetEmotionAny.includes(emo(t) ?? 'neutral')) return no('reason.target_mood');
  if (q.actorTraitsAny && !q.actorTraitsAny.some((x) => p.traits.includes(x))) return no('reason.trait');
  if (q.targetTraitsAny && !q.targetTraitsAny.some((x) => t.traits.includes(x))) return no('reason.trait');
  if (q.actorMoodletAny && !p.moodlets.some((m) => q.actorMoodletAny!.includes(m.id))) return no('reason.actor_mood');
  if (q.targetMoodletAny && !t.moodlets.some((m) => q.targetMoodletAny!.includes(m.id))) return no('reason.target_mood');
  if (q.actorVirtueAny && !(p.virtue && q.actorVirtueAny.includes(p.virtue))) return no('reason.virtue');
  if (q.actorSinAny && !(p.sin && q.actorSinAny.includes(p.sin))) return no('reason.sin');
  if (q.actorEstateAny && !q.actorEstateAny.includes(p.estate)) return no('reason.estate');
  if (q.targetEstateAny && !q.targetEstateAny.includes(t.estate)) return no('reason.estate');
  if (q.actorEstateAbove && !(rank(p) > rank(t))) return no('reason.estate_above');
  if (q.actorEstateBelow && !(rank(p) < rank(t))) return no('reason.estate_below');
  if (q.household === true && p.household !== t.household) return no('reason.household');
  if (q.household === false && p.household === t.household) return no('reason.not_household');
  if (q.stock) {
    // 살림을 쓰는 상호작용은 조작 가문 식구만 (손님은 남의 집 재고를 쓰지 않음)
    if (p.household !== 1) return no('reason.household');
    for (const [k, n] of Object.entries(q.stock)) if ((stock[k] ?? 0) < n) return no('reason.no_stock', { item: `item.${k}` });
  }
  return { ok: true };
}

/** 관심 주제: 특성 → 주제 (relations.json traitTopics) + 이웃 데이터의 topics */
export function interestsOf(p: Person, traitTopics: Record<string, string[]>): string[] {
  const out = new Set<string>(p.topics);
  for (const tr of p.traits) for (const tp of traitTopics[tr] ?? []) out.add(tp);
  return [...out];
}

export interface ChanceParts {
  chance: number;
  sharedTopic: boolean;
}

/** 성공 확률 (14-3): 기본 + 관계 + 화술 + 감정(양쪽) + 특성(양쪽) + 신분 차이 + 분위기 */
export function socialChance(d: RelationsData, rel: Relations, p: Person, t: Person, def: SocialDef, topic: string | null, interests: (x: Person) => string[], moodMod: number): ChanceParts {
  const s = d.success;
  let emotionMod = 0;
  for (const who of [p, t]) {
    const e = emo(who);
    if (!e) continue;
    if (who === p && e === 'angry' && def.category === 'mean') emotionMod += s.angryMeanBonus;
    else if (POSITIVE[EMOTION_INDEX[e as keyof typeof EMOTION_INDEX]]) emotionMod += s.moodPositiveBonus / (who === p ? 1 : 2);
    else emotionMod += s.moodNegativeMalus / (who === p ? 1 : 2);
  }
  let traitMod = 0;
  for (const tr of p.traits) traitMod += def.traitMods[tr] ?? 0;
  for (const tr of t.traits) traitMod += def.targetTraitMods[tr] ?? 0;
  // 신분 차이: 높은 사람이 거는 말은 낮은 사람이 잘 받아 줌. 로맨스는 차이가 클수록 어려움
  const diff = rank(p) - rank(t);
  const estateMod = def.category === 'romance' ? -Math.abs(diff) * s.estateStepMod : diff * s.estateStepMod;
  const shared = !!topic && interests(p).includes(topic) && interests(t).includes(topic);
  const chance = successChance({
    base: def.base,
    friendship: rel.friendship(p.id, t.id),
    romance: rel.romance(p.id, t.id),
    respectTargetToActor: rel.respect(t.id, p.id),
    romanceCategory: def.category === 'romance',
    storytelling: p.skills.storytelling ?? 0,
    emotionMod,
    traitMod,
    estateMod,
    moodMod: moodMod + (shared ? s.sharedTopicBonus : 0),
  });
  return { chance, sharedTopic: shared };
}
