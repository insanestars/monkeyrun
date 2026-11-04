import { Save } from './save.js';
import { SKINS } from './monkey.js';
import { POWERUPS, UPGRADE_COSTS, MAX_UPGRADE } from './config.js';
import { formatNumber, clamp } from './utils.js';

export const BANANA_SVG = `<svg class="ico-banana" viewBox="0 0 64 64" aria-hidden="true"><path d="M10 14c-2 18 8 38 32 40 6 .5 11-1 13-3-14 1-30-8-34-26-1-5-1-9 0-12z" fill="#ffd23f" stroke="#7a4a00" stroke-width="3" stroke-linejoin="round"/><path d="M10 14c-1-3 0-6 3-7l2 6z" fill="#5a3a10"/><path d="M55 51c2-1 3-2 3-3" stroke="#5a3a10" stroke-width="4" stroke-linecap="round"/><path d="M18 22c3 14 14 24 28 27" stroke="#fff6b0" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".7"/></svg>`;

const PU_ICON = { magnet: '🧲', shield: '🛡️', double: '✖2', boost: '⚡' };
const $ = (id) => document.getElementById(id);

export class UI {
  constructor(game) {
    this.g = game;
    this.currentModal = null;
    this.toastQ = [];
    this.fx = $('fx');
    this.fxc = this.fx.getContext('2d');
    this.lines = [];
    this.last = {};
    this.resizeFx();
    document.querySelectorAll('.banana-slot').forEach((el) => (el.innerHTML = BANANA_SVG));

    const click = (id, fn) => $(id).addEventListener('click', (e) => {
      e.stopPropagation();
      this.g.audio.init();
      this.g.audio.resume();
      this.g.audio.play('click');
      fn();
    });
    click('btn-play', () => this.g.startRun());
    click('btn-shop', () => this.openModal('shop'));
    click('btn-missions', () => this.openModal('missions'));
    click('btn-help', () => this.openModal('help'));
    click('btn-settings', () => this.openModal('settings'));
    click('btn-pause', () => this.g.pause());
    click('btn-resume', () => this.g.resume());
    click('btn-restart', () => {
      this.hidePause();
      this.g.abandonRun();
      this.g.startRun();
    });
    click('btn-quit', () => {
      this.hidePause();
      this.g.abandonRun();
      this.g.toTitle();
    });
    click('btn-pause-settings', () => this.openModal('settings'));
    click('btn-again', () => this.g.startRun());
    click('btn-go-menu', () => this.g.toTitle());
    click('btn-go-shop', () => {
      this.g.toTitle();
      this.openModal('shop');
    });
    click('btn-revive', () => this.g.revive());
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.g.audio.play('click');
      this.closeModal();
    }));
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', (e) => {
      e.stopPropagation();
      this.g.audio.play('click');
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      $('shop-upgrades').classList.toggle('hidden', t.dataset.tab !== 'upgrades');
      $('shop-skins').classList.toggle('hidden', t.dataset.tab !== 'skins');
    }));
    // stop modal clicks from being treated as swipes/taps by the game
    document.querySelectorAll('.screen').forEach((s) => s.addEventListener('mousedown', (e) => e.stopPropagation()));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.currentModal && this.g.state === 'title') this.closeModal();
    });
  }

  show(id, on = true) {
    $(id).classList.toggle('show', on);
  }

  hideAll() {
    for (const id of ['loading', 'title', 'pause', 'gameover', 'shop', 'missions', 'settings', 'help']) this.show(id, false);
    $('hud').classList.add('hidden');
    this.currentModal = null;
  }

  loading(pct, text) {
    $('load-fill').style.width = pct + '%';
    $('load-text').textContent = text;
  }

  modalOpen() {
    return !!this.currentModal;
  }

  // ---- screens ---------------------------------------------------------------
  showTitle() {
    this.hideAll();
    this.show('title');
    const d = Save.data;
    $('t-bananas').textContent = formatNumber(d.bananas);
    $('t-best').textContent = formatNumber(d.best);
    $('t-mult').textContent = this.g.missions.multiplier;
    const skin = SKINS.find((s) => s.id === d.skin) || SKINS[0];
    $('t-skin').textContent = `${skin.name} the ${skin.species}`;
    clearTimeout(this.reviveTimer);
  }

  showHud() {
    this.hideAll();
    $('hud').classList.remove('hidden');
    $('fps').style.display = Save.data.settings.fps ? 'block' : 'none';
    $('tutorial').classList.remove('show');
    $('newbest').classList.remove('show');
  }

  showPause() {
    this.show('pause');
    this.renderMissionList($('pause-missions'));
  }

  hidePause() {
    this.show('pause', false);
    if (this.currentModal === 'settings') this.closeModal();
  }

  openModal(name) {
    if (this.currentModal) this.show(this.currentModal, false);
    this.currentModal = name;
    if (name === 'shop') this.renderShop();
    if (name === 'missions') this.renderMissions();
    if (name === 'settings') this.renderSettings();
    this.show(name);
    $('title').classList.toggle('dim', true);
  }

  closeModal() {
    if (!this.currentModal) return;
    this.show(this.currentModal, false);
    if (this.currentModal === 'shop') {
      // revert any un-owned preview
      this.g.setSkin(Save.data.skin);
    }
    this.currentModal = null;
    $('title').classList.remove('dim');
    if (this.g.state === 'title') this.showTitle();
  }

  countdown(n) {
    const el = $('countdown');
    if (n === null) {
      el.classList.remove('show');
      return;
    }
    el.textContent = n;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  showGameOver(info) {
    $('hud').classList.add('hidden');
    this.show('gameover');
    $('go-title').textContent = info.title;
    $('go-cause').textContent = info.sub;
    $('go-newbest').style.display = info.newBest ? 'block' : 'none';
    $('go-dist').textContent = formatNumber(info.dist) + ' m';
    $('go-bananas').innerHTML = BANANA_SVG + ' ' + formatNumber(info.bananas);
    $('go-mult').textContent = 'x' + info.mult;
    $('go-best').textContent = formatNumber(info.best);
    $('go-wallet').innerHTML = BANANA_SVG + ' ' + formatNumber(Save.data.bananas);
    this.renderMissionList($('go-missions'));
    // count the score up
    const el = $('go-score');
    const t0 = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / 900);
      el.textContent = formatNumber(info.score * (1 - Math.pow(1 - k, 3)));
      if (k < 1 && this.g.state === 'over') requestAnimationFrame(tick);
    };
    tick();
    const rv = $('go-revive');
    clearTimeout(this.reviveTimer);
    if (info.canRevive) {
      rv.style.display = 'flex';
      $('revive-cost').textContent = formatNumber(info.reviveCost);
      const fill = $('revive-fill');
      fill.style.transition = 'none';
      fill.style.width = '100%';
      void fill.offsetWidth;
      fill.style.transition = 'width 6s linear';
      fill.style.width = '0%';
      this.reviveTimer = setTimeout(() => (rv.style.display = 'none'), 6000);
    } else rv.style.display = 'none';
    if (info.newBest) this.g.audio.play('record');
  }

  // ---- HUD -------------------------------------------------------------------------
  frame(dt) {
    const g = this.g;
    if (g.state === 'play' || g.state === 'countdown' || g.state === 'paused' || g.state === 'intro') {
      const s = g.stats;
      this.set('h-score', formatNumber(s.score));
      this.set('h-dist', formatNumber(g.p.dist));
      this.set('h-best', formatNumber(Math.max(Save.data.best, s.score)));
      this.set('h-bananas', formatNumber(s.bananas));
      this.set('h-mult', 'x' + g.mult * (g.pu.double > 0 ? 2 : 1));
      $('h-mult').classList.toggle('doubled', g.pu.double > 0);
      // power-up bars
      let html = '';
      for (const k of ['boost', 'magnet', 'double', 'shield']) {
        if (g.pu[k] > 0) {
          const f = clamp(g.pu[k] / g.puMax[k], 0, 1);
          html += `<div class="pu" style="--c:${POWERUPS[k].color}"><span class="pu-ico">${PU_ICON[k]}</span><div class="pu-bar"><div style="width:${(f * 100).toFixed(1)}%"></div></div></div>`;
        }
      }
      if (html !== this.last.pu) {
        $('h-powerups').innerHTML = html;
        this.last.pu = html;
      }
      if (Save.data.settings.fps) this.set('fps', g.fps + ' fps');
    }
    this.drawFx(dt);
  }

  set(id, text) {
    if (this.last[id] === text) return;
    this.last[id] = text;
    $(id).textContent = text;
  }

  bumpBananas() {
    const el = $('h-bananas').parentElement;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  toast(text, kind = '', color) {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    if (color) el.style.setProperty('--c', color);
    el.textContent = text;
    const box = $('toasts');
    while (box.children.length >= 3) box.firstChild.remove();
    box.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2200);
    setTimeout(() => el.remove(), 2700);
  }

  banner(title, sub) {
    const b = $('banner');
    b.querySelector('.b-title').textContent = title;
    b.querySelector('.b-sub').textContent = sub;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  tutorial(html) {
    const el = $('tutorial');
    el.innerHTML = html;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  newBest() {
    const el = $('newbest');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // ---- full-screen FX overlay: speed lines, danger and rush vignette -----------------
  resizeFx() {
    const dpr = Math.min(window.devicePixelRatio, 1.5);
    this.fx.width = window.innerWidth * dpr;
    this.fx.height = window.innerHeight * dpr;
    this.fxScale = dpr;
  }

  drawFx(dt) {
    const g = this.g;
    const c = this.fxc;
    const W = this.fx.width, H = this.fx.height;
    c.clearRect(0, 0, W, H);
    if (!g.p || (g.state !== 'play' && g.state !== 'dying')) return;
    const sf = clamp((g.p.speed - 22) / 13, 0, 1);
    const boost = g.pu.boost > 0;
    const intensity = boost ? 1 : sf * 0.6;
    // speed lines
    if (intensity > 0.02 && g.state === 'play') {
      const n = Math.floor(intensity * 5);
      for (let i = 0; i < n; i++) this.lines.push({ a: Math.random() * Math.PI * 2, r: 0.25 + Math.random() * 0.2, v: 1.5 + Math.random() * 2, life: 0 });
    }
    const cx = W / 2, cy = H * 0.45;
    const R = Math.hypot(W, H) * 0.6;
    c.lineCap = 'round';
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      l.life += dt;
      l.r += l.v * dt;
      if (l.r > 1.2) {
        this.lines.splice(i, 1);
        continue;
      }
      const r0 = l.r * R, r1 = (l.r + 0.12) * R;
      c.strokeStyle = boost ? `rgba(220,190,255,${0.35 * (1 - l.r)})` : `rgba(255,255,255,${0.22 * (1 - l.r)})`;
      c.lineWidth = 2 * this.fxScale;
      c.beginPath();
      c.moveTo(cx + Math.cos(l.a) * r0, cy + Math.sin(l.a) * r0);
      c.lineTo(cx + Math.cos(l.a) * r1, cy + Math.sin(l.a) * r1);
      c.stroke();
    }
    // danger vignette when the guardian is close
    const danger = g.chase.timer > 0 ? clamp(1 - (g.chase.gap - 3) / 8, 0, 1) : 0;
    if (danger > 0.01 || boost) {
      const grad = c.createRadialGradient(cx, H / 2, Math.min(W, H) * 0.35, cx, H / 2, Math.max(W, H) * 0.75);
      const pulse = 0.5 + 0.5 * Math.sin(g.time * 8);
      const col = boost ? `rgba(150,90,255,${0.35})` : `rgba(200,20,10,${(0.25 + pulse * 0.2) * danger})`;
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, col);
      c.fillStyle = grad;
      c.fillRect(0, 0, W, H);
    }
  }

  // ---- missions ----------------------------------------------------------------------
  renderMissionList(el) {
    const m = this.g.missions;
    el.innerHTML = m.active.map((ms) => {
      const f = clamp(ms.progress / ms.target, 0, 1);
      return `<div class="mission ${ms.done ? 'done' : ''}">
        <div class="m-check">${ms.done ? '✔' : ''}</div>
        <div class="m-body"><div class="m-text">${m.text(ms)}</div>
        <div class="m-bar"><div style="width:${(f * 100).toFixed(1)}%"></div></div>
        <div class="m-prog">${formatNumber(ms.progress)} / ${formatNumber(ms.target)}</div></div>
      </div>`;
    }).join('');
  }

  renderMissions() {
    $('m-mult').textContent = 'x' + this.g.missions.multiplier;
    $('m-level').textContent = Save.data.missionLevel;
    this.renderMissionList($('missions-list'));
    const d = Save.data;
    $('m-stats').innerHTML = `
      <div><span>Runs</span><b>${formatNumber(d.runs)}</b></div>
      <div><span>Best score</span><b>${formatNumber(d.best)}</b></div>
      <div><span>Longest run</span><b>${formatNumber(d.bestDistance)} m</b></div>
      <div><span>Total distance</span><b>${formatNumber(d.totalDistance)} m</b></div>
      <div><span>Bananas collected</span><b>${formatNumber(d.totalBananas)}</b></div>
      <div><span>Golden bananas</span><b>${formatNumber(d.totalGolden)}</b></div>`;
  }

  // ---- shop --------------------------------------------------------------------------
  renderShop() {
    const d = Save.data;
    $('shop-bananas').textContent = formatNumber(d.bananas);
    const up = $('shop-upgrades');
    up.innerHTML = Object.entries(POWERUPS).map(([k, def]) => {
      const lvl = d.upgrades[k] || 0;
      const max = lvl >= MAX_UPGRADE;
      const cost = UPGRADE_COSTS[lvl];
      const dur = def.base + def.perLevel * lvl;
      const pips = Array.from({ length: MAX_UPGRADE }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      return `<div class="card" style="--c:${def.color}">
        <div class="card-ico">${PU_ICON[k]}</div>
        <div class="card-body"><div class="card-title">${def.name}</div><div class="card-desc">${def.desc}</div>
        <div class="pips">${pips}</div><div class="card-desc">Duration: <b>${dur.toFixed(1)}s</b>${max ? '' : ` → ${(dur + def.perLevel).toFixed(1)}s`}</div></div>
        <button class="btn small ${max ? 'disabled' : d.bananas >= cost ? 'gold' : 'disabled'}" data-up="${k}">${max ? 'MAX' : BANANA_SVG + ' ' + formatNumber(cost)}</button>
      </div>`;
    }).join('');
    up.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = b.dataset.up;
      const lvl = d.upgrades[k] || 0;
      if (lvl >= MAX_UPGRADE) return;
      const cost = UPGRADE_COSTS[lvl];
      if (d.bananas < cost) return this.g.audio.play('error');
      d.bananas -= cost;
      d.upgrades[k] = lvl + 1;
      Save.save();
      this.g.audio.play('buy');
      this.renderShop();
    }));
    const sk = $('shop-skins');
    sk.innerHTML = SKINS.map((s) => {
      const owned = d.skins.includes(s.id);
      const eq = d.skin === s.id;
      const hex = (n) => '#' + n.toString(16).padStart(6, '0');
      const label = eq ? 'EQUIPPED' : owned ? 'EQUIP' : BANANA_SVG + ' ' + formatNumber(s.price);
      const cls = eq ? 'disabled' : owned ? 'primary' : d.bananas >= s.price ? 'gold' : 'disabled';
      return `<div class="card skin ${eq ? 'equipped' : ''}" data-preview="${s.id}">
        <div class="avatar" style="--fur:${hex(s.fur)};--face:${hex(s.face)};--ear:${hex(s.ear)}"><div class="a-ear l"></div><div class="a-ear r"></div><div class="a-head"><div class="a-face"><div class="a-eye l"></div><div class="a-eye r"></div><div class="a-muzzle"></div></div></div>${s.acc.includes('crown') ? '<div class="a-crown">👑</div>' : ''}${s.acc.includes('fedora') ? '<div class="a-hat"></div>' : ''}${s.acc.includes('headband') ? '<div class="a-band"></div>' : ''}</div>
        <div class="card-body"><div class="card-title">${s.name}</div><div class="card-sub">${s.species}</div><div class="card-desc">${s.desc}</div></div>
        <button class="btn small ${cls}" data-skin="${s.id}">${label}</button>
      </div>`;
    }).join('');
    sk.querySelectorAll('[data-preview]').forEach((c) => c.addEventListener('click', () => {
      this.g.setSkin(c.dataset.preview);
      sk.querySelectorAll('.card').forEach((x) => x.classList.toggle('previewing', x === c));
    }));
    sk.querySelectorAll('[data-skin]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = b.dataset.skin;
      const s = SKINS.find((x) => x.id === id);
      if (d.skin === id) return;
      if (!d.skins.includes(id)) {
        if (d.bananas < s.price) return this.g.audio.play('error');
        d.bananas -= s.price;
        d.skins.push(id);
        this.g.audio.play('buy');
      } else this.g.audio.play('click');
      d.skin = id;
      Save.save();
      this.g.setSkin(id);
      this.renderShop();
    }));
  }

  // ---- settings ------------------------------------------------------------------------
  renderSettings() {
    const s = Save.data.settings;
    const el = $('settings-body');
    const toggle = (key, label) => `<label class="toggle"><span>${label}</span><input type="checkbox" data-set="${key}" ${s[key] ? 'checked' : ''}><i></i></label>`;
    el.innerHTML = `
      ${toggle('music', 'Music')}
      ${toggle('sfx', 'Sound effects')}
      ${toggle('shake', 'Camera shake')}
      ${toggle('fps', 'Show FPS')}
      <div class="setting-row"><span>Graphics</span>
        <div class="seg">${['low', 'medium', 'high'].map((q) => `<button data-q="${q}" class="${s.quality === q ? 'active' : ''}">${q}</button>`).join('')}</div>
      </div>
      <div class="note">Changing graphics quality reloads the game.</div>
      <button class="btn small danger" id="btn-reset">Reset all progress</button>`;
    el.querySelectorAll('[data-set]').forEach((inp) => inp.addEventListener('change', () => {
      s[inp.dataset.set] = inp.checked;
      Save.save();
      this.g.audio.setMusic(s.music);
      this.g.audio.setSfx(s.sfx);
      $('fps').style.display = s.fps ? 'block' : 'none';
    }));
    el.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (s.quality === b.dataset.q) return;
      s.quality = b.dataset.q;
      Save.save();
      location.reload();
    }));
    // two-step confirmation built into the button (no browser dialogs)
    const reset = $('btn-reset');
    reset.addEventListener('click', (e) => {
      e.stopPropagation();
      if (reset.dataset.armed) {
        Save.reset();
        location.reload();
        return;
      }
      reset.dataset.armed = '1';
      reset.textContent = 'Tap again to erase everything';
      this.g.audio.play('error');
      setTimeout(() => {
        delete reset.dataset.armed;
        reset.textContent = 'Reset all progress';
      }, 3000);
    });
  }
}
