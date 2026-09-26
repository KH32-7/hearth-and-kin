import './styles.css';
import { HearthGame } from './game/HearthGame';

const app = document.querySelector<HTMLElement>('#app')!;
const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')!;
const game = new HearthGame(app, canvas);
game.start().catch((e) => {
  console.error(e);
  game.errors.push(String(e));
});
