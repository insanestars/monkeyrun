// ---------------------------------------------------------------------------
// Keyboard + swipe (touch or mouse drag) input, emitting discrete actions:
// left, right, up, down, pause
// ---------------------------------------------------------------------------
export class Input {
  constructor(target) {
    this.handlers = [];
    this.enabled = true;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const map = {
        ArrowLeft: 'left', KeyA: 'left',
        ArrowRight: 'right', KeyD: 'right',
        ArrowUp: 'up', KeyW: 'up', Space: 'up',
        ArrowDown: 'down', KeyS: 'down',
        Escape: 'pause', KeyP: 'pause',
        Enter: 'confirm',
      };
      const a = map[e.code];
      if (a) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
        this.emit(a);
      }
    });
    // swipes fire as soon as the finger has travelled far enough
    let sx = 0, sy = 0, active = false, fired = false;
    const TH = 28;
    const down = (x, y) => {
      sx = x; sy = y; active = true; fired = false;
    };
    const move = (x, y) => {
      if (!active || fired) return;
      const dx = x - sx, dy = y - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < TH) return;
      fired = true;
      if (Math.abs(dx) > Math.abs(dy)) this.emit(dx > 0 ? 'right' : 'left');
      else this.emit(dy > 0 ? 'down' : 'up');
    };
    const up = () => {
      if (active && !fired) this.emit('tap');
      active = false;
    };
    // menus (panels) keep native scrolling; everywhere else touches are swipes
    const inPanel = (e) => e.target && e.target.closest && e.target.closest('.panel');
    target.addEventListener('touchstart', (e) => {
      if (inPanel(e)) return;
      const t = e.changedTouches[0];
      down(t.clientX, t.clientY);
    }, { passive: true });
    target.addEventListener('touchmove', (e) => {
      if (inPanel(e)) return;
      const t = e.changedTouches[0];
      move(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    target.addEventListener('touchend', up, { passive: true });
    target.addEventListener('mousedown', (e) => down(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
    window.addEventListener('mouseup', up);
  }

  on(fn) {
    this.handlers.push(fn);
  }

  emit(a) {
    if (!this.enabled) return;
    for (const h of this.handlers) h(a);
  }
}
