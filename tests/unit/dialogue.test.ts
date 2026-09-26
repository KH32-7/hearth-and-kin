/**
 * 대사창 규칙 문장 (GDD 27-13): 상호작용 전부 풀림, 결정론, 구체성 우선, 대체 풀, 문장 검사
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  pickLine,
  pickOneliner,
  pickScene,
  relationTier,
  registersOf,
  dialogueTextProblems,
  TIERS,
  type DialogueData,
  type DialogueEntry,
  type PickCtx,
} from '../../src/ui/dialogue/pickLine';

const data = JSON.parse(readFileSync('src/data/dialogue.json', 'utf8')) as DialogueData;
const ko = JSON.parse(readFileSync('src/i18n/ko/dialogue.json', 'utf8')) as Record<string, string>;
const social = JSON.parse(readFileSync('src/data/social.json', 'utf8')).interactions as Record<string, { category: string }>;
const ESTATES = ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'];

const ctx = (over: Partial<PickCtx> & { ia: string }): PickCtx => ({
  ok: true,
  speaker: { traits: [], estate: 'freeman', emotion: 'neutral' },
  listener: { traits: [], estate: 'freeman' },
  tier: 'acquaintance',
  topic: null,
  ...over,
});

const allEntries = (): { where: string; e: DialogueEntry; allowB: boolean }[] => {
  const out: { where: string; e: DialogueEntry; allowB: boolean }[] = [];
  for (const [id, d] of Object.entries(data.interactions)) for (const o of ['ok', 'fail'] as const) for (const e of d[o] ?? []) out.push({ where: `${id}.${o}`, e, allowB: true });
  for (const [c, d] of Object.entries(data.categories)) for (const o of ['ok', 'fail'] as const) for (const e of d[o] ?? []) out.push({ where: `cat.${c}.${o}`, e, allowB: true });
  for (const [s, arr] of Object.entries(data.oneliners)) for (const e of arr) out.push({ where: `one.${s}`, e, allowB: false });
  for (const [s, sc] of Object.entries(data.scenes)) for (const e of sc.lines) out.push({ where: `scene.${s}`, e, allowB: true });
  return out;
};

describe('대사창 규칙 문장 데이터', () => {
  it('사회 상호작용 87개 모두 자기 항목이 있고 category 가 같음', () => {
    const ids = Object.keys(social);
    expect(ids.length).toBe(87);
    for (const id of ids) {
      expect(data.interactions[id], id).toBeDefined();
      expect(data.interactions[id].category, id).toBe(social[id].category);
    }
  });

  it('어떤 관계·신분·결과로도 모든 상호작용이 한 줄로 풀리고 키가 ko 에 있음', () => {
    for (const ia of Object.keys(social)) {
      for (const ok of [true, false]) {
        for (const tier of TIERS) {
          for (const estate of ESTATES) {
            const line = pickLine(data, ctx({ ia, ok, tier, speaker: { traits: ['kind'], estate, emotion: 'neutral' } }), 7);
            expect(line, `${ia} ${ok} ${tier} ${estate}`).not.toBeNull();
            for (const k of [line!.act, line!.say, line!.reply].filter(Boolean) as string[]) expect(ko[k], k).toBeTypeOf('string');
          }
        }
      }
    }
  });

  it('로맨스·짓궂음·특수와 자주 쓰는 친근 상호작용은 ok/fail 각각 자기 문장 3개 이상', () => {
    const common = ['social.greet', 'social.chat', 'social.joke', 'social.compliment', 'social.hug', 'social.give_gift', 'social.deep_talk', 'social.listen_troubles', 'social.pray_together', 'social.share_ale'];
    for (const [id, d] of Object.entries(data.interactions)) {
      if (!['romance', 'mean', 'special'].includes(d.category) && !common.includes(id)) continue;
      expect(d.ok?.length ?? 0, `${id}.ok`).toBeGreaterThanOrEqual(3);
      expect(d.fail?.length ?? 0, `${id}.fail`).toBeGreaterThanOrEqual(3);
    }
  });

  it('문장 수 600줄 이상 (지문 + 대사 + 대답)', () => {
    const n = allEntries().reduce((s, { e }) => s + 2 + (e.reply ? 1 : 0), 0);
    expect(n).toBeGreaterThanOrEqual(600);
  });

  it('모든 문장이 검사 통과: 자리표시, 숫자, 이모지, 사극체, 번역투, 쉼표, 지문 어미', () => {
    const bad: string[] = [];
    for (const { where, e, allowB } of allEntries()) {
      const pairs: [string, 'act' | 'say'][] = [[e.act, 'act'], [e.say, 'say']];
      if (e.reply) pairs.push([e.reply, 'say']);
      for (const [k, kind] of pairs) {
        const s = ko[k];
        if (s === undefined) bad.push(`${where}: ${k} 없음`);
        else for (const p of dialogueTextProblems(s, kind, allowB)) bad.push(`${k}: ${p}`);
      }
    }
    for (const sc of Object.values(data.scenes)) for (const c of sc.choices) for (const p of dialogueTextProblems(ko[c.textKey] ?? '', 'say', false)) bad.push(`${c.textKey}: ${p}`);
    expect(bad).toEqual([]);
  });

  it('문장 검사가 금지 표현을 실제로 잡음', () => {
    expect(dialogueTextProblems('그대는 어디 가오?', 'say').join()).toMatch(/사극/);
    expect(dialogueTextProblems('내 말을 들으시오. 그리하였소.', 'say').join()).toMatch(/사극/);
    expect(dialogueTextProblems('허기가 지는구려.', 'say').join()).toMatch(/사극/);
    expect(dialogueTextProblems('농사에 대해 이야기해요.', 'say').join()).toMatch(/번역투/);
    expect(dialogueTextProblems('빵 3개 주세요.', 'say').join()).toMatch(/숫자/);
    expect(dialogueTextProblems('좋아요 😀', 'say').join()).toMatch(/이모지/);
    expect(dialogueTextProblems('{a}가 웃는다.', 'act').join()).toMatch(/조사/);
    expect(dialogueTextProblems('{c}이(가) 웃는다.', 'act').join()).toMatch(/자리표시/);
    expect(dialogueTextProblems('{a}이(가) 웃었다', 'act').length).toBeGreaterThan(0);
    // 허용: 귀족 하게체, ~시오, 그대로
    expect(dialogueTextProblems('받아 두게. 그대로 하시오.', 'say')).toEqual([]);
    expect(dialogueTextProblems('{a}이(가) {b}의 손을 잡는다.', 'act')).toEqual([]);
  });
});

describe('pickLine', () => {
  it('결정론: 같은 입력과 seed 면 같은 문장, seed 가 바뀌면 여러 문장이 나옴', () => {
    const c = ctx({ ia: 'social.chat' });
    expect(pickLine(data, c, 123)).toEqual(pickLine(data, c, 123));
    const seen = new Set<string>();
    for (let s = 0; s < 60; s++) seen.add(pickLine(data, c, s)!.say);
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('조건이 더 많이 맞는 항목을 먼저 고름 (특성 > 일반)', () => {
    const c = ctx({ ia: 'social.chat', speaker: { traits: ['bookworm'], estate: 'freeman', emotion: 'neutral' } });
    for (let s = 0; s < 30; s++) {
      const e = data.interactions['social.chat'].ok!.find((x) => x.say === pickLine(data, c, s)!.say)!;
      expect(e.when?.speakerTraits).toContain('bookworm');
    }
  });

  it('조건 두 개가 맞는 항목이 한 개 맞는 항목보다 우선 (주제 + 신분 말투)', () => {
    const c = ctx({ ia: 'social.chat', topic: 'food', speaker: { traits: [], estate: 'serf', emotion: 'neutral' } });
    for (let s = 0; s < 20; s++) {
      const picked = pickLine(data, c, s)!;
      expect(ko[picked.say]).toContain('배고파 죽겠네');
    }
    const noble = pickLine(data, ctx({ ia: 'social.chat', topic: 'food', speaker: { traits: [], estate: 'noble', emotion: 'neutral' } }), 1)!;
    expect(ko[noble.say]).toContain('허기가 지는군');
  });

  it('관계 단계에 맞는 문장 (가족 포옹, 배우자 입맞춤)', () => {
    const hug = pickLine(data, ctx({ ia: 'social.hug', tier: 'family' }), 5)!;
    const e = data.interactions['social.hug'].ok!.find((x) => x.act === hug.act)!;
    expect(e.when?.tier).toContain('family');
    const kiss = pickLine(data, ctx({ ia: 'social.kiss', tier: 'spouse' }), 9)!;
    expect(data.interactions['social.kiss'].ok!.find((x) => x.act === kiss.act)!.when?.tier).toContain('spouse');
  });

  it('조건이 어긋나는 항목은 절대 나오지 않음', () => {
    for (let s = 0; s < 50; s++) {
      const line = pickLine(data, ctx({ ia: 'social.chat', tier: 'stranger' }), s)!;
      const e = data.interactions['social.chat'].ok!.find((x) => x.act === line.act)!;
      expect(e.when?.tier ?? ['stranger']).toContain('stranger');
    }
  });

  it('자기 풀이 없으면 분류 공용 풀, 모르는 상호작용은 basic 풀', () => {
    const trimmed: DialogueData = { ...data, interactions: { ...data.interactions, 'social.glance': { category: 'romance' } } };
    const g = pickLine(trimmed, ctx({ ia: 'social.glance' }), 3)!;
    expect(g.act.startsWith('dlg.cat.romance.ok.')).toBe(true);
    const u = pickLine(data, ctx({ ia: 'social.unknown_thing', ok: false }), 3)!;
    expect(u.act.startsWith('dlg.cat.basic.fail.')).toBe(true);
    // 자기 풀 항목이 모두 조건 불일치면 분류 풀로 내려감
    const onlySpecific: DialogueData = {
      ...data,
      interactions: { ...data.interactions, 'social.glance': { category: 'romance', ok: [{ act: 'a', say: 'b', when: { tier: ['enemy'] } }] } },
    };
    expect(pickLine(onlySpecific, ctx({ ia: 'social.glance', tier: 'friend' }), 1)!.act.startsWith('dlg.cat.romance.ok.')).toBe(true);
    expect(pickLine({ ...data, categories: {} , interactions: {} }, ctx({ ia: 'x' }), 1)).toBeNull();
  });

  it('relationTier: 배우자 > 연인 > 원수/경쟁자 > 가족 > 절친 > 친구 > 아는 사이 > 처음', () => {
    expect(relationTier(null, false, false)).toBe('stranger');
    expect(relationTier({ name: 'stranger', flags: [] }, false, false)).toBe('stranger');
    expect(relationTier({ name: 'acquaintance', flags: [] }, false, false)).toBe('acquaintance');
    expect(relationTier({ name: 'friend', flags: [] }, false, false)).toBe('friend');
    expect(relationTier({ name: 'best_friend', flags: [] }, false, false)).toBe('bestFriend');
    expect(relationTier({ name: 'friend', flags: [] }, true, false)).toBe('family');
    expect(relationTier({ name: 'enemy', flags: [] }, true, false)).toBe('enemy');
    expect(relationTier({ name: 'rival', flags: [] }, false, false)).toBe('rival');
    expect(relationTier({ name: 'lover', flags: ['lover'] }, false, false)).toBe('lover');
    expect(relationTier({ name: 'engaged', flags: ['engaged'] }, false, false)).toBe('lover');
    expect(relationTier({ name: 'friend', flags: [] }, true, true)).toBe('spouse');
    expect(relationTier({ name: 'spouse', flags: ['spouse'] }, false, false)).toBe('spouse');
  });

  it('신분 말투: 성직자는 clergy 이면서 high', () => {
    expect(registersOf('serf')).toEqual(['low']);
    expect(registersOf('merchant')).toEqual(['mid']);
    expect(registersOf('noble')).toEqual(['high']);
    expect(registersOf('clergy')).toEqual(['clergy', 'high']);
  });
});

describe('한마디와 장면', () => {
  it('한마디: 아이는 아이 말투, 농민/귀족 배고픔 말투가 다름', () => {
    const child = pickOneliner(data, 'need.hunger', { traits: [], estate: 'serf', stage: 'child' }, 1)!;
    // 아이(stage) 와 농민(register) 이 동점이면 둘 중 하나. 아이만 조건이면 아이 문장
    expect(['배고파요! 밥 언제 먹어요?', '배고파 죽겠네. 뭐 먹을 거 없나?']).toContain(ko[child.say]);
    const noble = pickOneliner(data, 'need.hunger', { traits: [], estate: 'noble', stage: 'adult' }, 1)!;
    expect(ko[noble.say]).toContain('허기가 지는군');
    const news = pickOneliner(data, 'child_news', { traits: [], estate: 'freeman', stage: 'child' }, 4)!;
    expect(ko[news.act]).toMatch(/뛰|달려|눈을/);
    expect(pickOneliner(data, 'no_such', { traits: [], estate: 'serf' }, 1)).toBeNull();
    for (const s of Object.keys(data.oneliners)) expect(pickOneliner(data, s, { traits: [], estate: 'freeman', stage: 'adult' }, 2), s).not.toBeNull();
  });

  it('청혼 장면: 제목 + 지문/대사 + 선택지 셋 (승낙 / 집안에 미룸 / 시간 청함)', () => {
    const sc = pickScene(data, 'propose', { traits: [], estate: 'freeman' }, 'lover', 1)!;
    expect(ko[sc.titleKey]).toBe('청혼');
    expect(sc.choices.map((c) => c.id)).toEqual(['accept', 'family', 'time']);
    for (const c of sc.choices) expect(ko[c.textKey]).toBeTypeOf('string');
    expect(ko[sc.line.act]).toBeTypeOf('string');
    const low = pickScene(data, 'propose', { traits: [], estate: 'serf' }, 'lover', 1)!;
    expect(ko[low.line.say]).toContain('나랑 살자');
  });
});
