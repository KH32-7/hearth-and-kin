/**
 * 새 게임 흐름을 띄울지 (27-1). 주소에 명시 인자(?town= ?lot= ?preset=)가 없거나 ?new=1 이면 띄움. ?new=0 이면 바로 마을.
 * Pages 배포판(VITE_DEFAULT_TOWN=ashford, 인자 없음)은 새 게임 흐름. 기존 E2E 는 helpers.openGame 이 ?new=0 을 붙임.
 * 새 게임은 마을이 애쉬포드 하나 → 주소에 마을이 없으면 ashford (HearthGame.loadTown).
 */
export function wantsNewGame(search: string = typeof location !== 'undefined' ? location.search : ''): boolean {
  const q = new URLSearchParams(search);
  const n = q.get('new');
  if (n === '1') return true;
  if (n === '0') return false;
  return !['town', 'lot', 'preset'].some((k) => q.has(k));
}

export const NEW_GAME_TOWN = 'ashford';
