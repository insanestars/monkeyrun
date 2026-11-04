import { Game } from './game.js';

const fill = document.getElementById('load-fill');
const text = document.getElementById('load-text');

function progress(pct, msg) {
  fill.style.width = pct + '%';
  text.textContent = msg;
}

const game = new Game();
game.init(progress).catch((err) => {
  console.error(err);
  text.textContent = 'Something went wrong: ' + err.message + ' (WebGL is required)';
  text.style.color = '#ff8a80';
});
