/**
 * M6 마을 사람과 일과표 (GDD 18-2, 18-1 일과표, 16-2 신분, 17-2 직업/역할, 29-2 생애 단계).
 *   npx tsx tools/world/make-people.ts
 * 결과:
 *   src/data/town/people.json        가문 33개, 약 120명, 가문 사이 관계(ties)
 *   src/data/schedules.json          일과표 템플릿 (직업 16 + 역할 10 + 마을 직책 + 단계/신분)
 *   src/i18n/ko/people_town.json     가문 이름, 이야기 훅, 직책/관계 표시/일과 행동 이름
 *   artifacts/qa/m6/people-summary.txt  사람이 읽는 요약 + 검사 결과
 * 이야기 가문 12개(+ 훅을 받쳐 주는 가문 3개 + 조작 가문)는 손으로 쓰고, 나머지는 시드 RNG 로 생성.
 * 분포(신분/나이) 검사를 통과하는 첫 하위 시드를 고름 → 같은 시드면 항상 같은 결과.
 * news.json 은 손으로 쓴 파일이고 여기서는 검사만 함.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Rng } from '../../src/sim/core/rng';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
process.chdir(ROOT);

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));
const careersJson = readJson('src/data/careers.json');
const traitsJson = readJson('src/data/traits.json');
const virtuesJson = readJson('src/data/virtues.json');
const neighborsJson = readJson('src/data/neighbors.json');
const startJson = readJson('src/data/start.json');

const BASE_SEED = 20261006;

// ───────────────────────── 생애 단계 (29-2, 10장 표시 나이) ─────────────────────────
type Stage = 'baby' | 'toddler' | 'child' | 'teen' | 'young' | 'adult' | 'elder';
const STAGES: Stage[] = ['baby', 'toddler', 'child', 'teen', 'young', 'adult', 'elder'];
const STAGE_LEN: Record<Stage, number> = { baby: 3, toddler: 7, child: 13, teen: 13, young: 24, adult: 24, elder: 20 };
const STAGE_START: Record<Stage, number> = { baby: 0, toddler: 3, child: 10, teen: 23, young: 36, adult: 60, elder: 84 };
const STAGE_YEARS: Record<Stage, [number, number]> = { baby: [0, 1], toddler: [1, 4], child: [4, 12], teen: [12, 18], young: [18, 30], adult: [30, 55], elder: [55, 55] };
/** 시작 인구의 노년 경과일 상한 (노환 위험 h(n)=0.01e^{0.1n} 이 너무 크지 않게) */
const ELDER_MAX_START = 16;
/** 부모와 자식 나이 차 최소 (= 청년 단계 시작 나이, 18세) */
const MIN_PARENT_GAP = 36;
/** 어머니가 아이를 낳을 때 최대 나이 (장년 14.4일째 ≈ 45세) */
const MAX_MOTHER_AGE = 74;

const absAge = (s: Stage, d: number) => STAGE_START[s] + d;
function fromAbs(a: number): { stage: Stage; ageDays: number } {
  let st: Stage = 'baby';
  for (const s of STAGES) if (a >= STAGE_START[s]) st = s;
  return { stage: st, ageDays: a - STAGE_START[st] };
}
function displayAge(s: Stage, d: number): number {
  if (s === 'elder') return Math.floor(55 + d * 0.6);
  const [y0, y1] = STAGE_YEARS[s];
  return Math.floor(y0 + (d / STAGE_LEN[s]) * (y1 - y0));
}
const isKid = (s: Stage) => s === 'baby' || s === 'toddler' || s === 'child' || s === 'teen';
const isGrown = (s: Stage) => s === 'young' || s === 'adult' || s === 'elder';

// ───────────────────────── 자료 ─────────────────────────
const TRAIT_IDS = Object.keys(traitsJson.traits);
const CONFLICTS: [string, string][] = traitsJson.conflicts;
const CROSS: [string, string][] = traitsJson.crossConflicts; // [trait, virtue]
const VIRTUES = Object.keys(virtuesJson.virtues);
const SINS = Object.keys(virtuesJson.sins);
const CAREERS: Record<string, any> = careersJson.careers;
const NPC_ROLES: Record<string, any> = careersJson.npcRoles;
const NEIGHBORS: Record<string, any> = Object.fromEntries(neighborsJson.neighbors.map((n: any) => [n.id, n]));
const TOPICS = ['weather', 'family', 'work', 'gossip', 'war', 'plague', 'faith', 'food', 'love'];
const TEMPERAMENTS = ['easy', 'fussy', 'smiley', 'timid']; // 12-1 기질 4 (순함, 까다로움, 잘 웃음, 겁 많음)

/** 마을 직책 (careers.json 에 없는 역할). 역할 10종(npcRoles)과 함께 people.role 에 쓰임 */
const TOWN_ROLES: Record<string, { name: string; place: string; career: string | null; estates: string[] }> = {
  lord: { name: '영주', place: 'castle', career: null, estates: ['noble'] },
  reeve: { name: '감독관(리브)', place: 'lord_fields', career: 'field_hand', estates: ['serf', 'freeman'] },
  miller: { name: '방앗간지기', place: 'mill', career: 'mill_hand', estates: ['freeman'] },
  abbot: { name: '수도원장', place: 'monastery', career: 'monk', estates: ['clergy'] },
  guild_master: { name: '길드장', place: 'guild_hall', career: null, estates: ['artisan'] },
};
const ALL_ROLES = new Set([...Object.keys(NPC_ROLES), ...Object.keys(TOWN_ROLES)]);

/** 일과표 at 에 쓰는 장소/구역 id (ashford.json places + zones). work 는 템플릿 workAt 으로 풀림 */
const PLACES = ['home', 'work', 'market', 'church', 'inn', 'castle', 'guild_hall', 'mill', 'craft_street', 'bathhouse', 'well_square', 'monastery', 'forest_river', 'tourney_ground', 'lord_fields'];

// ───────────────────────── 사람 모델 ─────────────────────────
interface Member {
  key: string;
  id?: string;
  name: string;
  sex: 'male' | 'female';
  stage: Stage;
  ageDays: number;
  traits: string[];
  temperament?: string;
  career: string | null;
  role: string | null;
  subrole?: string;
  employer?: string;
  virtue: string | null;
  sin: string | null;
  seed: number;
  topics?: string[];
  estate?: string;
  lodger?: boolean;
  schedule?: string;
}
interface Rel { kind: 'spouse' | 'betrothed' | 'parent' | 'sibling'; a: string; b: string; friendship: number; romance: number; flags?: string[] }
interface Household {
  id: string;
  name: string; // 한국어 가문 이름 (i18n 으로 감)
  estate: string;
  wealth: 'poor' | 'normal' | 'rich';
  lotSize: 'small' | 'medium' | 'large' | 'manor';
  lot: string | null;
  residence?: string;
  player?: boolean;
  hook: string | null;
  members: Member[];
  relations: Rel[];
  story: boolean;
}
interface Tie { a: string; b: string; friendship: number; romance: number; flags: string[] }

// 손으로 쓰는 인물: [key, 이름, 성별, 단계, 경과일, 특성, 옵션]
type Opt = Partial<Pick<Member, 'career' | 'role' | 'subrole' | 'employer' | 'virtue' | 'sin' | 'estate' | 'lodger' | 'temperament'>>;
function H(key: string, name: string, sex: 'm' | 'f', stage: Stage, d: number, traits: string[], o: Opt = {}): Member {
  return {
    key, name, sex: sex === 'm' ? 'male' : 'female', stage, ageDays: d, traits,
    career: o.career ?? null, role: o.role ?? null, subrole: o.subrole, employer: o.employer,
    virtue: o.virtue ?? null, sin: o.sin ?? null, seed: 0, estate: o.estate, lodger: o.lodger, temperament: o.temperament,
  };
}
/** 이웃(neighbors.json) 인물: 이름/성별/특성/덕/죄/시드/주제는 그대로, 단계만 새 7단계로 */
function NB(nbId: string, stage: Stage, d: number, o: Opt = {}): Member {
  const n = NEIGHBORS[nbId];
  if (!n) throw new Error(`이웃 없음 ${nbId}`);
  return {
    key: nbId, id: nbId, name: n.name, sex: n.sex, stage, ageDays: d, traits: [...n.traits],
    career: o.career ?? null, role: o.role ?? null, subrole: o.subrole, employer: o.employer,
    virtue: n.virtue ?? null, sin: n.sin ?? null, seed: n.seed, topics: n.topics ? [...n.topics] : undefined,
  };
}
type R = [Rel['kind'], string, string, number, number, string[]?];
function rels(list: R[]): Rel[] {
  return list.map(([kind, a, b, friendship, romance, flags]) => ({ kind, a, b, friendship, romance, ...(flags ? { flags } : {}) }));
}
function kidsOf(parents: string[], kids: string[], fr = 65): R[] {
  const out: R[] = [];
  for (const p of parents) for (const k of kids) out.push(['parent', p, k, fr, 0]);
  for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) out.push(['sibling', kids[i], kids[j], 45, 0]);
  return out;
}

// ───────────────────────── 이야기 가문 12 + 받침 가문 3 + 조작 가문 ─────────────────────────
const HOOKS: Record<string, { title: string; text: string }> = {
  lord_heirs: {
    title: '노영주의 두 아들',
    text: '노영주 알드웬의 기력이 다해 간다. 공정한 맏아들 레오프릭과 빚과 야심을 함께 키운 둘째 가레스 사이에서, 성의 가신들은 벌써 줄을 서기 시작했다.',
  },
  smith_brothers: {
    title: '길드장 자리를 노리는 형제',
    text: '늙은 길드장 발드릭이 망치를 내려놓을 날이 머지않았다. 꼼꼼한 형 브렌트와 불같은 아우 하랄드는 서로 자기가 아버지의 자리를 이을 사람이라 믿는다.',
  },
  inn_widow: {
    title: '여관 과부와 수상한 투숙객',
    text: '남편을 잃은 여관 주인 윈프레드는 겨울 내내 방값을 선불로 치르는 투숙객 이보에게 마음이 기운다. 이보는 밤마다 누군가를 기다리고, 성의 둘째 도련님과 은밀히 만난다.',
  },
  merchant_bastard: {
    title: '펜윅 집안 둘째 딸의 아비',
    text: '거상 레지널드는 둘째 딸 엘린의 얼굴에서 경비병 로완의 눈매를 본다. 로저먼드는 아무 말도 하지 않고, 우물가 사람들은 그 침묵을 대신 채운다.',
  },
  serf_freedom: {
    title: '해방금 여덟 은화',
    text: '오스릭과 힐다는 아이 다섯과 늙은 어머니를 먹이면서도 해방금 여덟 은화를 한 푼씩 모은다. 그런데 모은 돈보다 대금업자 고드윈에게 진 빚이 먼저 불어난다.',
  },
  priest_lover: {
    title: '사제의 비밀',
    text: '교구 사제 베른하르트는 고해실 너머로 과부 이디스의 목소리를 기다린다. 들키면 사제복도, 이디스의 이름도 온전하지 못할 것이다.',
  },
  miller_scales: {
    title: '방앗간지기의 저울',
    text: '방앗간지기 오도의 저울이 늘 조금 가볍다는 말이 돈다. 곡식을 떼였다고 믿는 오스릭은 그를 벼르고, 오도의 딸 잉가는 하필 대장장이 하랄드와 눈이 맞았다.',
  },
  knight_oath: {
    title: '가신 기사의 맹세',
    text: '기사 제라르는 노영주에게 충성을 맹세했다. 그러나 둘째 도련님 가레스가 자기 편에 서면 큰 영지를 주겠다고 속삭이고, 제라르의 야심은 그 말을 흘려듣지 못한다.',
  },
  tailor_forbidden_love: {
    title: '신분을 넘은 연인',
    text: '재단사 메이블의 아들 에드가는 농노 모드의 딸이자 펜윅 집 하녀인 브린을 사랑한다. 메이블은 농노 며느리를 들일 바에야 아들을 길드에서 내쫓겠다고 한다.',
  },
  moneylender_ledger: {
    title: '고드윈의 장부',
    text: '대금업자 고드윈의 장부에는 마을 절반의 이름이 적혀 있다. 해방금을 모으는 오스릭도, 주사위에 빠진 둘째 도련님 가레스도 그 안에 있다.',
  },
  herbalist_whispers: {
    title: '숲가의 산파 모녀',
    text: '산파 헤스터와 약초꾼 딸 모이라에게 마녀라는 수군거림이 따라다닌다. 아비 없는 아이 핀이 태어난 뒤로 험담꾼 아그네스가 우물가에서 그 말을 부풀린다.',
  },
  monastery_foundling: {
    title: '수도원 문간의 아이',
    text: '여덟 해 전 잿빛 수도원 문간에 버려진 아이 울릭. 원장 안셀름만이 아이와 함께 온 문장 새긴 반지가 누구의 것인지 안다.',
  },
};

const handHouseholds: Household[] = [];
function HH(h: Omit<Household, 'lot' | 'story' | 'relations'> & { relations: R[]; lot?: string | null }): void {
  handHouseholds.push({ ...h, lot: h.lot ?? null, relations: rels(h.relations), story: !!h.hook });
}

// 조작 가문 (start.json 과 같은 2인 자유민 부부. 16-2 기본 구성 "청년 부부, 가장 표시 나이 22세 안팎")
{
  const [m1, m2] = startJson.members;
  const r = startJson.relations[0];
  HH({
    id: 'h_player', name: '헤이우드', estate: startJson.estate, wealth: 'normal', lotSize: 'small', player: true, hook: null,
    members: [
      H('player_1', m1.name, m1.sex === 'male' ? 'm' : 'f', 'young', 8, [], {}),
      H('player_2', m2.name, m2.sex === 'male' ? 'm' : 'f', 'young', 6, [], {}),
    ],
    relations: [['spouse', 'player_1', 'player_2', r.friendship, r.romance]],
  });
}

HH({
  id: 'h_ashford', name: '애쉬포드', estate: 'noble', wealth: 'rich', lotSize: 'manor', residence: 'castle', hook: 'lord_heirs',
  members: [
    H('aldwen', '알드웬', 'm', 'elder', 12, ['ambitious', 'suspicious', 'hot_tempered'], { role: 'lord', sin: 'pride' }),
    H('leofric', '레오프릭', 'm', 'young', 20, ['just', 'calm', 'diligent'], { career: 'knight', virtue: 'patience' }),
    H('gareth', '가레스', 'm', 'young', 8, ['cunning', 'ambitious', 'drinker'], { career: 'knight', sin: 'envy' }),
    H('isolde', '이솔데', 'f', 'young', 18, ['kind', 'romantic', 'neat'], { virtue: 'charity' }),
    H('rowena', '로웨나', 'f', 'child', 3, ['cheerful']),
  ],
  relations: [
    ['parent', 'aldwen', 'leofric', 35, 0], ['parent', 'aldwen', 'gareth', 60, 0],
    ['sibling', 'leofric', 'gareth', -35, 0, ['rival']],
    ['spouse', 'leofric', 'isolde', 50, 45],
    ...kidsOf(['leofric', 'isolde'], ['rowena'], 75),
  ],
});

HH({
  id: 'h_blackthorn', name: '블랙손', estate: 'artisan', wealth: 'normal', lotSize: 'medium', hook: 'smith_brothers',
  members: [
    NB('nb_baldric', 'elder', 10, { career: 'blacksmith', role: 'guild_master' }),
    H('brent', '브렌트', 'm', 'young', 22, ['ambitious', 'diligent', 'neat'], { career: 'blacksmith', sin: 'pride' }),
    H('eda', '에다', 'f', 'young', 20, ['family_oriented', 'calm', 'gourmet'], { virtue: 'temperance' }),
    H('harald', '하랄드', 'm', 'young', 10, ['hot_tempered', 'active', 'flirt'], { career: 'blacksmith', sin: 'wrath' }),
    H('will', '윌', 'm', 'child', 8, ['active']),
    H('nell', '넬', 'f', 'toddler', 4, [], { temperament: 'smiley' }),
  ],
  relations: [
    ['parent', 'nb_baldric', 'brent', 45, 0], ['parent', 'nb_baldric', 'harald', 50, 0],
    ['sibling', 'brent', 'harald', -35, 0, ['rival']],
    ['spouse', 'brent', 'eda', 55, 50],
    ...kidsOf(['brent', 'eda'], ['will', 'nell'], 70),
  ],
});

HH({
  id: 'h_haswell', name: '해스웰', estate: 'freeman', wealth: 'normal', lotSize: 'large', residence: 'inn', hook: 'inn_widow',
  members: [
    H('winifred', '윈프레드', 'f', 'adult', 8, ['sociable', 'cunning', 'diligent'], { career: 'innkeeper', virtue: 'diligence', sin: 'greed' }),
    H('rose', '로즈', 'f', 'teen', 9, ['romantic', 'cheerful'], { career: 'innkeeper' }),
    H('tobin', '토빈', 'm', 'child', 5, ['active']),
    H('ivo', '이보', 'm', 'young', 14, ['cunning', 'brave', 'introvert'], { lodger: true, sin: 'pride' }),
  ],
  relations: [...kidsOf(['winifred'], ['rose', 'tobin'], 65)],
});

HH({
  id: 'h_fenwick', name: '펜윅', estate: 'merchant', wealth: 'rich', lotSize: 'large', hook: 'merchant_bastard',
  members: [
    H('reginald', '레지널드', 'm', 'adult', 16, ['suspicious', 'ambitious', 'neat'], { career: 'trader', sin: 'greed' }),
    NB('nb_rosamund', 'adult', 12),
    H('percival', '퍼시벌', 'm', 'teen', 10, ['bookworm', 'calm']),
    H('elin', '엘린', 'f', 'child', 9, ['creative']),
    H('margery', '마저리', 'f', 'toddler', 3, [], { temperament: 'timid' }),
  ],
  relations: [
    ['spouse', 'reginald', 'nb_rosamund', 20, 15],
    ['parent', 'reginald', 'percival', 60, 0], ['parent', 'reginald', 'elin', 15, 0, ['doubts_paternity']], ['parent', 'reginald', 'margery', 60, 0],
    ...kidsOf(['nb_rosamund'], ['percival', 'elin', 'margery'], 70),
  ],
});

HH({
  id: 'h_osric', name: '오스릭네', estate: 'serf', wealth: 'poor', lotSize: 'small', hook: 'serf_freedom',
  members: [
    NB('nb_agnes', 'elder', 12),
    NB('nb_osric', 'adult', 0, { career: 'field_hand' }),
    NB('nb_hilda', 'adult', 2, { career: 'field_hand' }),
    H('gunhild', '군힐드', 'f', 'teen', 1, ['diligent', 'family_oriented']),
    H('wulfric', '울프릭', 'm', 'child', 10, ['brave']),
    H('alvin', '앨빈', 'm', 'child', 3, ['cheerful']),
    H('dagny', '다그니', 'f', 'toddler', 4, [], { temperament: 'fussy' }),
    H('tora', '토라', 'f', 'baby', 1, [], { temperament: 'easy' }),
  ],
  relations: [
    ['parent', 'nb_agnes', 'nb_osric', 50, 0],
    ['spouse', 'nb_osric', 'nb_hilda', 55, 40],
    ...kidsOf(['nb_osric', 'nb_hilda'], ['gunhild', 'wulfric', 'alvin', 'dagny', 'tora'], 60),
  ],
});

HH({
  id: 'h_parish', name: '교구 사제관', estate: 'clergy', wealth: 'normal', lotSize: 'small', residence: 'church', hook: 'priest_lover',
  members: [H('bernhard', '베른하르트', 'm', 'adult', 8, ['romantic', 'kind', 'bookworm'], { career: 'priest', virtue: 'charity', sin: 'lust' })],
  relations: [],
});

HH({
  id: 'h_millbrook', name: '밀브룩', estate: 'freeman', wealth: 'normal', lotSize: 'medium', residence: 'mill', hook: 'miller_scales',
  members: [
    H('odo', '오도', 'm', 'adult', 18, ['cunning', 'mean', 'diligent'], { career: 'mill_hand', role: 'miller', sin: 'greed' }),
    H('sybil', '시빌', 'f', 'adult', 14, ['gossip', 'neat', 'cynical'], { sin: 'envy' }),
    H('edwin', '에드윈', 'm', 'young', 2, ['calm', 'kind', 'humble'], { career: 'mill_hand', virtue: 'humility' }),
    H('inga', '잉가', 'f', 'teen', 6, ['romantic', 'cheerful']),
  ],
  relations: [['spouse', 'odo', 'sybil', 35, 25], ...kidsOf(['odo', 'sybil'], ['edwin', 'inga'], 55)],
});

HH({
  id: 'h_montbray', name: '몽브레', estate: 'knight', wealth: 'normal', lotSize: 'large', hook: 'knight_oath',
  members: [
    NB('nb_gerard', 'adult', 10, { career: 'knight' }),
    H('eleanor', '엘레노어', 'f', 'adult', 6, ['neat', 'calm', 'family_oriented'], { virtue: 'humility' }),
    H('hugo', '휴고', 'm', 'teen', 6, ['brave', 'active'], { career: 'knight' }),
    H('cecily', '세실리', 'f', 'child', 6, ['romantic']),
    H('odette', '오데트', 'f', 'toddler', 2, [], { temperament: 'smiley' }),
  ],
  relations: [['spouse', 'nb_gerard', 'eleanor', 50, 35], ...kidsOf(['nb_gerard', 'eleanor'], ['hugo', 'cecily', 'odette'], 65)],
});

HH({
  id: 'h_weyland', name: '웨이랜드', estate: 'artisan', wealth: 'normal', lotSize: 'medium', hook: 'tailor_forbidden_love',
  members: [
    NB('nb_mabel', 'adult', 16, { career: 'tailor' }),
    H('alaric', '앨라릭', 'm', 'adult', 20, ['handy', 'calm', 'humble'], { career: 'carpenter', virtue: 'patience' }),
    H('edgar', '에드가', 'm', 'young', 4, ['romantic', 'creative', 'brave'], { career: 'tailor', virtue: 'kindness' }),
    H('tilda', '틸다', 'f', 'child', 11, ['neat']),
  ],
  relations: [
    ['spouse', 'nb_mabel', 'alaric', 45, 30],
    ['parent', 'nb_mabel', 'edgar', 35, 0, ['disapproves']], ['parent', 'alaric', 'edgar', 60, 0],
    ['parent', 'nb_mabel', 'tilda', 65, 0], ['parent', 'alaric', 'tilda', 70, 0], ['sibling', 'edgar', 'tilda', 55, 0],
  ],
});

HH({
  id: 'h_maud', name: '모드네', estate: 'serf', wealth: 'poor', lotSize: 'small', hook: null,
  members: [
    NB('nb_maud', 'adult', 20, { career: 'field_hand' }),
    H('bryn', '브린', 'f', 'young', 6, ['kind', 'humble', 'romantic'], { role: 'servant', subrole: 'maid', employer: 'h_fenwick', virtue: 'kindness' }),
    H('corwin', '코윈', 'm', 'teen', 8, ['hot_tempered', 'active'], { career: 'field_hand' }),
  ],
  relations: kidsOf(['nb_maud'], ['bryn', 'corwin'], 55),
});

HH({
  id: 'h_tolbert', name: '톨버트', estate: 'freeman', wealth: 'rich', lotSize: 'medium', hook: 'moneylender_ledger',
  members: [
    NB('nb_godwin', 'adult', 6, { role: 'moneylender' }),
    H('ethel', '에설', 'f', 'adult', 0, ['cheerful', 'sociable', 'diligent'], { career: 'brewer', virtue: 'charity' }),
    H('evander', '에반더', 'm', 'child', 12, ['cunning']),
  ],
  relations: [['spouse', 'nb_godwin', 'ethel', 40, 30], ...kidsOf(['nb_godwin', 'ethel'], ['evander'], 60)],
});

HH({
  id: 'h_hester', name: '헤스터네', estate: 'serf', wealth: 'poor', lotSize: 'small', hook: 'herbalist_whispers',
  members: [
    H('hester', '헤스터', 'f', 'elder', 4, ['calm', 'nature_lover', 'suspicious'], { role: 'midwife', virtue: 'charity' }),
    H('moira', '모이라', 'f', 'young', 16, ['introvert', 'nature_lover', 'creative'], { role: 'herbalist', virtue: 'kindness' }),
    H('finn', '핀', 'm', 'toddler', 2, [], { temperament: 'timid' }),
  ],
  relations: [['parent', 'hester', 'moira', 60, 0], ['parent', 'moira', 'finn', 80, 0]],
});

HH({
  id: 'h_monastery', name: '잿빛 수도원', estate: 'clergy', wealth: 'normal', lotSize: 'large', residence: 'monastery', hook: 'monastery_foundling',
  members: [
    NB('nb_anselm', 'elder', 6, { career: 'monk', role: 'abbot' }),
    H('kenelm', '케넬름', 'm', 'adult', 12, ['bookworm', 'neat', 'introvert'], { career: 'monk', virtue: 'humility' }),
    H('quentin', '퀜틴', 'm', 'young', 3, ['diligent', 'sociable', 'humble'], { career: 'monk', virtue: 'chastity' }),
    H('ulric', '울릭', 'm', 'child', 8, ['bookworm'], { estate: 'serf' }),
  ],
  relations: [],
});

HH({
  id: 'h_selwyn', name: '셀윈', estate: 'freeman', wealth: 'poor', lotSize: 'small', hook: null,
  members: [
    NB('nb_edith', 'adult', 4, { career: 'tailor' }),
    H('willa', '윌라', 'f', 'child', 5, ['creative']),
  ],
  relations: [['parent', 'nb_edith', 'willa', 75, 0]],
});

HH({
  id: 'h_brightwater', name: '브라이트워터', estate: 'freeman', wealth: 'normal', lotSize: 'small', hook: null,
  members: [
    NB('nb_rowan', 'adult', 2, { career: 'guard' }),
    H('selena', '셀레나', 'f', 'young', 18, ['diligent', 'gourmet', 'kind'], { career: 'baker', virtue: 'diligence' }),
  ],
  relations: [['sibling', 'nb_rowan', 'selena', 50, 0]],
});

const handTies: [string, string, number, number, string[]][] = [
  ['ivo', 'winifred', 20, 30, ['crush']],
  ['ivo', 'gareth', 25, 0, ['secret_dealings']],
  ['nb_rosamund', 'nb_rowan', 30, 25, ['former_lovers']],
  ['nb_rowan', 'elin', 10, 0, ['rumored_father']],
  ['reginald', 'nb_rowan', -50, 0, ['grudge']],
  ['bernhard', 'nb_edith', 55, 70, ['secret_lovers']],
  ['odo', 'nb_osric', -55, 0, ['grudge']],
  ['inga', 'harald', 30, 35, ['crush']],
  ['nb_gerard', 'aldwen', 50, 0, ['sworn']],
  ['nb_gerard', 'gareth', 35, 0, ['ally']],
  ['nb_gerard', 'leofric', -10, 0, []],
  ['edgar', 'bryn', 50, 65, ['secret_lovers']],
  ['nb_mabel', 'nb_maud', -50, 0, ['grudge']],
  ['nb_mabel', 'harald', 30, 0, ['ally']],
  ['brent', 'alaric', 40, 0, ['ally']],
  ['nb_osric', 'nb_godwin', -25, 0, ['debtor']],
  ['gareth', 'nb_godwin', -10, 0, ['debtor']],
  ['nb_agnes', 'moira', -50, 0, ['accuser']],
  ['hester', 'nb_hilda', 45, 0, []],
  ['leofric', 'ulric', 5, 0, ['secret_parent']],
  ['nb_anselm', 'ulric', 60, 0, []],
  ['nb_anselm', 'leofric', 30, 0, ['keeps_secret']],
  ['bryn', 'nb_rosamund', 20, 0, ['employer']],
  ['edwin', 'rose', 35, 20, ['betrothed']],
  ['rose', 'percival', 30, 30, ['crush']], // 방앗간과 여관이 맺은 정혼 (에드윈은 순하고, 로즈는 마음이 딴 데 있음)
];

// ───────────────────────── 이름 풀 ─────────────────────────
const MALE_NAMES = '시그문드 토르빈 베오른 코엔 고드릭 헤리워드 랄프 로저 월터 콜린 에그버트 엘프릭 브랜드 케드릭 던컨 기욤 라이너 하콘 욘 아른 스벤 토스틱 레그너 롤로 바르톨 다리안 에릭 그림 할프단 레오닌 모건 네빌 오드릭 페레그린 라일 우터 에이먼 브론 칼렌 다겐 고스윈 하델 자스퍼 켄릭 닐스 오웬 세드릭 트리스탄 바스 워릭 보든 앤슬로 히스 제프리 크누트 로드릭 테오발드 윈스턴 에버라드 올라프 길버트 험프리 램버트 마일스 오즈번 피어스 랜돌프 스티건 서스턴 토르게 알빈 마르셀 레뮈 오스카 벤틀리 이바르'.split(' ');
const FEMALE_NAMES = '엘스베스 오드리 앨리스 에멀린 이베트 아비스 베아트릭스 플로렌스 그웬 헬가 이다 레티스 마틸다 페트로넬라 사비나 테사 베라 알디스 카리스 기셀라 할라 요한나 케일라 리즈베스 니넷 오드라 필리파 라그나 시그리드 운나 베리티 웬다 벨라 코델리아 에마 그리젤다 하웨이즈 조안 클레멘스 리비아 노라 올가 프루던스 로잘린 우나 비올라 위니 앨리슨 브렌다 데이지 에일리스 아이린 이모젠 아델라 베르타 콘스턴스 하이디 욜란드 레나 미라벨 오틸리 로헤이즈 스텔라 발레리 가일라 멜리산드 이세 브리다 토베 루실'.split(' ');
const SURNAMES: [string, string][] = [
  ['h_greenleaf', '그린리프'], ['h_stonebridge', '스톤브리지'], ['h_oakfield', '오크필드'], ['h_redmond', '레드먼드'],
  ['h_fairweather', '페어웨더'], ['h_croft', '크로프트'], ['h_ambrey', '앰브리'], ['h_cooper', '쿠퍼'], ['h_fletcher', '플레처'],
  ['h_thatcher', '대처'], ['h_harlow', '할로'], ['h_marsh', '마쉬'],
];

// ───────────────────────── 절차 생성 ─────────────────────────
function pick<T>(rng: Rng, arr: readonly T[]): T { return arr[rng.int(arr.length)]; }
function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) { const j = rng.int(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function traitCount(s: Stage): number {
  const slots = traitsJson.slots;
  if (s === 'baby' || s === 'toddler') return 0;
  if (s === 'child') return slots.child;
  if (s === 'teen') return slots.teen;
  if (s === 'elder') return slots.elder;
  return slots.adult;
}
function conflicts(a: string, b: string): boolean {
  return CONFLICTS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}
/** 아동/청소년에게 주지 않는 특성 (연애/음주 성향) */
const KID_EXCLUDED_TRAITS = ['flirt', 'drinker'];
function pickTraits(rng: Rng, n: number, kid = false): string[] {
  const out: string[] = [];
  let guard = 0;
  while (out.length < n && guard++ < 200) {
    const t = pick(rng, TRAIT_IDS);
    if (kid && KID_EXCLUDED_TRAITS.includes(t)) continue;
    if (out.includes(t) || out.some((o) => conflicts(o, t))) continue;
    out.push(t);
  }
  return out;
}
function pickVirtueSin(rng: Rng, traits: string[], teen = false): { virtue: string | null; sin: string | null } {
  const r = rng.next();
  let virtue: string | null = null;
  let sin: string | null = null;
  const sins = teen ? SINS.filter((x) => x !== 'lust') : SINS;
  if (r < 0.35) virtue = pick(rng, VIRTUES);
  else if (r < 0.7) sin = pick(rng, sins);
  else if (r < 0.85) { virtue = pick(rng, VIRTUES); sin = pick(rng, sins); }
  if (virtue && sin && virtuesJson.virtues[virtue].sin === sin) sin = null;
  if (virtue && CROSS.some(([t, v]) => v === virtue && traits.includes(t))) virtue = null;
  return { virtue, sin };
}

interface GenCtx { rng: Rng; used: Set<string>; keyN: number }
function newName(ctx: GenCtx, sex: 'male' | 'female'): string {
  const pool = sex === 'male' ? MALE_NAMES : FEMALE_NAMES;
  const free = pool.filter((n) => !ctx.used.has(n));
  if (!free.length) throw new Error('이름 풀 부족');
  const n = pick(ctx.rng, free);
  ctx.used.add(n);
  return n;
}
function person(ctx: GenCtx, sex: 'male' | 'female', abs: number, estate: string): Member {
  const { stage, ageDays } = fromAbs(abs);
  const traits = pickTraits(ctx.rng, traitCount(stage), isKid(stage));
  const vs = stage === 'teen' || isGrown(stage) ? pickVirtueSin(ctx.rng, traits, stage === 'teen') : { virtue: null, sin: null };
  const m: Member = {
    key: `g${ctx.keyN++}`, name: newName(ctx, sex), sex, stage, ageDays, traits,
    career: null, role: null, virtue: vs.virtue, sin: vs.sin, seed: 0,
  };
  if (stage === 'baby' || stage === 'toddler') m.temperament = pick(ctx.rng, TEMPERAMENTS);
  void estate;
  return m;
}
const opp = (s: 'male' | 'female') => (s === 'male' ? 'female' : 'male');
const ri = (rng: Rng, a: number, b: number) => a + rng.int(b - a + 1);

type Shape = 'family' | 'family_elder' | 'widowed' | 'elder_couple' | 'elder_widow' | 'single';
interface Slot { estate: string; head: Job; spouseJobs: Job[] }
interface Job { career?: string; role?: string; subrole?: string; employer?: string }

/** 절차 가문의 가장 직업 (직업 16 + 역할 10 을 마을에 빠짐없이 배치하기 위한 목록) */
const PROC_SLOTS: Slot[] = [
  { estate: 'serf', head: { career: 'field_hand', role: 'reeve' }, spouseJobs: [{ career: 'field_hand' }] },
  { estate: 'serf', head: { career: 'field_hand' }, spouseJobs: [{ career: 'field_hand' }, {}] },
  { estate: 'serf', head: { career: 'field_hand' }, spouseJobs: [{}] },
  { estate: 'serf', head: { career: 'field_hand' }, spouseJobs: [{ role: 'servant', subrole: 'nurse', employer: 'h_montbray' }] },
  { estate: 'serf', head: { role: 'servant', subrole: 'groom', employer: 'h_ashford' }, spouseJobs: [{ role: 'servant', subrole: 'cook', employer: 'h_ashford' }] },
  { estate: 'serf', head: { role: 'messenger' }, spouseJobs: [{ career: 'field_hand' }] },
  { estate: 'serf', head: { career: 'field_hand' }, spouseJobs: [{}, { career: 'field_hand' }] },
  { estate: 'serf', head: { career: 'field_hand' }, spouseJobs: [{ career: 'field_hand' }] },
  { estate: 'freeman', head: { career: 'guard' }, spouseJobs: [{ role: 'matchmaker' }] },
  { estate: 'freeman', head: { career: 'guard' }, spouseJobs: [{ career: 'field_hand' }] },
  { estate: 'freeman', head: { career: 'clerk' }, spouseJobs: [{ role: 'tutor', employer: 'h_ashford' }] },
  { estate: 'freeman', head: { career: 'healer' }, spouseJobs: [{}] },
  { estate: 'freeman', head: { role: 'bailiff' }, spouseJobs: [{ career: 'minstrel' }] },
  { estate: 'artisan', head: { career: 'baker' }, spouseJobs: [{ career: 'brewer' }] },
  { estate: 'artisan', head: { role: 'leatherworker' }, spouseJobs: [{ career: 'tailor' }] },
  { estate: 'artisan', head: { role: 'mason' }, spouseJobs: [{}] },
  { estate: 'merchant', head: { career: 'trader' }, spouseJobs: [{ career: 'innkeeper' }, {}] },
];

function applyJob(m: Member, j: Job): void {
  if (j.career) m.career = j.career;
  if (j.role) m.role = j.role;
  if (j.subrole) m.subrole = j.subrole;
  if (j.employer) m.employer = j.employer;
}

function genHousehold(ctx: GenCtx, slot: Slot, idx: number, surnameIdx: { n: number }): Household {
  const { rng } = ctx;
  const estate = slot.estate;
  // 가장이 일을 해야 하므로 노년 가구는 가장 직업이 있을 때 피함 (단, 노부모 동거는 허용)
  const shapes: [Shape, number][] = [['family', 42], ['family_elder', 32], ['widowed', 10], ['single', 6], ['elder_couple', 10]];
  let shape = shapes[rng.weighted(shapes.map((s) => s[1]))][0];
  const members: Member[] = [];
  const R: R[] = [];
  const headSex: 'male' | 'female' = rng.next() < 0.75 ? 'male' : 'female';

  let headAbs: number;
  if (shape === 'elder_couple') headAbs = ri(rng, 44, 64); // 일하는 가장 + 노부모 둘 (아이 0~1)
  else if (shape === 'single') headAbs = ri(rng, 38, 58);
  else if (shape === 'family_elder') headAbs = ri(rng, 46, 64);
  else headAbs = ri(rng, 48, 82);

  const head = person(ctx, headSex, headAbs, estate);
  applyJob(head, slot.head);
  members.push(head);

  let spouse: Member | null = null;
  if (shape === 'family' || shape === 'family_elder' || (shape === 'elder_couple' && rng.next() < 0.5)) {
    const sAbs = Math.max(MIN_PARENT_GAP + 1, Math.min(83, headAbs + ri(rng, -10, 4)));
    spouse = person(ctx, opp(headSex), sAbs, estate);
    const j = pick(rng, slot.spouseJobs);
    applyJob(spouse, j);
    members.push(spouse);
    R.push(['spouse', head.key, spouse.key, ri(rng, 30, 70), ri(rng, 15, 65)]);
  }
  // 아이
  if (shape !== 'single') {
    const parents = spouse ? [head, spouse] : [head];
    const mother = parents.find((p) => p.sex === 'female');
    const youngest = Math.min(...parents.map((p) => absAge(p.stage, p.ageDays)));
    const maxKid = youngest - MIN_PARENT_GAP;
    const motherAbs = mother ? absAge(mother.stage, mother.ageDays) : 0;
    const minKid = mother ? Math.max(0, motherAbs - MAX_MOTHER_AGE) : 0;
    const want = shape === 'elder_couple' ? rng.int(2) : [0, 1, 2, 3][rng.weighted([30, 40, 22, 8])];
    const kidAges: number[] = [];
    // 단계 길이에 비례해 단계를 먼저 고르고(안정 인구 모양), 그 단계 안에서 부모 나이 조건에 맞는 나이를 고름
    const KID_STAGES: Stage[] = ['baby', 'toddler', 'child', 'teen', 'young'];
    const KID_W = [3, 7, 13, 13, 8];
    for (let i = 0; i < want * 6 && kidAges.length < want; i++) {
      const st = KID_STAGES[rng.weighted(KID_W)];
      const lo = Math.max(minKid, STAGE_START[st]);
      const hi = Math.min(maxKid, STAGE_START[st] + STAGE_LEN[st] - 1, 58);
      if (hi < lo) continue;
      const a = ri(rng, lo, hi);
      if (kidAges.some((k) => Math.abs(k - a) < 3)) continue;
      kidAges.push(a);
    }
    kidAges.sort((a, b) => b - a);
    const kids = kidAges.map((a) => person(ctx, rng.next() < 0.5 ? 'male' : 'female', a, estate));
    for (const k of kids) {
      // 청소년 40%, 청년 이상 자식은 직업을 가짐 (부모 직업을 잇거나 농노면 밭일)
      if (k.stage === 'teen' ? rng.next() < 0.4 : isGrown(k.stage) && rng.next() < 0.75) {
        const parentCareer = head.career && CAREERS[head.career]?.estates.includes(estate) ? head.career : null;
        const c = parentCareer ?? (estate === 'serf' || estate === 'freeman' ? 'field_hand' : null);
        if (c && CAREERS[c].type !== 'journey') k.career = c;
        else if (estate === 'merchant') k.career = 'clerk';
      }
      members.push(k);
    }
    R.push(...kidsOf(parents.map((p) => p.key), kids.map((k) => k.key), ri(rng, 45, 75)));
  }
  // 노부모 (가장의 부모)
  if (shape === 'family_elder' || shape === 'elder_couple') {
    const n = shape === 'elder_couple' ? 2 : rng.next() < 0.3 ? 2 : 1;
    const e0 = Math.max(84, headAbs + MIN_PARENT_GAP + rng.int(4));
    if (e0 <= 84 + ELDER_MAX_START) {
      const eldersList: Member[] = [];
      for (let i = 0; i < n; i++) {
        const abs = Math.min(84 + ELDER_MAX_START, e0 + rng.int(4));
        const e = person(ctx, i === 0 ? (rng.next() < 0.55 ? 'female' : 'male') : opp(eldersList[0].sex), abs, estate);
        eldersList.push(e);
        members.push(e);
        R.push(['parent', e.key, head.key, ri(rng, 35, 70), 0]);
      }
      if (eldersList.length === 2) R.push(['spouse', eldersList[0].key, eldersList[1].key, ri(rng, 40, 70), ri(rng, 10, 40)]);
    }
  }
  // 몇몇 노인은 은퇴 전 일을 계속함
  for (const m of members) if (m.stage === 'elder' && m !== head && rng.next() < 0.15 && estate === 'serf') m.career = 'field_hand';

  let id: string;
  let name: string;
  if (estate === 'serf') {
    id = `h_serf_${String(idx + 1).padStart(2, '0')}`;
    name = `${head.name}네`; // 16-1: 농노는 가문명이 없음 → "가장 이름 + 네"
  } else {
    [id, name] = SURNAMES[surnameIdx.n++];
  }
  const wealth: Household['wealth'] =
    estate === 'serf' ? (rng.next() < 0.6 ? 'poor' : 'normal') : estate === 'merchant' ? 'rich' : rng.next() < 0.2 ? 'poor' : rng.next() < 0.85 ? 'normal' : 'rich';
  const lotSize: Household['lotSize'] =
    estate === 'serf' ? 'small' : estate === 'freeman' ? (wealth === 'poor' || members.length <= 2 ? 'small' : 'medium') : estate === 'artisan' ? 'medium' : 'large';
  return { id, name, estate, wealth, lotSize, lot: null, hook: null, members, relations: rels(R), story: false };
}

// ───────────────────────── 조립 ─────────────────────────
function estateOf(m: Member, h: Household): string { return m.estate ?? h.estate; }
function spouseOf(h: Household, key: string): string | null {
  const r = h.relations.find((x) => x.kind === 'spouse' && (x.a === key || x.b === key));
  return r ? (r.a === key ? r.b : r.a) : null;
}

function scheduleFor(m: Member, h: Household): string {
  if (m.lodger) return 'lodger';
  const est = estateOf(m, h);
  if (m.stage === 'baby') return 'baby';
  if (m.stage === 'toddler') return 'toddler';
  if (m.stage === 'child') return est === 'noble' || est === 'knight' || est === 'merchant' ? 'child_tutored' : 'child';
  if (m.role) return m.role;
  if (m.career) return m.career;
  if (m.stage === 'teen') return 'teen';
  if (m.stage === 'elder') return 'elder';
  if (est === 'noble') return 'noble';
  const small = new Set(h.members.filter((x) => x.stage === 'baby' || x.stage === 'toddler' || x.stage === 'child').map((x) => x.key));
  const parentOfSmall = h.relations.some((r) => r.kind === 'parent' && r.a === m.key && small.has(r.b));
  return spouseOf(h, m.key) || parentOfSmall ? 'homemaker' : 'unemployed';
}

interface Town { households: Household[]; ties: Tie[]; subSeed: number }

function build(subSeed: number): Town {
  const rng = new Rng(BASE_SEED + subSeed * 7919);
  const used = new Set<string>();
  const hand: Household[] = JSON.parse(JSON.stringify(handHouseholds));
  for (const h of hand) for (const m of h.members) used.add(m.name);
  for (const n of Object.values(NEIGHBORS)) used.add(n.name);
  const ctx: GenCtx = { rng, used, keyN: 0 };

  // 조작 가문 특성은 비워 둔 채(인물 만들기에서 고름) 시작하지 않도록 시드로 채움
  for (const h of hand) for (const m of h.members) {
    if (m.traits.length === 0 && traitCount(m.stage) > 0) m.traits = pickTraits(rng, traitCount(m.stage));
  }

  const serfIdx = { n: 0 };
  const surnameIdx = { n: 0 };
  const proc: Household[] = [];
  for (const slot of PROC_SLOTS) {
    const idx = slot.estate === 'serf' ? serfIdx.n++ : 0;
    proc.push(genHousehold(ctx, slot, idx, surnameIdx));
  }
  const households = [...hand, ...proc];

  // id 부여: 이웃은 nb_ id 유지, 나머지 p_001… 가문 순서대로
  let n = 1;
  for (const h of households) for (const m of h.members) {
    if (!m.id) m.id = `p_${String(n++).padStart(3, '0')}`;
    if (!m.seed) m.seed = 1000 + rng.int(900000);
    if (!m.topics && (m.stage === 'teen' || isGrown(m.stage))) {
      const t = shuffle(rng, [...TOPICS]);
      m.topics = t.slice(0, 2);
    }
    m.schedule = scheduleFor(m, h);
  }
  const keyToId = new Map<string, string>();
  for (const h of households) for (const m of h.members) keyToId.set(m.key, m.id!);
  const K = (k: string) => {
    const v = keyToId.get(k);
    if (!v) throw new Error(`알 수 없는 인물 키 ${k}`);
    return v;
  };
  for (const h of households) for (const r of h.relations) { r.a = K(r.a); r.b = K(r.b); }

  // 가문 사이 관계
  const ties: Tie[] = [];
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const seen = new Set<string>();
  const hhOf = new Map<string, Household>();
  const byId = new Map<string, Member>();
  for (const h of households) for (const m of h.members) { hhOf.set(m.id!, h); byId.set(m.id!, m); }
  const addTie = (a: string, b: string, fr: number, ro: number, flags: string[]) => {
    const k = pairKey(a, b);
    if (a === b || seen.has(k)) return false;
    seen.add(k);
    ties.push({ a, b, friendship: fr, romance: ro, flags });
    return true;
  };
  for (const [a, b, fr, ro, flags] of handTies) addTie(K(a), K(b), fr, ro, flags);

  const everyone = households.flatMap((h) => h.members);
  const social = everyone.filter((m) => m.stage === 'child' || m.stage === 'teen' || isGrown(m.stage));
  const single = (m: Member) => !spouseOf(hhOf.get(m.id!)!, m.id!) && estateOf(m, hhOf.get(m.id!)!) !== 'clergy' && !m.lodger;
  const ageBand = (m: Member) => absAge(m.stage, m.ageDays);
  // 친구: 1~2명, 같은 신분 또는 나이가 비슷한 사람 선호
  for (const m of social) {
    const want = 1 + rng.int(2);
    for (let t = 0, got = 0; t < 20 && got < want; t++) {
      const o = pick(rng, social);
      if (hhOf.get(o.id!) === hhOf.get(m.id!)) continue;
      if (Math.abs(ageBand(o) - ageBand(m)) > 20) continue;
      if (!isGrown(m.stage) !== !isGrown(o.stage)) continue;
      const sameEstate = estateOf(o, hhOf.get(o.id!)!) === estateOf(m, hhOf.get(m.id!)!);
      if (!sameEstate && rng.next() < 0.6) continue;
      if (addTie(m.id!, o.id!, ri(rng, 20, 60), 0, ['friend'])) got++;
    }
  }
  // 동료: 같은 직업끼리
  const byCareer = new Map<string, Member[]>();
  for (const m of everyone) if (m.career) (byCareer.get(m.career) ?? byCareer.set(m.career, []).get(m.career)!).push(m);
  for (const list of byCareer.values()) for (let i = 1; i < list.length; i++) {
    const o = list[rng.int(i)];
    if (hhOf.get(o.id!) !== hhOf.get(list[i].id!) && rng.next() < 0.5) addTie(list[i].id!, o.id!, ri(rng, 15, 40), 0, ['coworker']);
  }
  // 원한 8쌍
  const grownUps = everyone.filter((m) => m.stage === 'young' || m.stage === 'adult' || m.stage === 'elder');
  for (let c = 0, t = 0; c < 8 && t < 200; t++) {
    const a = pick(rng, grownUps), b = pick(rng, grownUps);
    if (hhOf.get(a.id!) === hhOf.get(b.id!)) continue;
    if (addTie(a.id!, b.id!, -ri(rng, 30, 60), 0, ['grudge'])) c++;
  }
  // 풋사랑 6쌍 + 혼약 2쌍 (독신 청소년/청년, 이성, 나이 비슷, 신분 두 단계 이내)
  const EST_ORDER = ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'];
  const singles = everyone.filter((m) => (m.stage === 'teen' || m.stage === 'young') && single(m));
  const courtOk = (a: Member, b: Member) => a.sex !== b.sex && hhOf.get(a.id!) !== hhOf.get(b.id!) && Math.abs(ageBand(a) - ageBand(b)) <= 10 &&
    Math.abs(EST_ORDER.indexOf(estateOf(a, hhOf.get(a.id!)!)) - EST_ORDER.indexOf(estateOf(b, hhOf.get(b.id!)!))) <= 2;
  const taken = new Set<string>();
  for (const t of ties) if (t.romance > 0) { taken.add(t.a); taken.add(t.b); }
  const candPairs: [Member, Member][] = [];
  for (let i = 0; i < singles.length; i++) for (let j = i + 1; j < singles.length; j++) if (courtOk(singles[i], singles[j])) candPairs.push([singles[i], singles[j]]);
  shuffle(rng, candPairs);
  for (const [flag, count] of [['betrothed', 2], ['crush', 6]] as [string, number][]) {
    let c = 0;
    for (const [a, b] of candPairs) {
      if (c >= count) break;
      if (taken.has(a.id!) || taken.has(b.id!)) continue;
      if (flag === 'betrothed' && (a.stage !== 'young' || b.stage !== 'young')) continue;
      if (flag === 'crush' && ageBand(a) < 29 !== ageBand(b) < 29) continue; // 열여섯 아래는 또래끼리만
      if (addTie(a.id!, b.id!, ri(rng, 25, 50), flag === 'betrothed' ? ri(rng, 30, 55) : ri(rng, 15, 40), [flag])) {
        taken.add(a.id!); taken.add(b.id!); c++;
      }
    }
  }
  return { households, ties, subSeed };
}

// ───────────────────────── 분포 ─────────────────────────
const ESTATE_TARGET: Record<string, [number, number]> = {
  serf: [0.3, 0.35], freeman: [0.28, 0.32], artisan: [0.15, 0.2], merchant: [0.05, 0.08], clergy: [0.03, 0.05], knight: [0.03, 0.05], noble: [0, 0.06],
};
const AGE_TARGET: Record<string, [number, number]> = { kids: [0.27, 0.33], grown: [0.51, 0.59], elder: [0.13, 0.18] };
function stats(t: Town) {
  const all = t.households.flatMap((h) => h.members.map((m) => ({ m, h })));
  const total = all.length;
  const est: Record<string, number> = {};
  for (const { m, h } of all) est[estateOf(m, h)] = (est[estateOf(m, h)] ?? 0) + 1;
  const age = { kids: 0, grown: 0, elder: 0 };
  const stage: Record<string, number> = {};
  for (const { m } of all) {
    stage[m.stage] = (stage[m.stage] ?? 0) + 1;
    if (isKid(m.stage)) age.kids++;
    else if (m.stage === 'elder') age.elder++;
    else age.grown++;
  }
  return { total, est, age, stage };
}
function distOk(t: Town): string[] {
  const s = stats(t);
  const bad: string[] = [];
  if (s.total < 118 || s.total > 122) bad.push(`인구 ${s.total}`);
  if (t.households.length < 25 || t.households.length > 35) bad.push(`가문 ${t.households.length}`);
  for (const [e, [lo, hi]] of Object.entries(ESTATE_TARGET)) {
    const f = (s.est[e] ?? 0) / s.total;
    if (f < lo - 1e-9 || f > hi + 1e-9) bad.push(`${e} ${(f * 100).toFixed(1)}%`);
  }
  // 단계 모양 (안정 인구: 단계 길이에 비례에 가깝게 → 104일 동안 대체 수준이 고르게)
  const st = s.stage;
  if ((st.teen ?? 0) < 10) bad.push(`teen ${st.teen ?? 0}`);
  if ((st.child ?? 0) < 12) bad.push(`child ${st.child ?? 0}`);
  if ((st.toddler ?? 0) > 11) bad.push(`toddler ${st.toddler}`);
  if ((st.baby ?? 0) > 6 || (st.baby ?? 0) < 2) bad.push(`baby ${st.baby ?? 0}`);
  if ((st.adult ?? 0) < 24) bad.push(`adult ${st.adult ?? 0}`);
  for (const [k, [lo, hi]] of Object.entries(AGE_TARGET)) {
    const f = s.age[k as keyof typeof s.age] / s.total;
    if (f < lo || f > hi) bad.push(`${k} ${(f * 100).toFixed(1)}%`);
  }
  return bad;
}

// ───────────────────────── 일과표 ─────────────────────────
type Block = { from: number; to: number; at: string; do?: string };
type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
const DAYS: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']; // careers.json days 0 = 월요일 (29-2: 계절 첫날 월요일)
interface Template { workAt?: string; blocks: Block[]; weekday?: Partial<Record<Day, Block[]>>; weekdayFull?: Day[] }
const b = (from: number, to: number, at: string, d?: string): Block => ({ from, to, at, ...(d ? { do: d } : {}) });

/** 쉬는 날 하루 (일요일 아님) */
const OFF_DAY: Block[] = [b(21, 6, 'home', 'sleep'), b(6, 7, 'home', 'wake'), b(7, 12, 'home', 'chores'), b(12, 13, 'home', 'meal'), b(13, 17, 'well_square', 'chat'), b(17, 18, 'home', 'chores'), b(18, 19, 'home', 'meal'), b(19, 21, 'home', 'relax')];
/** 일요일 (일하지 않는 사람): 미사 9~11 + 미사 뒤 교회 앞 수다 */
const SUNDAY: Block[] = [b(21, 6, 'home', 'sleep'), b(6, 9, 'home', 'wake'), b(9, 11, 'church', 'mass'), b(11, 12, 'church', 'chat'), b(12, 13, 'home', 'meal'), b(13, 17, 'home', 'relax'), b(17, 18, 'well_square', 'chat'), b(18, 19, 'home', 'meal'), b(19, 21, 'home', 'relax')];
const MASS: Block[] = [b(9, 11, 'church', 'mass')];

/** 낮 근무 직업: careers.json 시각/요일에서 만듦. 교회 종(6, 12, 18시)에 전환이 몰리게 */
function dayJob(hours: [number, number], workAt: string, days: number[], opts: { workDo?: string; market?: boolean; evening?: Block[]; sundayWork?: boolean } = {}): Template {
  const [h0, h1] = hours;
  const blocks: Block[] = [];
  const wake = h0 <= 5 ? h0 - 1 : h0 === 6 ? 5 : 6;
  const sleepAt = h0 <= 5 ? 20 : 21;
  blocks.push(b(sleepAt, wake, 'home', 'sleep'));
  blocks.push(b(wake, h0, 'home', 'wake'));
  blocks.push(b(h0, h1, 'work', opts.workDo ?? 'work'));
  if (h1 < 18) {
    blocks.push(b(h1, 18, 'home', 'chores'));
    blocks.push(b(18, 19, 'home', 'meal'));
    blocks.push(...(opts.evening ?? [b(19, sleepAt, 'home', 'relax')]));
  } else {
    blocks.push(b(h1, h1 + 1, 'home', 'meal'));
    blocks.push(b(h1 + 1, sleepAt, 'home', 'relax'));
  }
  const weekday: Partial<Record<Day, Block[]>> = {};
  const weekdayFull: Day[] = [];
  for (let i = 0; i < 7; i++) {
    const d = DAYS[i];
    if (!days.includes(i)) {
      weekday[d] = d === 'sun' ? SUNDAY : OFF_DAY;
      weekdayFull.push(d);
    } else if (d === 'sun') weekday.sun = MASS;
    else if ((d === 'tue' || d === 'fri') && opts.market !== false && h1 <= 16) weekday[d] = [b(h1, Math.min(h1 + 2, 18), 'market', 'shop')];
  }
  return { workAt, blocks, weekday, weekdayFull };
}

function careerHours(id: string): { hours: [number, number]; days: number[] } {
  const c = CAREERS[id] ?? NPC_ROLES[id];
  return c.hours ? { hours: c.hours, days: c.days } : { hours: c.schedule.hours, days: c.schedule.days };
}

function makeSchedules(): Record<string, Template> {
  const T: Record<string, Template> = {};
  const std = (id: string, workAt: string, o: Parameters<typeof dayJob>[3] = {}) => {
    const { hours, days } = careerHours(id);
    T[id] = dayJob(hours, workAt, days, o);
  };
  // 직업 16
  std('field_hand', 'lord_fields');
  std('mill_hand', 'mill');
  std('guard', 'castle', { workDo: 'patrol' });
  std('clerk', 'castle');
  std('blacksmith', 'craft_street');
  std('brewer', 'craft_street');
  std('tailor', 'craft_street');
  std('carpenter', 'craft_street');
  std('healer', 'craft_street', { workDo: 'heal' });
  T.monk = {
    workAt: 'monastery',
    blocks: [b(20, 4, 'home', 'sleep'), b(4, 5, 'monastery', 'pray'), b(5, 17, 'work', 'work'), b(17, 18, 'monastery', 'pray'), b(18, 19, 'monastery', 'meal'), b(19, 20, 'monastery', 'relax')],
    weekday: { sun: [b(9, 11, 'monastery', 'mass')] },
  };
  T.trader = {
    workAt: 'market',
    blocks: [b(22, 6, 'home', 'sleep'), b(6, 7, 'home', 'wake'), b(7, 19, 'work', 'trade'), b(19, 20, 'home', 'meal'), b(20, 22, 'inn', 'chat')],
    weekday: { sun: MASS },
  };
  T.baker = {
    workAt: 'craft_street',
    blocks: [b(19, 2, 'home', 'sleep'), b(2, 3, 'home', 'wake'), b(3, 11, 'work', 'work'), b(11, 12, 'home', 'meal'), b(12, 15, 'home', 'nap'), b(15, 18, 'home', 'chores'), b(18, 19, 'home', 'meal')],
    weekday: { tue: [b(12, 14, 'market', 'shop')], fri: [b(12, 14, 'market', 'shop')], sun: SUNDAY },
    weekdayFull: ['sun'],
  };
  T.minstrel = {
    workAt: 'inn',
    blocks: [b(23, 9, 'home', 'sleep'), b(9, 10, 'home', 'wake'), b(10, 13, 'home', 'practice'), b(13, 14, 'home', 'meal'), b(14, 16, 'market', 'perform'), b(16, 23, 'work', 'perform')],
    weekday: { mon: OFF_DAY, wed: OFF_DAY, sun: MASS },
    weekdayFull: ['mon', 'wed'],
  };
  T.innkeeper = {
    workAt: 'inn',
    blocks: [b(23, 7, 'home', 'sleep'), b(7, 8, 'home', 'wake'), b(8, 10, 'market', 'shop'), b(10, 22, 'work', 'work'), b(22, 23, 'home', 'relax')],
    weekday: { sun: MASS },
  };
  T.priest = {
    workAt: 'church',
    blocks: [b(21, 5, 'home', 'sleep'), b(5, 6, 'church', 'pray'), b(6, 13, 'work', 'work'), b(13, 14, 'home', 'meal'), b(14, 17, 'well_square', 'visit'), b(17, 18, 'church', 'pray'), b(18, 19, 'home', 'meal'), b(19, 21, 'home', 'relax')],
    weekday: { tue: [b(14, 16, 'market', 'visit')], fri: [b(14, 16, 'market', 'visit')], sun: [b(6, 13, 'work', 'lead_mass')] },
  };
  T.knight = {
    workAt: 'castle',
    blocks: [b(22, 6, 'home', 'sleep'), b(6, 7, 'home', 'wake'), b(7, 8, 'home', 'meal'), b(8, 14, 'work', 'train'), b(14, 17, 'home', 'relax'), b(17, 18, 'home', 'chores'), b(18, 19, 'home', 'meal'), b(19, 22, 'castle', 'feast')],
    weekday: { tue: [b(14, 17, 'tourney_ground', 'train')], wed: [b(14, 18, 'forest_river', 'hunt')], thu: [b(14, 17, 'tourney_ground', 'train')], sun: SUNDAY },
    weekdayFull: ['sun'],
  };
  // 역할 10 (careers.json npcRoles.schedule)
  T.servant = {
    workAt: 'employer',
    blocks: [b(21, 4, 'home', 'sleep'), b(4, 5, 'home', 'wake'), b(5, 21, 'work', 'serve')],
    weekday: { sun: MASS },
  };
  std('bailiff', 'market', { workDo: 'patrol', market: false, evening: [b(19, 21, 'inn', 'drink')] });
  T.messenger = {
    workAt: 'well_square',
    blocks: [b(21, 5, 'home', 'sleep'), b(5, 6, 'home', 'wake'), b(6, 9, 'castle', 'deliver'), b(9, 11, 'craft_street', 'deliver'), b(11, 13, 'market', 'cry_news'), b(13, 15, 'well_square', 'deliver'), b(15, 18, 'work', 'deliver'), b(18, 19, 'home', 'meal'), b(19, 21, 'home', 'relax')],
    weekday: { sun: [...SUNDAY.filter((x) => x.from !== 11), b(11, 12, 'market', 'cry_news')] },
    weekdayFull: ['sun'],
  };
  T.matchmaker = {
    workAt: 'well_square',
    blocks: [b(21, 6, 'home', 'sleep'), b(6, 8, 'home', 'wake'), b(8, 10, 'home', 'chores'), b(10, 12, 'work', 'matchmake'), b(12, 13, 'home', 'meal'), b(13, 15, 'market', 'matchmake'), b(15, 17, 'work', 'matchmake'), b(17, 18, 'home', 'chores'), b(18, 19, 'home', 'meal'), b(19, 21, 'inn', 'chat')],
    weekday: { tue: [b(10, 12, 'market', 'matchmake')], fri: [b(10, 12, 'market', 'matchmake')], sun: SUNDAY },
    weekdayFull: ['sun'],
  };
  std('moneylender', 'market', { workDo: 'lend', market: false });
  T.midwife = {
    workAt: 'home',
    blocks: [b(21, 5, 'home', 'sleep'), b(5, 6, 'home', 'wake'), b(6, 8, 'well_square', 'fetch_water'), b(8, 18, 'work', 'on_call'), b(18, 19, 'home', 'meal'), b(19, 21, 'home', 'relax')],
    weekday: { sun: MASS },
  };
  T.herbalist = {
    workAt: 'forest_river',
    blocks: [b(21, 5, 'home', 'sleep'), b(5, 7, 'home', 'wake'), b(7, 17, 'work', 'gather'), b(17, 18, 'home', 'chores'), b(18, 19, 'home', 'meal'), b(19, 21, 'home', 'relax')],
    weekday: { tue: [b(15, 17, 'market', 'sell')], fri: [b(15, 17, 'market', 'sell')], sun: MASS },
  };
  std('tutor', 'employer', { workDo: 'teach' });
  std('mason', 'craft_street', { workDo: 'build' });
  std('leatherworker', 'craft_street');
  // 마을 직책
  T.lord = {
    workAt: 'castle',
    blocks: [b(22, 6, 'home', 'sleep'), b(6, 7, 'home', 'wake'), b(7, 8, 'home', 'meal'), b(8, 12, 'castle', 'court'), b(12, 13, 'castle', 'meal'), b(13, 17, 'castle', 'administer'), b(17, 18, 'castle', 'relax'), b(18, 20, 'castle', 'feast'), b(20, 22, 'castle', 'relax')],
    weekday: { wed: [b(13, 17, 'forest_river', 'hunt')], sun: MASS },
  };
  T.noble = {
    workAt: 'castle',
    blocks: [b(22, 7, 'home', 'sleep'), b(7, 8, 'home', 'wake'), b(8, 12, 'castle', 'court'), b(12, 13, 'castle', 'meal'), b(13, 16, 'castle', 'relax'), b(16, 18, 'castle', 'visit'), b(18, 20, 'castle', 'feast'), b(20, 22, 'castle', 'relax')],
    weekday: { tue: [b(13, 15, 'market', 'shop')], wed: [b(13, 17, 'forest_river', 'hunt')], thu: [b(13, 16, 'tourney_ground', 'watch')], fri: [b(13, 15, 'market', 'shop')], sun: MASS },
  };
  T.reeve = {
    workAt: 'lord_fields',
    blocks: [b(21, 5, 'home', 'sleep'), b(5, 6, 'home', 'wake'), b(6, 14, 'work', 'oversee'), b(14, 15, 'castle', 'report'), b(15, 18, 'home', 'chores'), b(18, 19, 'home', 'meal'), b(19, 21, 'inn', 'drink')],
    weekday: { tue: [b(15, 17, 'market', 'shop')], fri: [b(15, 17, 'market', 'shop')], sun: SUNDAY },
    weekdayFull: ['sun'],
  };
  T.miller = {
    workAt: 'mill',
    blocks: [b(21, 4, 'home', 'sleep'), b(4, 5, 'home', 'wake'), b(5, 16, 'work', 'mill'), b(16, 18, 'home', 'chores'), b(18, 19, 'home', 'meal'), b(19, 21, 'inn', 'chat')],
    weekday: { sun: SUNDAY },
    weekdayFull: ['sun'],
  };
  T.abbot = {
    workAt: 'monastery',
    blocks: [...T.monk.blocks],
    weekday: { mon: [b(13, 15, 'castle', 'counsel')], thu: [b(13, 15, 'church', 'visit')], sun: [b(9, 11, 'monastery', 'mass')] },
  };
  T.guild_master = {
    workAt: 'craft_street',
    blocks: [b(21, 5, 'home', 'sleep'), b(5, 6, 'home', 'wake'), b(6, 12, 'work', 'work'), b(12, 13, 'home', 'meal'), b(13, 16, 'guild_hall', 'guild_business'), b(16, 18, 'work', 'work'), b(18, 19, 'home', 'meal'), b(19, 21, 'inn', 'chat')],
    weekday: { sat: [b(13, 17, 'guild_hall', 'meeting')], sun: SUNDAY },
    weekdayFull: ['sun'],
  };
  // 단계/형편
  T.baby = {
    blocks: [b(19, 6, 'home', 'sleep'), b(6, 7, 'home', 'feed'), b(7, 10, 'home', 'nap'), b(10, 11, 'home', 'feed'), b(11, 14, 'home', 'nap'), b(14, 15, 'home', 'feed'), b(15, 18, 'home', 'play'), b(18, 19, 'home', 'feed')],
    weekday: { sun: [b(9, 11, 'church', 'carried')] },
  };
  T.toddler = {
    blocks: [b(20, 7, 'home', 'sleep'), b(7, 8, 'home', 'meal'), b(8, 12, 'home', 'play'), b(12, 13, 'home', 'meal'), b(13, 15, 'home', 'nap'), b(15, 18, 'home', 'play'), b(18, 19, 'home', 'meal'), b(19, 20, 'home', 'relax')],
    weekday: { sun: MASS },
  };
  const childSat: Block[] = [b(7, 12, 'home', 'chores'), b(13, 17, 'forest_river', 'play')];
  T.child = {
    blocks: [b(20, 6, 'home', 'sleep'), b(6, 7, 'home', 'wake'), b(7, 11, 'church', 'school'), b(11, 12, 'home', 'chores'), b(12, 13, 'home', 'meal'), b(13, 17, 'well_square', 'play'), b(17, 18, 'home', 'chores'), b(18, 19, 'home', 'meal'), b(19, 20, 'home', 'relax')],
    weekday: { sat: childSat, sun: MASS },
  };
  T.child_tutored = {
    blocks: [b(20, 6, 'home', 'sleep'), b(6, 7, 'home', 'wake'), b(7, 11, 'home', 'lessons'), b(11, 12, 'home', 'relax'), b(12, 13, 'home', 'meal'), b(13, 17, 'home', 'play'), b(17, 18, 'home', 'chores'), b(18, 19, 'home', 'meal'), b(19, 20, 'home', 'relax')],
    weekday: { tue: [b(13, 15, 'market', 'tag_along')], sat: [b(7, 12, 'home', 'play'), b(13, 17, 'tourney_ground', 'play')], sun: MASS },
  };
  T.teen = {
    blocks: [b(21, 5, 'home', 'sleep'), b(5, 6, 'home', 'wake'), b(6, 12, 'home', 'chores'), b(12, 13, 'home', 'meal'), b(13, 16, 'monastery', 'school'), b(16, 17, 'well_square', 'chat'), b(17, 18, 'home', 'chores'), b(18, 19, 'home', 'meal'), b(19, 21, 'well_square', 'socialize')],
    weekday: { sat: [b(13, 17, 'forest_river', 'play')], sun: SUNDAY },
    weekdayFull: ['sun'],
  };
  T.elder = {
    blocks: [b(20, 6, 'home', 'sleep'), b(6, 7, 'home', 'wake'), b(7, 8, 'church', 'pray'), b(8, 12, 'home', 'chores'), b(12, 13, 'home', 'meal'), b(13, 16, 'well_square', 'chat'), b(16, 18, 'home', 'relax'), b(18, 19, 'home', 'meal'), b(19, 20, 'home', 'relax')],
    weekday: { tue: [b(8, 10, 'market', 'shop')], fri: [b(8, 10, 'market', 'shop')], sun: MASS },
  };
  T.homemaker = {
    blocks: [b(21, 5, 'home', 'sleep'), b(5, 6, 'home', 'wake'), b(6, 7, 'well_square', 'fetch_water'), b(7, 12, 'home', 'chores'), b(12, 13, 'home', 'meal'), b(13, 16, 'home', 'chores'), b(16, 17, 'well_square', 'chat'), b(17, 18, 'home', 'cook'), b(18, 19, 'home', 'meal'), b(19, 21, 'home', 'relax')],
    weekday: { tue: [b(8, 11, 'market', 'shop')], fri: [b(8, 11, 'market', 'shop')], sat: [b(13, 15, 'bathhouse', 'bathe')], sun: SUNDAY },
    weekdayFull: ['sun'],
  };
  T.default = { blocks: [...T.homemaker.blocks], weekday: { ...T.homemaker.weekday }, weekdayFull: ['sun'] };
  T.unemployed = {
    blocks: [b(21, 6, 'home', 'sleep'), b(6, 7, 'home', 'wake'), b(7, 10, 'market', 'seek_work'), b(10, 12, 'craft_street', 'seek_work'), b(12, 13, 'home', 'meal'), b(13, 16, 'lord_fields', 'odd_job'), b(16, 18, 'well_square', 'chat'), b(18, 19, 'home', 'meal'), b(19, 21, 'inn', 'drink')],
    weekday: { sun: SUNDAY },
    weekdayFull: ['sun'],
  };
  T.lodger = {
    blocks: [b(23, 8, 'home', 'sleep'), b(8, 9, 'home', 'wake'), b(9, 12, 'market', 'watch'), b(12, 13, 'inn', 'meal'), b(13, 17, 'forest_river', 'wander'), b(17, 23, 'inn', 'drink')],
    weekday: { wed: [b(13, 17, 'castle', 'watch')] },
  };
  return T;
}

const SCHEDULE_EXTRAS = {
  bells: [6, 12, 18],
  traitMods: [
    { trait: 'drinker', block: b(19, 22, 'inn', 'drink'), chance: 0.5 },
    { trait: 'sociable', block: b(19, 21, 'inn', 'chat'), chance: 0.3 },
    { trait: 'cheerful', block: b(19, 21, 'inn', 'chat'), chance: 0.2 },
    { trait: 'hot_tempered', block: b(20, 22, 'inn', 'drink'), chance: 0.15 },
    { trait: 'gossip', block: b(16, 18, 'well_square', 'gossip'), chance: 0.5 },
    { trait: 'introvert', block: b(17, 21, 'home', 'relax'), chance: 0.6 },
    { trait: 'family_oriented', block: b(17, 21, 'home', 'family'), chance: 0.5 },
    { trait: 'suspicious', block: b(19, 21, 'home', 'guard'), chance: 0.3 },
    { trait: 'nature_lover', block: b(16, 18, 'forest_river', 'walk'), chance: 0.4 },
    { trait: 'active', block: b(17, 18, 'forest_river', 'exercise'), chance: 0.4 },
    { trait: 'romantic', block: b(19, 21, 'forest_river', 'stroll'), chance: 0.2 },
    { trait: 'bookworm', block: b(17, 19, 'monastery', 'read'), chance: 0.2 },
    { trait: 'flirt', block: b(18, 20, 'bathhouse', 'bathe'), chance: 0.3 },
    { trait: 'neat', block: b(17, 18, 'bathhouse', 'bathe'), chance: 0.3 },
    { trait: 'ambitious', block: b(18, 20, 'guild_hall', 'network'), chance: 0.3, estates: ['artisan'] },
    { trait: 'gourmet', block: b(8, 10, 'market', 'shop'), chance: 0.5, days: ['tue', 'fri'] },
    { trait: 'kind', block: b(14, 16, 'church', 'charity'), chance: 0.15 },
    { trait: 'lazy', block: b(5, 7, 'home', 'sleep'), chance: 0.5 },
    { trait: 'diligent', block: b(16, 18, 'work', 'work'), chance: 0.3 },
  ],
  virtueMods: [
    { virtue: 'humility', block: b(6, 7, 'church', 'pray'), chance: 0.5 },
    { virtue: 'charity', block: b(14, 15, 'church', 'charity'), chance: 0.3 },
    { virtue: 'chastity', block: b(17, 18, 'church', 'pray'), chance: 0.2 },
    { virtue: 'temperance', block: b(19, 21, 'home', 'relax'), chance: 0.3 },
  ],
  sinMods: [
    { sin: 'gluttony', block: b(18, 20, 'inn', 'feast'), chance: 0.4 },
    { sin: 'lust', block: b(19, 21, 'bathhouse', 'bathe'), chance: 0.3 },
    { sin: 'greed', block: b(16, 18, 'market', 'haggle'), chance: 0.3 },
    { sin: 'sloth', block: b(5, 8, 'home', 'sleep'), chance: 0.4 },
    { sin: 'wrath', block: b(20, 22, 'inn', 'drink'), chance: 0.2 },
    { sin: 'envy', block: b(16, 18, 'well_square', 'gossip'), chance: 0.3 },
    { sin: 'pride', block: b(17, 18, 'bathhouse', 'bathe'), chance: 0.2 },
  ],
  rainMods: { market: 0.4, well_square: 0.5, forest_river: 0.3, tourney_ground: 0.2, lord_fields: 0.8, bathhouse: 1.3, inn: 1.4, church: 1.1 },
  plagueMods: { closed: ['bathhouse', 'inn', 'market', 'guild_hall', 'tourney_ground'], church: 1.5, home: 1.5 },
};

// ───────────────────────── 검사 ─────────────────────────
const errors: string[] = [];
const warns: string[] = [];
const err = (s: string) => errors.push(s);

function coverHours(blocks: Block[], label: string, full: boolean): void {
  const hours = new Array(24).fill(0);
  for (const bl of blocks) {
    if (!PLACES.includes(bl.at)) err(`${label}: 모르는 장소 ${bl.at}`);
    if (bl.from < 0 || bl.from > 23 || bl.to < 0 || bl.to > 24 || bl.from === bl.to) err(`${label}: 시각 범위 ${bl.from}-${bl.to}`);
    const len = bl.to > bl.from ? bl.to - bl.from : 24 - bl.from + bl.to;
    for (let i = 0; i < len; i++) hours[(bl.from + i) % 24]++;
  }
  hours.forEach((c, h) => {
    if (c > 1) err(`${label}: ${h}시 겹침`);
    if (full && c === 0) err(`${label}: ${h}시 빈칸`);
  });
}

function validate(t: Town, T: Record<string, Template>, ko: Record<string, string>, news: Record<string, string>): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  const hIds = new Set<string>();
  const people = new Map<string, { m: Member; h: Household }>();
  for (const h of t.households) {
    if (hIds.has(h.id)) err(`가문 id 중복 ${h.id}`);
    hIds.add(h.id);
    if (!/^[a-z0-9_]+$/.test(h.id)) err(`가문 id 형식 ${h.id}`);
    if (!ESTATE_TARGET[h.estate]) err(`${h.id}: 신분 ${h.estate}`);
    if (!ko[`house.${h.id}`]) err(`${h.id}: 이름 키 없음`);
    if (h.hook && !ko[`story.hook.${h.hook}`]) err(`${h.id}: 훅 문장 없음`);
    for (const m of h.members) {
      if (ids.has(m.id!)) err(`인물 id 중복 ${m.id}`);
      ids.add(m.id!);
      if (names.has(m.name)) err(`이름 중복 ${m.name}`);
      names.add(m.name);
      people.set(m.id!, { m, h });
      const lab = `${h.id}/${m.id} ${m.name}`;
      if (!STAGES.includes(m.stage)) err(`${lab}: 단계 ${m.stage}`);
      const maxD = m.stage === 'elder' ? ELDER_MAX_START : STAGE_LEN[m.stage] - 1;
      if (m.ageDays < 0 || m.ageDays > maxD) err(`${lab}: 경과일 ${m.ageDays} (최대 ${maxD})`);
      const tc = traitCount(m.stage);
      if (m.traits.length !== tc && !(m.stage === 'child' && m.traits.length <= 2 && m.traits.length >= 1)) err(`${lab}: 특성 수 ${m.traits.length} (기대 ${tc})`);
      for (const tr of m.traits) if (!TRAIT_IDS.includes(tr)) err(`${lab}: 모르는 특성 ${tr}`);
      for (let i = 0; i < m.traits.length; i++) for (let j = i + 1; j < m.traits.length; j++) if (conflicts(m.traits[i], m.traits[j])) err(`${lab}: 특성 충돌 ${m.traits[i]}/${m.traits[j]}`);
      if (new Set(m.traits).size !== m.traits.length) err(`${lab}: 특성 중복`);
      if (isKid(m.stage) && m.traits.some((x) => KID_EXCLUDED_TRAITS.includes(x))) err(`${lab}: 아이에게 맞지 않는 특성`);
      if (isKid(m.stage) && m.sin === 'lust') err(`${lab}: 아이에게 맞지 않는 죄`);
      if ((m.stage === 'baby' || m.stage === 'toddler') && !TEMPERAMENTS.includes(m.temperament ?? '')) err(`${lab}: 기질 없음`);
      if (m.virtue && !VIRTUES.includes(m.virtue)) err(`${lab}: 모르는 덕 ${m.virtue}`);
      if (m.sin && !SINS.includes(m.sin)) err(`${lab}: 모르는 죄 ${m.sin}`);
      if (m.virtue && CROSS.some(([tr, v]) => v === m.virtue && m.traits.includes(tr))) err(`${lab}: 특성-덕 충돌`);
      if (m.career && !CAREERS[m.career]) err(`${lab}: 모르는 직업 ${m.career}`);
      if (m.role && !ALL_ROLES.has(m.role)) err(`${lab}: 모르는 역할 ${m.role}`);
      if (m.role && TOWN_ROLES[m.role] && !ko[`role.${m.role}`]) err(`${lab}: 직책 이름 키 없음 role.${m.role}`);
      const est = estateOf(m, h);
      if (m.career && !CAREERS[m.career].estates.includes(est)) err(`${lab}: 직업 ${m.career} 신분 ${est} 불가`);
      if (m.role && NPC_ROLES[m.role] && !NPC_ROLES[m.role].estates.includes(est)) err(`${lab}: 역할 ${m.role} 신분 ${est} 불가`);
      if (m.role && TOWN_ROLES[m.role] && !TOWN_ROLES[m.role].estates.includes(est)) err(`${lab}: 직책 ${m.role} 신분 ${est} 불가`);
      if ((m.career || m.role) && !(m.stage === 'teen' || isGrown(m.stage))) err(`${lab}: 아이가 직업을 가짐`);
      if (m.subrole && !(m.role && NPC_ROLES[m.role]?.subroles?.[m.subrole])) err(`${lab}: 하위 역할 ${m.subrole}`);
      if (m.employer && !t.households.some((x) => x.id === m.employer)) err(`${lab}: 고용주 가문 없음 ${m.employer}`);
      if ((m.role === 'servant' || m.role === 'tutor') && !m.employer) err(`${lab}: 고용주 없음`);
      if (!m.schedule || !T[m.schedule]) err(`${lab}: 일과표 ${m.schedule} 없음`);
      if (m.career && !T[m.career]) err(`${lab}: 직업 ${m.career} 일과표 없음`);
      if (m.role && !T[m.role]) err(`${lab}: 역할 ${m.role} 일과표 없음`);
      if (estateOf(m, h) === 'clergy' && h.relations.some((r) => r.kind === 'spouse' && (r.a === m.id || r.b === m.id))) err(`${lab}: 성직자 혼인`);
    }
    // 가족 관계: 나이 차
    for (const r of h.relations) {
      const A = h.members.find((x) => x.id === r.a);
      const B = h.members.find((x) => x.id === r.b);
      if (!A || !B) { err(`${h.id}: 관계 대상이 가문 밖 ${r.a}-${r.b}`); continue; }
      if (r.kind === 'parent') {
        const gap = absAge(A.stage, A.ageDays) - absAge(B.stage, B.ageDays);
        if (gap < MIN_PARENT_GAP) err(`${h.id}: ${A.name}→${B.name} 부모 나이 차 ${gap}일 (< ${MIN_PARENT_GAP})`);
        if (A.sex === 'female' && absAge(A.stage, A.ageDays) - absAge(B.stage, B.ageDays) + 0 > 0) {
          const atBirth = absAge(A.stage, A.ageDays) - absAge(B.stage, B.ageDays);
          if (atBirth > MAX_MOTHER_AGE) err(`${h.id}: ${A.name} 출산 나이 ${atBirth}일 (> ${MAX_MOTHER_AGE})`);
        }
      }
      if (r.kind === 'spouse') {
        if (!isGrown(A.stage) || !isGrown(B.stage)) err(`${h.id}: 미성년 혼인 ${A.name}-${B.name}`);
        if (Math.abs(absAge(A.stage, A.ageDays) - absAge(B.stage, B.ageDays)) > 24) warns.push(`${h.id}: 부부 나이 차 큼 ${A.name}-${B.name}`);
      }
    }
    if (h.player) {
      const names = h.members.map((m) => m.name).join(',');
      const want = startJson.members.map((m: any) => m.name).join(',');
      if (names !== want) err(`조작 가문 구성 ${names} ≠ start.json ${want}`);
      if (h.estate !== startJson.estate) err('조작 가문 신분이 start.json 과 다름');
    }
  }
  // 이웃 12명
  for (const n of Object.values(NEIGHBORS)) {
    const p = people.get(n.id);
    if (!p) { err(`이웃 ${n.id} 빠짐`); continue; }
    if (p.m.name !== n.name || p.m.sex !== n.sex || p.m.traits.join() !== n.traits.join() || estateOf(p.m, p.h) !== n.estate) err(`이웃 ${n.id} 정보 불일치`);
    if (n.stage === 'elder' && p.m.stage !== 'elder') err(`이웃 ${n.id} 노년이 아님`);
    if (n.stage === 'adult' && !(p.m.stage === 'young' || p.m.stage === 'adult')) err(`이웃 ${n.id} 성인이 아님`);
  }
  // 이야기 가문
  const story = t.households.filter((h) => h.hook);
  if (story.length !== 12) err(`이야기 가문 ${story.length}개 (12 필요)`);
  for (const h of story) {
    const inHook = new Set(h.members.map((m) => m.id));
    const shown = t.ties.some((x) => (inHook.has(x.a) || inHook.has(x.b)) && x.flags.some((f) => f !== 'friend' && f !== 'coworker')) ||
      h.relations.some((r) => r.flags?.length);
    if (!shown) err(`${h.id}: 훅이 관계에 드러나지 않음`);
  }
  if (t.households.filter((h) => h.player).length !== 1) err('조작 가문이 하나가 아님');
  if (t.households.filter((h) => h.estate === 'noble').length !== 1) err('영주 가문이 하나가 아님');
  // ties
  const pairs = new Set<string>();
  for (const x of t.ties) {
    if (!people.has(x.a) || !people.has(x.b)) err(`tie 대상 없음 ${x.a}-${x.b}`);
    const k = x.a < x.b ? `${x.a}|${x.b}` : `${x.b}|${x.a}`;
    if (pairs.has(k)) err(`tie 중복 ${k}`);
    pairs.add(k);
    for (const f of x.flags) if (!ko[`tie.flag.${f}`]) err(`tie 표시 이름 없음 tie.flag.${f}`);
  }
  for (const h of t.households) for (const r of h.relations) for (const f of r.flags ?? []) if (!ko[`tie.flag.${f}`]) err(`관계 표시 이름 없음 tie.flag.${f}`);
  // 일과표
  for (const id of [...Object.keys(CAREERS), ...Object.keys(NPC_ROLES), ...Object.keys(TOWN_ROLES), 'default', 'baby', 'toddler', 'child', 'teen', 'elder', 'unemployed', 'lord', 'priest', 'noble']) {
    if (!T[id]) err(`일과표 템플릿 없음 ${id}`);
  }
  for (const [id, tp] of Object.entries(T)) {
    coverHours(tp.blocks, `일과표 ${id}`, true);
    if (tp.blocks.some((x) => x.at === 'work') && !tp.workAt) err(`일과표 ${id}: work 를 쓰는데 workAt 없음`);
    if (tp.workAt && tp.workAt !== 'employer' && !PLACES.includes(tp.workAt)) err(`일과표 ${id}: workAt ${tp.workAt}`);
    for (const [d, bl] of Object.entries(tp.weekday ?? {})) {
      if (!DAYS.includes(d as Day)) err(`일과표 ${id}: 요일 ${d}`);
      coverHours(bl!, `일과표 ${id}.${d}`, (tp.weekdayFull ?? []).includes(d as Day));
    }
    if (!(tp.weekday?.sun ?? []).some((x) => x.do === 'mass' || x.do === 'lead_mass' || x.do === 'carried') && id !== 'lodger') err(`일과표 ${id}: 일요일 미사 없음`);
  }
  for (const m of [...SCHEDULE_EXTRAS.traitMods]) if (!TRAIT_IDS.includes(m.trait)) err(`traitMods 모르는 특성 ${m.trait}`);
  for (const m of SCHEDULE_EXTRAS.virtueMods) if (!VIRTUES.includes(m.virtue)) err(`virtueMods ${m.virtue}`);
  for (const m of SCHEDULE_EXTRAS.sinMods) if (!SINS.includes(m.sin)) err(`sinMods ${m.sin}`);
  for (const m of [...SCHEDULE_EXTRAS.traitMods, ...SCHEDULE_EXTRAS.virtueMods, ...SCHEDULE_EXTRAS.sinMods]) coverHours([m.block], 'mod', false);
  const dos = new Set<string>();
  for (const tp of Object.values(T)) for (const bl of [...tp.blocks, ...Object.values(tp.weekday ?? {}).flat()]) if (bl!.do) dos.add(bl!.do);
  for (const m of [...SCHEDULE_EXTRAS.traitMods, ...SCHEDULE_EXTRAS.virtueMods, ...SCHEDULE_EXTRAS.sinMods]) if (m.block.do) dos.add(m.block.do);
  for (const d of dos) if (!ko[`sched.do.${d}`]) err(`일과 행동 이름 없음 sched.do.${d}`);
  // 직업/역할이 마을에 하나 이상
  const usedCareers = new Set<string>();
  const usedRoles = new Set<string>();
  for (const { m } of people.values()) { if (m.career) usedCareers.add(m.career); if (m.role) usedRoles.add(m.role); }
  for (const c of Object.keys(CAREERS)) if (!usedCareers.has(c)) err(`마을에 직업 ${c} 가진 사람 없음`);
  for (const r of Object.keys(NPC_ROLES)) if (!usedRoles.has(r)) err(`마을에 역할 ${r} 가진 사람 없음`);
  // 문자열: 한국어만
  const hangul = /[가-힣]/;
  for (const [k, v] of Object.entries({ ...ko, ...news })) {
    if (!hangul.test(v)) err(`문자열 한국어 아님 ${k}`);
    if (/[A-Za-z]/.test(v.replace(/\{[a-z_]+\}/g, ''))) err(`문자열에 로마자 ${k}`);
  }
  for (const { m } of people.values()) if (!hangul.test(m.name)) err(`이름 한국어 아님 ${m.id}`);
  // 소식
  const NEWS_KINDS = ['engaged', 'married', 'birth', 'death_old', 'death_ill', 'moved_in', 'moved_out', 'promoted', 'fired', 'fire', 'bankrupt', 'freed_serf', 'new_house'];
  for (const k of NEWS_KINDS) {
    if (!news[`news.${k}`]) err(`news.${k} 없음`);
    if (!news[`rumor.${k}`]) err(`rumor.${k} 없음`);
  }
  for (const k of ['affair', 'bastard', 'theft']) if (!news[`rumor.${k}`]) err(`rumor.${k} 없음`);
  for (const [k, v] of Object.entries(news)) {
    const ph = v.match(/\{[a-z_]+\}/g) ?? [];
    for (const p of ph) if (!['{a}', '{b}', '{house}', '{place}'].includes(p)) err(`${k}: 모르는 자리 ${p}`);
  }
  // 금지 내용 (실존 종교/수위)
  const banned = ['하느님', '하나님', '예수', '그리스도', '성모', '마리아', '알라', '부처', '자살', '목을 매', '고문', '화형', '불태워', '장작더미'];
  for (const [k, v] of Object.entries({ ...ko, ...news })) for (const w of banned) if (v.includes(w)) err(`${k}: 금지어 "${w}"`);
}

// ───────────────────────── 실행 ─────────────────────────
let town: Town | null = null;
let tries = 0;
for (let s = 0; s < 5000; s++) {
  tries++;
  const t = build(s);
  if (distOk(t).length === 0) { town = t; break; }
}
if (!town) throw new Error('분포 조건을 만족하는 하위 시드를 찾지 못함');

const templates = makeSchedules();

// i18n
const ko: Record<string, string> = {};
for (const h of town.households) ko[`house.${h.id}`] = h.name;
for (const [id, v] of Object.entries(HOOKS)) { ko[`story.hook.${id}`] = v.text; ko[`story.hook.${id}.title`] = v.title; }
for (const [id, v] of Object.entries(TOWN_ROLES)) ko[`role.${id}`] = v.name;
ko['role.lodger'] = '투숙객';
Object.assign(ko, {
  'temperament.easy': '순함', 'temperament.fussy': '까다로움', 'temperament.smiley': '잘 웃음', 'temperament.timid': '겁 많음',
  'wealth.poor': '가난함', 'wealth.normal': '보통', 'wealth.rich': '넉넉함',
  'tie.flag.rival': '맞수', 'tie.flag.grudge': '원한', 'tie.flag.friend': '친구', 'tie.flag.coworker': '일터 동료',
  'tie.flag.crush': '짝사랑', 'tie.flag.betrothed': '약혼', 'tie.flag.secret_lovers': '남몰래 사랑하는 사이', 'tie.flag.former_lovers': '옛 연인',
  'tie.flag.rumored_father': '친아비라는 소문', 'tie.flag.doubts_paternity': '친자식인지 의심함', 'tie.flag.disapproves': '못마땅해함',
  'tie.flag.ally': '한편', 'tie.flag.sworn': '충성 맹세', 'tie.flag.debtor': '빚진 사이', 'tie.flag.accuser': '험담하는 사이',
  'tie.flag.secret_parent': '숨겨진 친부모', 'tie.flag.keeps_secret': '비밀을 지키는 사이', 'tie.flag.secret_dealings': '은밀한 거래',
  'tie.flag.employer': '주인과 하인',
  'sched.do.wake': '일어나 채비', 'sched.do.sleep': '잠', 'sched.do.meal': '식사', 'sched.do.work': '일', 'sched.do.mass': '미사',
  'sched.do.lead_mass': '미사 집전', 'sched.do.carried': '안겨서 미사', 'sched.do.shop': '장보기', 'sched.do.chat': '수다', 'sched.do.gossip': '소문 나누기',
  'sched.do.chores': '집안일', 'sched.do.relax': '쉬기', 'sched.do.nap': '낮잠', 'sched.do.feed': '젖 먹기', 'sched.do.play': '놀이',
  'sched.do.school': '교구 학교', 'sched.do.lessons': '가정교사 수업', 'sched.do.tag_along': '어른 따라가기', 'sched.do.socialize': '또래와 어울리기',
  'sched.do.pray': '기도', 'sched.do.visit': '심방', 'sched.do.patrol': '순찰', 'sched.do.heal': '진료', 'sched.do.trade': '장사',
  'sched.do.practice': '연습', 'sched.do.perform': '공연', 'sched.do.train': '무예 수련', 'sched.do.hunt': '사냥', 'sched.do.feast': '연회',
  'sched.do.serve': '시중', 'sched.do.deliver': '편지 전하기', 'sched.do.cry_news': '소식 외치기', 'sched.do.matchmake': '중매',
  'sched.do.lend': '돈놀이', 'sched.do.fetch_water': '물 긷기', 'sched.do.on_call': '부르면 달려갈 채비', 'sched.do.gather': '약초 캐기',
  'sched.do.sell': '팔기', 'sched.do.teach': '가르치기', 'sched.do.build': '돌 쌓기', 'sched.do.court': '대전 알현', 'sched.do.administer': '영지 살림',
  'sched.do.oversee': '밭일 감독', 'sched.do.report': '영주에게 보고', 'sched.do.mill': '곡식 빻기', 'sched.do.counsel': '영주 자문',
  'sched.do.guild_business': '길드 일', 'sched.do.meeting': '길드 회의', 'sched.do.cook': '밥 짓기', 'sched.do.bathe': '목욕',
  'sched.do.seek_work': '일자리 찾기', 'sched.do.odd_job': '품팔이', 'sched.do.drink': '에일 한잔', 'sched.do.watch': '구경',
  'sched.do.wander': '어딘가로 사라짐', 'sched.do.family': '가족과 함께', 'sched.do.guard': '문단속', 'sched.do.walk': '산책',
  'sched.do.exercise': '몸 단련', 'sched.do.stroll': '강가 거닐기', 'sched.do.read': '책 읽기', 'sched.do.network': '길드 사람 만나기',
  'sched.do.charity': '자선', 'sched.do.haggle': '흥정',
});

const news: Record<string, string> = readJson('src/i18n/ko/news.json');
validate(town, templates, ko, news);

// ───────────────────────── 쓰기 ─────────────────────────
const outPeople = {
  $comment:
    'M6 마을 사람 (계약 artifacts/contracts-m6.md 3절). tools/world/make-people.ts 가 시드로 생성 (손으로 고치지 말 것). ' +
    'stage = 29-2 생애 단계, ageDays = 그 단계 안 경과일. 이웃 12명(neighbors.json)은 id 를 nb_ 그대로 씀. ' +
    '추가 필드: member.schedule(schedules.json 템플릿 id, 우선순위 lodger > 아기/유아/아동 > role > career > teen/elder > noble > homemaker/unemployed), ' +
    'member.seed(외형), member.topics(대화 주제), member.temperament(아기/유아 기질 12-1: easy fussy smiley timid), ' +
    'member.subrole/employer(하인/가정교사가 일하는 가문 id), member.estate(가문과 개인 신분이 다를 때만, 16-2), member.lodger(여관 투숙객, 가족 아님), ' +
    'household.residence(공공 장소에 사는 가문: castle/inn/mill/church/monastery → 부지 대신 그 장소를 집으로), household.player(조작 가문, 시작 부지), ' +
    'relation.flags / tie.flags 표시 이름은 people_town.json tie.flag.<flag>. role 은 careers.json npcRoles 10종 + 마을 직책 lord reeve miller abbot guild_master (이름 role.<id>)',
  seed: BASE_SEED,
  subSeed: town.subSeed,
  households: town.households.map((h) => ({
    id: h.id, nameKey: `house.${h.id}`, estate: h.estate, wealth: h.wealth, lotSize: h.lotSize, lot: h.lot,
    ...(h.residence ? { residence: h.residence } : {}), ...(h.player ? { player: true } : {}),
    hookKey: h.hook ? `story.hook.${h.hook}` : null,
    members: h.members.map((m) => ({
      id: m.id, name: m.name, sex: m.sex, stage: m.stage, ageDays: m.ageDays, traits: m.traits,
      ...(m.temperament ? { temperament: m.temperament } : {}),
      career: m.career, role: m.role, ...(m.subrole ? { subrole: m.subrole } : {}), ...(m.employer ? { employer: m.employer } : {}),
      virtue: m.virtue, sin: m.sin, ...(m.estate ? { estate: m.estate } : {}), ...(m.lodger ? { lodger: true } : {}),
      schedule: m.schedule, seed: m.seed, ...(m.topics ? { topics: m.topics } : {}),
    })),
    relations: h.relations,
  })),
  ties: town.ties,
};

const outSched = {
  $comment:
    '일과표 (계약 contracts-m6.md 4절, GDD 18-2). tools/world/make-people.ts 가 만듦. 시각 0~24, from > to 면 자정을 넘김. ' +
    'blocks = 기본 하루 (24시간 전부 덮음). weekday.<요일> = 그 요일에 겹치는 시각만 덮어씀, weekdayFull 에 있는 요일은 하루 전체를 새로 씀 (쉬는 날). ' +
    '요일: careers.json days 0 = mon … 6 = sun (29-2 계절 첫날 월요일). at: home(가문 집, residence 가 있으면 그 장소) | work(템플릿 workAt) | 장소 id | 구역 id. ' +
    'workAt "employer" = member.employer 가문의 집. 여정(trader) 중에는 일과표 대신 여정 래빗홀. ' +
    'traitMods/virtueMods/sinMods: 일/학교(work, school, lessons) 블록은 덮지 않고, 그 밖 시각에 chance 확률로 덮어씀 (하루 1회 굴림, 시드 RNG). days/estates 가 있으면 그 요일/신분만. ' +
    'bells = 교회 종 (새벽, 정오, 저녁) → 일과 전환이 이 시각에 몰림. rainMods = 비 올 때 그 장소로 가는 확률 배수. plagueMods.closed = 역병 때 닫는 장소',
  bells: SCHEDULE_EXTRAS.bells,
  templates,
  traitMods: SCHEDULE_EXTRAS.traitMods,
  virtueMods: SCHEDULE_EXTRAS.virtueMods,
  sinMods: SCHEDULE_EXTRAS.sinMods,
  rainMods: SCHEDULE_EXTRAS.rainMods,
  plagueMods: SCHEDULE_EXTRAS.plagueMods,
};

fs.mkdirSync('src/data/town', { recursive: true });
fs.mkdirSync('artifacts/qa/m6', { recursive: true });
fs.writeFileSync('src/data/town/people.json', JSON.stringify(outPeople, null, 1) + '\n');
fs.writeFileSync('src/data/schedules.json', JSON.stringify(outSched, null, 1) + '\n');
fs.writeFileSync('src/i18n/ko/people_town.json', JSON.stringify(ko, null, 1) + '\n');

// ───────────────────────── 요약 ─────────────────────────
const ESTATE_KO: Record<string, string> = { serf: '농노', freeman: '자유민', artisan: '장인', merchant: '상인', clergy: '성직자', knight: '기사', noble: '귀족' };
const STAGE_KO: Record<Stage, string> = { baby: '아기', toddler: '유아', child: '아동', teen: '청소년', young: '청년', adult: '장년', elder: '노년' };
const SIZE_KO = { small: '소', medium: '중', large: '대', manor: '저택' };
const WEALTH_KO = { poor: '가난', normal: '보통', rich: '부유' };
const careerKo = (m: Member) => {
  const parts: string[] = [];
  if (m.role) parts.push(`역할:${m.role}${m.subrole ? `/${m.subrole}` : ''}${m.employer ? `@${m.employer}` : ''}`);
  if (m.career) parts.push(`직업:${m.career}`);
  return parts.join(' ') || '-';
};
const s = stats(town);
const L: string[] = [];
L.push('애쉬포드 마을 사람 요약 (tools/world/make-people.ts)');
L.push(`시드 ${BASE_SEED}, 하위 시드 ${town.subSeed} (분포 조건 통과까지 ${tries}번 시도)`);
L.push(`인구 ${s.total}명, 가문 ${town.households.length}개, 이야기 가문 ${town.households.filter((h) => h.hook).length}개, 가문 사이 관계 ${town.ties.length}개`);
L.push('');
L.push('신분 분포 (개인 신분)              목표');
for (const e of Object.keys(ESTATE_TARGET)) {
  const n = s.est[e] ?? 0;
  const [lo, hi] = ESTATE_TARGET[e];
  const hh = town.households.filter((h) => h.estate === e).length;
  L.push(`  ${ESTATE_KO[e].padEnd(4, '　')} ${String(n).padStart(3)}명 ${((n / s.total) * 100).toFixed(1).padStart(5)}%  가문 ${String(hh).padStart(2)}   ${(lo * 100).toFixed(0)}~${(hi * 100).toFixed(0)}%`);
}
L.push('');
L.push('나이 분포                            목표');
L.push(`  아이/청소년 ${String(s.age.kids).padStart(3)}명 ${((s.age.kids / s.total) * 100).toFixed(1)}%   27~33%`);
L.push(`  청년/장년   ${String(s.age.grown).padStart(3)}명 ${((s.age.grown / s.total) * 100).toFixed(1)}%   51~59%`);
L.push(`  노년        ${String(s.age.elder).padStart(3)}명 ${((s.age.elder / s.total) * 100).toFixed(1)}%   12~18%`);
L.push('  단계별: ' + STAGES.map((st) => `${STAGE_KO[st]} ${s.stage[st] ?? 0}`).join(', '));
L.push('');
const jobCount = new Map<string, number>();
for (const h of town.households) for (const m of h.members) {
  if (m.career) jobCount.set(`직업:${m.career}`, (jobCount.get(`직업:${m.career}`) ?? 0) + 1);
  if (m.role) jobCount.set(`역할:${m.role}`, (jobCount.get(`역할:${m.role}`) ?? 0) + 1);
}
L.push('직업/역할 인원: ' + [...jobCount.entries()].sort().map(([k, v]) => `${k} ${v}`).join(', '));
const schedCount = new Map<string, number>();
for (const h of town.households) for (const m of h.members) schedCount.set(m.schedule!, (schedCount.get(m.schedule!) ?? 0) + 1);
L.push('일과표 사용: ' + [...schedCount.entries()].sort().map(([k, v]) => `${k} ${v}`).join(', '));
L.push(`일과표 템플릿 ${Object.keys(templates).length}개: ${Object.keys(templates).join(' ')}`);
L.push('');
L.push('── 가문별 구성 ──');
const nameOf = new Map<string, string>();
for (const h of town.households) for (const m of h.members) nameOf.set(m.id!, m.name);
for (const h of town.households) {
  const tags = [ESTATE_KO[h.estate], WEALTH_KO[h.wealth], `부지 ${SIZE_KO[h.lotSize]}`];
  if (h.residence) tags.push(`거처 ${h.residence}`);
  if (h.player) tags.push('조작 가문');
  L.push('');
  L.push(`[${h.id}] ${h.name}  (${tags.join(', ')})${h.hook ? `  ★ ${HOOKS[h.hook].title}` : ''}`);
  if (h.hook) L.push(`   훅: ${HOOKS[h.hook].text}`);
  for (const m of h.members) {
    const age = displayAge(m.stage, m.ageDays);
    const vs = [m.virtue ? `덕 ${m.virtue}` : '', m.sin ? `죄 ${m.sin}` : ''].filter(Boolean).join(' ');
    L.push(`   ${m.id!.padEnd(10)} ${m.name.padEnd(6, '　')} ${m.sex === 'male' ? '남' : '여'} ${STAGE_KO[m.stage]} ${String(m.ageDays).padStart(2)}일째(${age}세)  ` +
      `${(m.traits.join(',') || m.temperament || '-').padEnd(34)} ${careerKo(m).padEnd(28)} 일과 ${m.schedule}${vs ? '  ' + vs : ''}${m.estate ? `  개인신분 ${m.estate}` : ''}${m.lodger ? '  (투숙객)' : ''}`);
  }
  for (const r of h.relations.filter((r) => r.kind !== 'sibling' || r.flags)) {
    L.push(`   · ${r.kind} ${nameOf.get(r.a)}→${nameOf.get(r.b)} 우정 ${r.friendship} 로맨스 ${r.romance}${r.flags ? ' [' + r.flags.join(',') + ']' : ''}`);
  }
}
L.push('');
L.push('── 가문 사이 특별 관계 (친구/동료 제외) ──');
for (const x of town.ties.filter((x) => x.flags.some((f) => f !== 'friend' && f !== 'coworker') || x.flags.length === 0)) {
  L.push(`   ${nameOf.get(x.a)} ↔ ${nameOf.get(x.b)}  우정 ${x.friendship} 로맨스 ${x.romance} [${x.flags.join(',')}]`);
}
L.push(`   (그 밖 친구 ${town.ties.filter((x) => x.flags.includes('friend')).length}쌍, 동료 ${town.ties.filter((x) => x.flags.includes('coworker')).length}쌍)`);
L.push('');
L.push(`── 검사 ── 오류 ${errors.length}, 경고 ${warns.length}`);
for (const e of errors) L.push('  오류: ' + e);
for (const w of warns) L.push('  경고: ' + w);
fs.writeFileSync('artifacts/qa/m6/people-summary.txt', L.join('\n') + '\n');

console.log(`인구 ${s.total}, 가문 ${town.households.length}, ties ${town.ties.length}, 하위 시드 ${town.subSeed} (${tries}회), 일과표 ${Object.keys(templates).length}`);
console.log('신분', JSON.stringify(s.est), '나이', JSON.stringify(s.age));
if (warns.length) console.log(`경고 ${warns.length}:\n  ` + warns.join('\n  '));
if (errors.length) {
  console.error(`검사 오류 ${errors.length}:\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log('검사 통과');
