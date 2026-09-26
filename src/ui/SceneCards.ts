/**
 * 차단 장면 연결 (27-7, 24-1, 18-6): 조작 가문에게 온 사건 카드와 재판을 장면 카드(ChoiceCard, 양피지 판)로.
 * 고르면 의도: 사건 카드 = cardChoice, 재판 = society trialPlea / kinPetition / kinBribe / trialAdvance.
 * 고르지 않으면 sim 이 시간이 지나 스스로 고름 (소프트락 없음)
 */
import { t } from '../i18n';
import type { Snapshot } from '../sim/protocol';
import type { ChoiceCard, ChoiceOption } from './ChoiceCard';

export interface SceneHooks {
  intent(i: Record<string, unknown>): Promise<unknown>;
  bust(id: number): HTMLCanvasElement | null;
  select(id: number): void;
}

const PLEAS = ['mercy', 'argue', 'witness', 'bribe', 'silent'] as const;

/** 보여 줄 장면이 있으면 띄우고 true */
export function showScene(s: Snapshot, card: ChoiceCard, h: SceneHooks): boolean {
  const H = s.house;
  if (!H) return false;
  const c = H.cards[0];
  if (c) {
    const who = s.persons.find((p) => p.id === c.personId);
    const other = c.otherId ? s.persons.find((p) => p.id === c.otherId) : undefined;
    const vars: Record<string, string | number> = { name: who?.name ?? '', a: who?.name ?? '', b: other?.name ?? '', ...c.vars };
    const opts: ChoiceOption[] = c.options.map((o) => ({ id: String(o.n), nameKey: o.textKey, descKey: '', icon: 'ui.crest' }));
    card.show(`card:${c.seq}`, t(c.titleKey, vars), c.bodyKey ? t(c.bodyKey, vars) : '', opts, (id) => void h.intent({ kind: 'cardChoice', seq: c.seq, option: Number(id) }), {
      portrait: who ? h.bust(who.id) : null,
      other: other ? h.bust(other.id) : null,
      speaker: who?.name,
    });
    return true;
  }
  const tr = H.trial;
  if (tr && !tr.verdict && tr.stage !== 'pending' && tr.stage !== 'done') {
    const acc = s.persons.find((p) => p.id === tr.accused);
    const judge = s.persons.find((p) => p.id === tr.judge);
    const body = tr.lines.map((l) => t(l.key, l.args)).join(' ');
    let opts: ChoiceOption[];
    let pick: (id: string) => void;
    if (tr.stage === 'plea' && acc?.household === 1) {
      opts = PLEAS.map((k) => ({ id: k, nameKey: `trial.plea.${k}`, descKey: '', icon: 'ui.crest' }));
      pick = (id) => void h.intent({ kind: 'society', op: 'trialPlea', args: { trial: tr.id, option: id } });
    } else if (tr.stage === 'kin') {
      const kin = s.persons.find((p) => p.household === 1 && p.id !== tr.accused && !p.hidden && p.lifeStage !== 'baby' && p.lifeStage !== 'toddler');
      opts = [
        ...(kin ? [{ id: 'petition', nameKey: 'trial.kin.petition', descKey: '', icon: 'ui.crest' }, { id: 'bribe', nameKey: 'trial.kin.bribe', descKey: '', icon: 'ui.crest' }] : []),
        { id: 'next', nameKey: 'trial.stage.verdict', descKey: '', icon: 'ui.crest' },
      ];
      pick = (id) => {
        if (id === 'petition' && kin) void h.intent({ kind: 'society', op: 'kinPetition', args: { trial: tr.id, by: kin.id } });
        else if (id === 'bribe' && kin) void h.intent({ kind: 'society', op: 'kinBribe', args: { trial: tr.id, by: kin.id } });
        else void h.intent({ kind: 'society', op: 'trialAdvance', args: { trial: tr.id } });
      };
    } else {
      opts = [{ id: 'next', nameKey: `trial.stage.${tr.stage}`, descKey: '', icon: 'ui.crest' }];
      pick = () => void h.intent({ kind: 'society', op: 'trialAdvance', args: { trial: tr.id } });
    }
    card.show(`trial:${tr.id}:${tr.stage}:${tr.lines.length}`, t('trial.title'), body || t(`crime.${tr.crime}`), opts, pick, {
      portrait: acc ? h.bust(acc.id) : null,
      other: judge ? h.bust(judge.id) : null,
      speaker: judge?.name,
    });
    return true;
  }
  return false;
}
