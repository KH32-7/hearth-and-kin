/**
 * 생애와 가족 (M7~M9) 데이터 파일 목록: 키 → src/data 아래 파일 이름.
 * 게임(HearthGame, import.meta.glob)과 도구(tools/data-node.ts)가 같은 목록으로 SimData.family 를 채움. 없는 파일은 빠짐
 */
export const FAMILY_FILES: Record<string, string> = {
  genetics: 'genetics.json',
  pregnancy: 'pregnancy.json',
  deathRules: 'death_rules.json',
  lifecycle: 'lifecycle.json',
  childcare: 'childcare.json',
  names: 'names.json',
  clanNames: 'clan_names.json',
  heraldry: 'heraldry.json',
  events: 'events/family_society.json',
  letters: 'letters.json',
  moodletsM7: 'moodlets_m7.json',
  moodletsM7b: 'moodlets_m7b.json',
  thoughtsM7: 'thoughts_m7.json',
  wishesM7: 'wishes_m7.json',
  estates: 'estates.json',
  startPresets: 'start_presets.json',
  sumptuary: 'sumptuary.json',
  houses: 'clans.json',
  society: 'society.json',
  courtship: 'courtship.json',
  justice: 'justice.json',
  policy: 'policy.json',
};
