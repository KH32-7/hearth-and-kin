import './styles.css';
import { HearthGame } from './game/HearthGame';
import { NewGameFlow } from './ui/NewGame';
import { wantsNewGame } from './ui/newGameMode';
import { loadSkin } from './ui/skin';

const app = document.querySelector<HTMLElement>('#app')!;
const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')!;
const game = new HearthGame(app, canvas);
// 새 게임 흐름 (27-1): 게임은 뒤에서 불러오고 타이틀이 위를 덮음. 스킨(아이콘)은 먼저 올림
if (wantsNewGame()) {
  const flow = new NewGameFlow(app, game);
  game.onMenu = (a) => flow.menu(a);
  void loadSkin(game.assets).catch(() => undefined).finally(() => flow.showTitle());
}
game.start().catch((e) => {
  console.error(e);
  game.errors.push(String(e));
});
