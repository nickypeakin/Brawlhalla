import { MAPS, LEGENDS, ST, PH, HW, moveOf, weaponOf, FPS } from '/shared/sim.js';
import { sfx as SFX } from './audio.js';
const MUTE = new Proxy({}, { get: () => () => {} });
const sfx = SFX;

export const PLAYER_COLORS = ['#ff4d4d', '#4da6ff', '#5ad65a', '#ffd23f'];
export const TEAM_COLORS = ['#ff4d4d', '#4da6ff'];
const THEMES = [
  { sky: ['#4f9cf5', '#bfe3ff'], far: '#8fb3e0', near: '#6a8fc4', grass: '#5cc24a', grassD: '#3e9a34', rock: ['#9a7b5c', '#5e4633'], cloud: 'rgba(255,255,255,0.85)', sun: '#fff6c8' },
  { sky: ['#ff7e5f', '#ffd6a0'], far: '#c97a8a', near: '#8c4f6b', grass: '#d9a441', grassD: '#a8762a', rock: ['#7a5a6a', '#45303f'], cloud: 'rgba(255,225,210,0.8)', sun: '#ffe9b0' },
  { sky: ['#0b0f2e', '#3b2f73'], far: '#2b2d63', near: '#1c1d47', grass: '#46c3a3', grassD: '#2b8c75', rock: ['#4a4a72', '#26264a'], cloud: 'rgba(150,150,220,0.25)', sun: '#e9ecff', stars: true },
];

const lerp = (a, b, t) => a + (b - a) * t;
export function damageColor(d) {
  const stops = [[0, [255, 255, 255]], [50, [255, 240, 120]], [100, [255, 160, 50]], [150, [240, 50, 40]], [220, [120, 10, 20]]];
  for (let i = 1; i < stops.length; i++) {
    if (d <= stops[i][0]) {
      const [d0, c0] = stops[i - 1], [d1, c1] = stops[i];
      const t = (d - d0) / (d1 - d0);
      return `rgb(${c0.map((c, k) => Math.round(lerp(c, c1[k], t))).join(',')})`;
    }
  }
  return 'rgb(120,10,20)';
}

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: -150, z: 0.6 };
    this.parts = [];
    this.shake = 0;
    this.flash = 0;
    this.t = 0;
    this.banner = null;
    this.clouds = Array.from({ length: 9 }, (_, i) => ({ x: Math.random() * 3000 - 1500, y: -900 + Math.random() * 600, s: 0.6 + Math.random() * 0.9, v: 0.15 + Math.random() * 0.3, seed: i }));
    this.stars = Array.from({ length: 120 }, () => ({ x: Math.random(), y: Math.random() * 0.7, r: Math.random() * 1.6 + 0.3 }));
  }

  reset(cfg, me) {
    this.cfg = cfg;
    this.me = me;
    this.parts = [];
    this.lastCount = -1;
    this.banner = null;
    const map = MAPS[cfg.map];
    this.cam = { x: 0, y: -150, z: 0.5 };
    this.map = map;
    this.theme = THEMES[map.theme];
  }

  pcolor(i) { return this.cfg.mode === 1 ? TEAM_COLORS[this.cfg.players[i].team] : PLAYER_COLORS[i % 4]; }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(innerWidth * dpr), h = Math.floor(innerHeight * dpr);
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.W = w; this.H = h; this.dpr = dpr;
  }

  // -------------------------------------------------- events -> effects/sfx
  handleEvents(s, evs) {
    const sfx = this.quiet ? MUTE : SFX;
    for (const e of evs) {
      const P = e.p >= 0 ? s.players[e.p] : null;
      switch (e.type) {
        case 'jump': case 'jump2':
          sfx[e.type]();
          this.puff(e.x, e.y, 6, e.type === 'jump2' ? 'rgba(255,255,255,0.8)' : 'rgba(220,210,190,0.8)');
          break;
        case 'land': sfx.land(); this.puff(e.x, e.y, 5, 'rgba(220,210,190,0.7)'); break;
        case 'swing': sfx.swing(e.heavy); break;
        case 'dodge': sfx.dodge(); break;
        case 'pickup': sfx.pickup(); this.ring(e.x, e.y - 40, '#fff', 40); break;
        case 'throw': sfx.throw(); break;
        case 'shot': sfx.shot(); break;
        case 'spawn': sfx.spawn(); this.ring(e.x, e.y - 36, this.pcolor(e.p), 70); break;
        case 'pound':
          sfx.pound(); this.shake = Math.max(this.shake, 8);
          this.ring(e.x, e.y, 'rgba(255,255,255,0.9)', 110);
          this.puff(e.x, e.y, 14, 'rgba(220,210,190,0.8)');
          break;
        case 'hit': {
          sfx.hit(e.dmg);
          const big = e.F > 22;
          this.spark(e.x, e.y, e.dmg, big ? '#fff2a8' : '#ffffff', e.kx, e.ky);
          this.shake = Math.max(this.shake, Math.min(18, e.F * 0.35));
          if (big) this.flash = Math.max(this.flash, 0.15);
          break;
        }
        case 'ko': {
          sfx.ko();
          this.shake = 26; this.flash = 0.35;
          this.koBlast(e.x, e.y, this.pcolor(e.p));
          break;
        }
        case 'go': sfx.go(); this.banner = { text: 'BRAWL!', t: 70, color: '#ffd23f' }; break;
        case 'game': sfx.game(); this.banner = { text: 'GAME!', t: 9999, color: '#ffffff' }; break;
      }
      if (P && e.type === 'ko' && e.p === this.me) this.flash = 0.5;
    }
  }

  puff(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i / (n - 1 || 1)) * Math.PI;
      this.parts.push({ k: 'puff', x, y: y - 4, vx: Math.cos(a) * (1 + Math.random() * 2.5), vy: Math.sin(a) * 1.2 - 0.3, r: 6 + Math.random() * 6, life: 26, max: 26, color });
    }
  }
  ring(x, y, color, r) { this.parts.push({ k: 'ring', x, y, r: 6, R: r, life: 20, max: 20, color }); }
  spark(x, y, dmg, color, kx, ky) {
    const n = 8 + Math.min(10, dmg);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const sp = 4 + Math.random() * (4 + dmg * 0.6);
      this.parts.push({ k: 'line', x, y, vx: Math.cos(a) * sp + kx * 3, vy: Math.sin(a) * sp + ky * 3, len: 10 + dmg, life: 14, max: 14, color });
    }
    this.parts.push({ k: 'star', x, y, r: 18 + dmg * 2.2, life: 8, max: 8, color });
  }
  koBlast(x, y, color) {
    // clamp the explosion into the camera view so you always see it
    const v = this.viewRect();
    const cx = Math.max(v.l + 60, Math.min(v.r - 60, x)), cy = Math.max(v.t + 60, Math.min(v.b - 60, y));
    const dirx = this.cam.x - cx, diry = this.cam.y - cy, n = Math.hypot(dirx, diry) || 1;
    this.parts.push({ k: 'beam', x: cx, y: cy, dx: dirx / n, dy: diry / n, life: 50, max: 50, color });
    for (let i = 0; i < 40; i++) {
      const a = Math.atan2(diry, dirx) + (Math.random() - 0.5) * 2.2, sp = 6 + Math.random() * 22;
      this.parts.push({ k: 'line', x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, len: 30, life: 30, max: 30, color: Math.random() < 0.5 ? color : '#fff' });
    }
    this.parts.push({ k: 'ring', x: cx, y: cy, r: 10, R: 260, life: 28, max: 28, color: '#fff' });
    this.parts.push({ k: 'ring', x: cx, y: cy, r: 10, R: 180, life: 22, max: 22, color });
  }

  viewRect() {
    const hw = this.W / 2 / this.cam.z, hh = this.H / 2 / this.cam.z;
    return { l: this.cam.x - hw, r: this.cam.x + hw, t: this.cam.y - hh, b: this.cam.y + hh };
  }

  // -------------------------------------------------- main draw
  draw(s, evs, dt, hud) {
    this.resize();
    this.t += dt / 1000;
    const { ctx, W, H } = this;
    const map = this.map;
    this.handleEvents(s, evs);

    // camera framing (like Brawlhalla: zoom to fit everyone alive)
    let l = -320, r = 320, t = -260, b = 170;
    for (const p of s.players) {
      if (p.st === ST.DEAD) continue;
      l = Math.min(l, p.x - 220); r = Math.max(r, p.x + 220);
      t = Math.min(t, p.y - PH - 200); b = Math.max(b, p.y + 230);
    }
    l = Math.max(l, map.blast.l + 100); r = Math.min(r, map.blast.r - 100);
    t = Math.max(t, map.blast.t + 50); b = Math.min(b, map.blast.b - 50);
    const tz = Math.max(0.28 * this.dpr, Math.min(0.95 * this.dpr, Math.min(W / (r - l), H / (b - t))));
    const k = 1 - Math.pow(0.0015, dt / 1000);
    this.cam.x = lerp(this.cam.x, (l + r) / 2, k);
    this.cam.y = lerp(this.cam.y, (t + b) / 2, k);
    this.cam.z = lerp(this.cam.z, tz, k);
    this.shake *= Math.pow(0.0005, dt / 1000);

    this.drawBackground(s);

    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    const z = this.cam.z;
    ctx.setTransform(z, 0, 0, z, W / 2 - this.cam.x * z + sx * this.dpr, H / 2 - this.cam.y * z + sy * this.dpr);

    this.drawStage(map);
    for (const w of s.picks) this.drawPickup(w);
    // trails for launched fighters
    for (const p of s.players) {
      if (p.st === ST.HIT && p.hp <= 0 && Math.hypot(p.vx, p.vy) > 13 && Math.random() < 0.9) {
        this.parts.push({ k: 'puff', x: p.x, y: p.y - PH / 2, vx: 0, vy: 0, r: 10 + Math.random() * 8, life: 30, max: 30, color: 'rgba(240,240,240,0.55)' });
      }
    }
    this.drawParts(dt, true);
    for (const p of s.players) if (p.st !== ST.DEAD) this.drawFighter(p, s);
    for (const q of s.proj) this.drawProjectile(q, s);
    this.drawParts(dt, false);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawOffscreen(s);
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash})`;
      ctx.fillRect(0, 0, W, H);
      this.flash = Math.max(0, this.flash - dt / 1000 * 1.5);
    }
    this.drawHud(s, hud);
  }

  drawBackground(s) {
    const { ctx, W, H } = this, th = this.theme;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (th.stars) {
      for (const st of this.stars) {
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(this.t * 2 + st.x * 50);
        ctx.fillStyle = '#fff';
        ctx.fillRect(st.x * W, st.y * H, st.r * this.dpr, st.r * this.dpr);
      }
      ctx.globalAlpha = 1;
    }
    // sun / moon
    const px = -this.cam.x * 0.02 * this.dpr;
    ctx.fillStyle = th.sun;
    ctx.shadowColor = th.sun; ctx.shadowBlur = 60 * this.dpr;
    ctx.beginPath(); ctx.arc(W * 0.78 + px, H * 0.2, 46 * this.dpr, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // parallax mountains
    this.mountains(th.far, 0.05, H * 0.62, 140, 0.0021, 1);
    this.mountains(th.near, 0.1, H * 0.74, 110, 0.0034, 2);
    // clouds
    for (const c of this.clouds) {
      c.x += c.v;
      if (c.x > 2000) c.x = -2000;
      const z = this.cam.z * 0.35;
      const x = W / 2 + (c.x - this.cam.x * 0.3) * z, y = H / 2 + (c.y - this.cam.y * 0.3) * z;
      ctx.fillStyle = th.cloud;
      const r = 40 * c.s * this.dpr;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2); ctx.arc(x + r * 1.1, y + r * 0.2, r * 0.8, 0, Math.PI * 2);
      ctx.arc(x - r * 1.1, y + r * 0.25, r * 0.7, 0, Math.PI * 2); ctx.arc(x + r * 0.3, y - r * 0.5, r * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  mountains(color, par, base, amp, freq, seed) {
    const { ctx, W, H } = this;
    const off = this.cam.x * par;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8 * this.dpr) {
      const wx = (x / this.dpr + off) * 1;
      const y = base - (Math.sin(wx * freq + seed) * 0.6 + Math.sin(wx * freq * 2.3 + seed * 3) * 0.3 + Math.sin(wx * freq * 5.1) * 0.1 + 0.6) * amp * this.dpr;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.fill();
  }

  drawStage(map) {
    const { ctx } = this, th = this.theme;
    for (const b of map.solids) {
      const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      g.addColorStop(0, th.rock[0]); g.addColorStop(1, th.rock[1]);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x + b.w, b.y);
      ctx.lineTo(b.x + b.w - 30, b.y + b.h * 0.7);
      ctx.lineTo(b.x + b.w * 0.5, b.y + b.h);
      ctx.lineTo(b.x + 30, b.y + b.h * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 4; ctx.stroke();
      // bricks
      ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 3;
      for (let row = 0; row < 4; row++) {
        const y = b.y + 40 + row * 34;
        if (y > b.y + b.h * 0.6) break;
        for (let x = b.x + 20 + (row % 2) * 30; x < b.x + b.w - 40; x += 60) { ctx.strokeRect(x, y, 50, 26); }
      }
      // grass
      ctx.fillStyle = th.grassD;
      ctx.fillRect(b.x - 6, b.y - 2, b.w + 12, 18);
      ctx.fillStyle = th.grass;
      ctx.beginPath();
      ctx.moveTo(b.x - 8, b.y + 10);
      for (let x = b.x - 8; x <= b.x + b.w + 8; x += 16) ctx.quadraticCurveTo(x + 8, b.y - 8, x + 16, b.y + 4);
      ctx.lineTo(b.x + b.w + 8, b.y + 10);
      ctx.fill();
    }
    for (const b of map.softs) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(b.x + 20, b.y + 12, 10, 26); ctx.fillRect(b.x + b.w - 30, b.y + 12, 10, 26);
      const g = ctx.createLinearGradient(0, b.y, 0, b.y + 14);
      g.addColorStop(0, '#c8955a'); g.addColorStop(1, '#7a5530');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(b.x, b.y - 2, b.w, 16, 6); ctx.fill();
      ctx.strokeStyle = 'rgba(40,20,0,0.5)'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = 'rgba(40,20,0,0.25)';
      for (let x = b.x + 40; x < b.x + b.w; x += 40) { ctx.beginPath(); ctx.moveTo(x, b.y); ctx.lineTo(x, b.y + 12); ctx.stroke(); }
    }
  }

  drawPickup(w) {
    const { ctx } = this;
    const bob = w.gr ? Math.sin(this.t * 4 + w.id) * 4 : 0;
    const fade = w.life < 120 && Math.floor(w.life / 8) % 2 === 0;
    if (fade) return;
    ctx.save();
    ctx.translate(w.x, w.y - 26 + bob);
    const col = w.slot === 0 ? '#ffffff' : '#ffcf4a';
    ctx.shadowColor = col; ctx.shadowBlur = 24;
    ctx.rotate(-0.6);
    ctx.fillStyle = col;
    ctx.strokeStyle = '#1a1a2a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(6, -22); ctx.lineTo(6, 10); ctx.lineTo(-6, 10); ctx.lineTo(-6, -22); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(-14, 10, 28, 6); ctx.strokeRect(-14, 10, 28, 6);
    ctx.fillStyle = '#6b4a2a'; ctx.fillRect(-3, 16, 6, 12);
    ctx.restore();
  }

  drawProjectile(q, s) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(q.x, q.y);
    if (q.kind === 1) {
      ctx.rotate(this.t * 18 * Math.sign(q.vx || 1));
      const owner = s.players[q.o];
      this.drawWeapon(LEGENDS[owner.lg].weapons[q.slot], 0, -20, 1);
    } else {
      const big = q.w > 30;
      ctx.rotate(Math.atan2(q.vy, q.vx));
      ctx.shadowColor = '#ffde59'; ctx.shadowBlur = 18;
      ctx.fillStyle = big ? '#ffb347' : '#fff3a0';
      ctx.beginPath(); ctx.ellipse(0, 0, q.w / 2, q.h / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,200,80,0.4)';
      ctx.beginPath(); ctx.ellipse(-q.w * 0.6, 0, q.w * 0.6, q.h * 0.35, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // -------------------------------------------------- fighters
  drawWeapon(w, ang, len, scale = 1) {
    const { ctx } = this;
    ctx.save();
    ctx.rotate(ang);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1a2a'; ctx.lineWidth = 3;
    if (w === 'sword') {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(-8, -3, 12, 6);
      ctx.fillStyle = '#c9a227'; ctx.fillRect(3, -9, 5, 18); ctx.strokeRect(3, -9, 5, 18);
      const g = ctx.createLinearGradient(0, -5, 0, 5); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#9aa7b8');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(8, -5); ctx.lineTo(58, -5); ctx.lineTo(68, 0); ctx.lineTo(58, 5); ctx.lineTo(8, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (w === 'hammer') {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(-10, -3, 58, 7); ctx.strokeRect(-10, -3, 58, 7);
      const g = ctx.createLinearGradient(40, -18, 40, 18); g.addColorStop(0, '#d8dde6'); g.addColorStop(1, '#6d7686');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(40, -18, 26, 36, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c9a227'; ctx.fillRect(38, -4, 30, 8);
    } else if (w === 'spear') {
      ctx.fillStyle = '#7a5530'; ctx.fillRect(-30, -3, 110, 6); ctx.strokeRect(-30, -3, 110, 6);
      ctx.fillStyle = '#e8ecf2';
      ctx.beginPath(); ctx.moveTo(78, -8); ctx.lineTo(102, 0); ctx.lineTo(78, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d33'; ctx.fillRect(72, -6, 6, 12);
    } else if (w === 'gauntlets') {
      const g = ctx.createRadialGradient(4, -3, 2, 6, 0, 14); g.addColorStop(0, '#fff7c2'); g.addColorStop(1, '#c9a227');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(6, 0, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#7a5530'; ctx.fillRect(-12, -6, 10, 12);
    } else if (w === 'blasters') {
      ctx.fillStyle = '#444b5a'; ctx.beginPath(); ctx.roundRect(-2, -8, 30, 10, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c9a227'; ctx.fillRect(24, -7, 8, 8);
      ctx.fillStyle = '#6b4a2a'; ctx.beginPath(); ctx.roundRect(-2, 0, 9, 13, 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  drawFighter(p, s) {
    const { ctx } = this;
    const L = LEGENDS[p.lg];
    const wpn = weaponOf(p);
    const thrust = wpn === 'spear' || wpn === 'gauntlets' || wpn === 'blasters' || wpn === 'unarmed';
    ctx.save();
    let ox = 0;
    if (p.hp > 0 && p.st === ST.HIT) ox = (Math.random() - 0.5) * 8; // hit-pause shake
    ctx.translate(p.x + ox, p.y);
    if (p.inv > 0 && p.st !== ST.DODGE && Math.floor(s.frame / 4) % 2 === 0) ctx.globalAlpha = 0.45;
    if (p.st === ST.DODGE) ctx.globalAlpha = 0.5;

    // shadow ring color under feet
    const pc = this.pcolor(p.i);
    ctx.fillStyle = pc;
    ctx.globalAlpha *= 0.9;
    ctx.beginPath(); ctx.ellipse(0, 2, 24, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = p.st === ST.DODGE ? 0.5 : (p.inv > 0 && Math.floor(s.frame / 4) % 2 === 0 ? 0.45 : 1);

    ctx.scale(p.face, 1);
    const f = s.frame;
    const speed = Math.abs(p.vx);
    let lean = 0, bob = 0, legA = 0.15, legB = -0.15, kneeA = 0, kneeB = 0;
    let armF = 0.9, armB = 1.2, ext = 1;
    if (p.st === ST.STAND && speed > 0.6) {
      const ph = f * 0.32;
      legA = Math.sin(ph) * 0.8; legB = -legA;
      kneeA = Math.max(0, -Math.sin(ph)) * 0.9; kneeB = Math.max(0, Math.sin(ph)) * 0.9;
      lean = 0.15; bob = Math.abs(Math.sin(ph)) * -3;
      armF = 0.9 - Math.sin(ph) * 0.8; armB = 0.9 + Math.sin(ph) * 0.8;
    } else if (p.st === ST.STAND) {
      bob = Math.sin(f * 0.08) * 1.5;
    } else if (p.st === ST.AIR || p.st === ST.WALL) {
      legA = 0.5; legB = -0.3; kneeA = 1.2; kneeB = 0.6;
      armF = p.vy < 0 ? -0.6 : 0.4; armB = p.vy < 0 ? -1.0 : 0.2;
      if (p.st === ST.WALL) { lean = -0.2; armF = -1.4; }
    } else if (p.st === ST.HIT) {
      lean = -0.5; armF = -2.2; armB = -2.6; legA = 0.6; legB = -0.6;
    } else if (p.st === ST.DODGE) {
      lean = 0.3; kneeA = 1; kneeB = 1;
    } else if (p.st === ST.LAG) {
      bob = 6; kneeA = 1; kneeB = 1;
    }

    // attack posing
    let swing = null;
    if (p.st === ST.MOVE) {
      const m = moveOf(p);
      const hb = m.hb[0] || { x: m.proj ? m.proj.x : 40, y: m.proj ? m.proj.y : -40, w: 40, h: 30 };
      const target = Math.atan2(hb.y + 50, hb.x);
      const dir = hb.y + hb.h / 2 < -40 ? -1 : 1;
      const wind = target - dir * 1.6;
      const end = target + dir * 0.9;
      const mt = p.mt;
      if (thrust) {
        armF = target;
        if (mt <= m.s) ext = 1 - 0.4 * (mt / m.s);
        else if (mt <= m.s + m.a) ext = 1.5;
        else ext = 1.5 - 0.5 * Math.min(1, (mt - m.s - m.a) / m.r);
      } else if (mt <= m.s) armF = lerp(0.9, wind, Math.min(1, mt / m.s));
      else if (mt <= m.s + m.a) armF = lerp(wind, end, (mt - m.s) / m.a);
      else armF = lerp(end, 0.9, Math.min(1, (mt - m.s - m.a) / m.r));
      if (mt > m.s && mt <= m.s + m.a + 2 && m.hb.length) swing = { m, wind, now: armF, hb };
      if (m.key === 'rec') { lean = -0.2; legA = 0.3; kneeA = 1.4; }
      if (m.key === 'gp') { lean = 0.1; kneeA = 1.4; kneeB = 1.4; armF = 1.4; }
      if (m.key[1] === 'a' || m.key === 'na') { kneeA = 1.2; kneeB = 0.8; }
      if (m.key === 'na' && !thrust) lean = Math.sin(mt * 0.6) * 0.3;
      if (m.key[0] === 's') lean = 0.25;
      armB = armF + 0.6;
    }

    // swing trail (behind body)
    if (swing) {
      const sh = { x: 0, y: -50 };
      const r = Math.hypot(swing.hb.x, swing.hb.y + 50) + swing.hb.w * 0.35;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = Math.max(10, swing.hb.h * 0.55);
      ctx.lineCap = 'round';
      ctx.beginPath();
      const a0 = swing.wind, a1 = swing.now;
      ctx.arc(sh.x, sh.y, r, Math.min(a0, a1), Math.max(a0, a1));
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,240,170,0.5)';
      ctx.lineWidth *= 0.45;
      ctx.stroke();
    }

    ctx.rotate(lean * 0.3);
    ctx.translate(0, bob);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const out = '#14141f';
    const limb = (x, y, a, k, len, col, w) => {
      const x1 = x + Math.sin(a) * len, y1 = y + Math.cos(a) * len;
      const x2 = x1 + Math.sin(a - k) * len, y2 = y1 + Math.cos(a - k) * len;
      ctx.strokeStyle = out; ctx.lineWidth = w + 5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      return [x2, y2];
    };
    const dark = shade(L.color, -0.35);
    // back arm & leg
    const backHand = (() => {
      const a = armB, len = 13;
      const x1 = 2 + Math.cos(a) * len, y1 = -50 + Math.sin(a) * len;
      const x2 = x1 + Math.cos(a + 0.3) * len, y2 = y1 + Math.sin(a + 0.3) * len;
      ctx.strokeStyle = out; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(2, -50); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = shade(L.skin, -0.15); ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(2, -50); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      return [x2, y2];
    })();
    if (wpn === 'gauntlets' || wpn === 'blasters') { ctx.save(); ctx.translate(...backHand); this.drawWeapon(wpn, armB, 0, 0.8); ctx.restore(); }
    limb(-4, -28, legB, -kneeB, 14, shade(L.color, -0.5), 9);
    // torso
    ctx.fillStyle = L.color; ctx.strokeStyle = out; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(-14, -60, 28, 34, 9); ctx.fill(); ctx.stroke();
    ctx.fillStyle = L.trim; ctx.fillRect(-14, -34, 28, 6);
    ctx.fillStyle = shade(L.color, 0.25); ctx.fillRect(-6, -56, 12, 4);
    limb(4, -28, legA, -kneeA, 14, dark, 9);
    // head
    this.drawHead(L, p.st === ST.HIT);
    // front arm + weapon
    const a = armF, len = 13 * ext;
    const x1 = 4 + Math.cos(a) * len, y1 = -50 + Math.sin(a) * len;
    const x2 = x1 + Math.cos(a - 0.15) * len, y2 = y1 + Math.sin(a - 0.15) * len;
    ctx.strokeStyle = out; ctx.lineWidth = 13; ctx.beginPath(); ctx.moveTo(4, -50); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = L.skin; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(4, -50); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.save(); ctx.translate(x2, y2);
    if (wpn === 'unarmed') { ctx.fillStyle = L.skin; ctx.strokeStyle = out; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    else this.drawWeapon(wpn, a - 0.15, 0);
    ctx.restore();

    if (p.hp > 0 && p.st === ST.HIT) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(-60, -110, 120, 120);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    // name tag
    ctx.save();
    ctx.translate(p.x, p.y - PH - 30);
    const name = this.cfg.players[p.i].name || `P${p.i + 1}`;
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(name, 0, 0);
    ctx.fillStyle = pc;
    ctx.fillText(name, 0, 0);
    if (p.i === this.me) {
      ctx.beginPath(); ctx.moveTo(-7, 6); ctx.lineTo(7, 6); ctx.lineTo(0, 14); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  drawHead(L, hurt) {
    const { ctx } = this;
    const out = '#14141f';
    const hx = 2, hy = -72;
    ctx.lineWidth = 3; ctx.strokeStyle = out;
    // hair behind
    if (L.look === 0) { ctx.fillStyle = L.hair; ctx.beginPath(); ctx.moveTo(-6, hy - 8); ctx.quadraticCurveTo(-26, hy + 6, -22, hy + 26); ctx.lineTo(-6, hy + 8); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = L.skin;
    ctx.beginPath(); ctx.arc(hx, hy, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // eyes
    if (hurt) {
      ctx.strokeStyle = out; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(6, hy - 4); ctx.lineTo(12, hy + 1); ctx.moveTo(12, hy - 4); ctx.lineTo(6, hy + 1); ctx.stroke();
    } else {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(9, hy - 1, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = out; ctx.beginPath(); ctx.arc(10.5, hy - 1, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = out; ctx.lineWidth = 3;
    switch (L.look) {
      case 0: // winged helm
        ctx.fillStyle = '#dfe5ee'; ctx.beginPath(); ctx.arc(hx, hy - 4, 15, Math.PI, 0); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.moveTo(-10, hy - 10); ctx.quadraticCurveTo(-26, hy - 30, -18, hy - 34); ctx.quadraticCurveTo(-14, hy - 20, -4, hy - 16); ctx.fill(); ctx.stroke();
        ctx.fillStyle = L.trim; ctx.fillRect(hx - 14, hy - 6, 29, 4);
        break;
      case 1: // bear hood
        ctx.fillStyle = L.hair;
        ctx.beginPath(); ctx.arc(hx - 1, hy - 3, 17, Math.PI * 0.95, Math.PI * 2.05); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(hx - 11, hy - 16, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(hx + 9, hy - 18, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = shade(L.hair, -0.3); ctx.beginPath(); ctx.ellipse(hx + 3, hy + 9, 10, 6, 0, 0, Math.PI); ctx.fill();
        break;
      case 2: // tricorn
        ctx.fillStyle = '#26262e';
        ctx.beginPath(); ctx.moveTo(-20, hy - 6); ctx.quadraticCurveTo(hx, hy - 34, 24, hy - 6); ctx.quadraticCurveTo(hx, hy - 14, -20, hy - 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = L.trim; ctx.fillRect(-12, hy - 12, 26, 3);
        ctx.fillStyle = '#26262e'; ctx.fillRect(4, hy - 4, 12, 3);
        break;
      case 3: // ninja hood
        ctx.fillStyle = L.hair;
        ctx.beginPath(); ctx.arc(hx, hy, 15.5, Math.PI * 0.75, Math.PI * 2.25); ctx.lineTo(hx + 14, hy - 4); ctx.lineTo(hx + 2, hy - 6); ctx.lineTo(hx + 2, hy + 4); ctx.lineTo(hx + 15, hy + 4); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = L.color; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-12, hy - 6); ctx.quadraticCurveTo(-24, hy - 4 + Math.sin(this.t * 10) * 4, -30, hy + 2); ctx.stroke();
        break;
      case 4: // horned helm + beard
        ctx.fillStyle = L.hair; ctx.beginPath(); ctx.moveTo(hx - 6, hy + 6); ctx.quadraticCurveTo(hx + 6, hy + 30, hx + 16, hy + 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#9aa3b2'; ctx.beginPath(); ctx.arc(hx, hy - 3, 15.5, Math.PI, 0); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#f2ead8';
        ctx.beginPath(); ctx.moveTo(-12, hy - 10); ctx.quadraticCurveTo(-26, hy - 14, -22, hy - 32); ctx.quadraticCurveTo(-16, hy - 18, -6, hy - 16); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(14, hy - 10); ctx.quadraticCurveTo(28, hy - 14, 24, hy - 32); ctx.quadraticCurveTo(18, hy - 18, 8, hy - 16); ctx.fill(); ctx.stroke();
        break;
      case 5: // spiky hair + headband
        ctx.fillStyle = L.hair;
        ctx.beginPath(); ctx.moveTo(-14, hy - 4);
        for (let i = 0; i < 5; i++) { ctx.lineTo(-14 + i * 7, hy - 26 + (i % 2) * 6); ctx.lineTo(-10 + i * 7, hy - 10); }
        ctx.lineTo(16, hy - 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = L.trim; ctx.fillRect(hx - 15, hy - 9, 30, 5);
        break;
    }
  }

  drawParts(dt, under) {
    const { ctx } = this;
    const k = dt / (1000 / FPS);
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i];
      if ((q.k === 'puff') !== under) continue;
      q.life -= k;
      if (q.life <= 0) { this.parts.splice(i, 1); continue; }
      const u = q.life / q.max;
      if (q.vx !== undefined) { q.x += q.vx * k; q.y += q.vy * k; q.vx *= 0.9; q.vy *= 0.9; }
      ctx.globalAlpha = Math.min(1, u * 1.5);
      if (q.k === 'puff') {
        ctx.fillStyle = q.color;
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r * (1.6 - u * 0.6), 0, Math.PI * 2); ctx.fill();
      } else if (q.k === 'ring') {
        ctx.strokeStyle = q.color; ctx.lineWidth = 6 * u + 1;
        ctx.beginPath(); ctx.arc(q.x, q.y, lerp(q.R, q.r, u), 0, Math.PI * 2); ctx.stroke();
      } else if (q.k === 'line') {
        ctx.strokeStyle = q.color; ctx.lineWidth = 4 * u + 1; ctx.lineCap = 'round';
        const n = Math.hypot(q.vx, q.vy) || 1;
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - (q.vx / n) * q.len * u, q.y - (q.vy / n) * q.len * u); ctx.stroke();
      } else if (q.k === 'star') {
        ctx.fillStyle = q.color;
        ctx.beginPath();
        for (let j = 0; j < 16; j++) {
          const a = (j / 16) * Math.PI * 2, r = j % 2 ? q.r * 0.35 : q.r * (1.2 - u * 0.4);
          ctx.lineTo(q.x + Math.cos(a) * r, q.y + Math.sin(a) * r);
        }
        ctx.fill();
      } else if (q.k === 'beam') {
        const len = 2600, w = 180 * u;
        ctx.save();
        ctx.translate(q.x, q.y); ctx.rotate(Math.atan2(q.dy, q.dx));
        const g = ctx.createLinearGradient(0, 0, len, 0);
        g.addColorStop(0, q.color); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, -w); ctx.lineTo(len, w); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, -w * 0.3); ctx.lineTo(len, w * 0.3); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawOffscreen(s) {
    const { ctx, W, H } = this, z = this.cam.z;
    for (const p of s.players) {
      if (p.st === ST.DEAD) continue;
      const x = W / 2 + (p.x - this.cam.x) * z, y = H / 2 + (p.y - PH / 2 - this.cam.y) * z;
      const m = 40 * this.dpr;
      if (x > 0 && x < W && y > 0 && y < H) continue;
      const cx = Math.max(m, Math.min(W - m, x)), cy = Math.max(m, Math.min(H - m, y));
      const a = Math.atan2(y - cy, x - cx);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = this.pcolor(p.i);
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 38 * this.dpr, Math.sin(a) * 38 * this.dpr);
      ctx.arc(0, 0, 26 * this.dpr, a + 0.7, a - 0.7 + Math.PI * 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath(); ctx.arc(0, 0, 21 * this.dpr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = damageColor(p.dmg);
      ctx.font = `bold ${13 * this.dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${p.dmg}%`, 0, 0);
      ctx.restore();
    }
  }

  drawHud(s, hud) {
    const { ctx, W, H } = this, d = this.dpr;
    const n = s.players.length, cw = 170 * d, gap = 12 * d;
    const total = n * cw + (n - 1) * gap;
    let x = (W - total) / 2;
    const y = H - 86 * d;
    ctx.textBaseline = 'alphabetic';
    for (const p of s.players) {
      const L = LEGENDS[p.lg], pc = this.pcolor(p.i);
      ctx.fillStyle = 'rgba(10,10,25,0.72)';
      ctx.beginPath(); ctx.roundRect(x, y, cw, 70 * d, 12 * d); ctx.fill();
      ctx.strokeStyle = pc; ctx.lineWidth = 3 * d; ctx.stroke();
      // portrait
      ctx.fillStyle = p.st === ST.DEAD && p.stocks <= 0 ? '#444' : L.color;
      ctx.beginPath(); ctx.arc(x + 34 * d, y + 35 * d, 24 * d, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = damageColor(p.dmg);
      ctx.beginPath(); ctx.arc(x + 34 * d, y + 35 * d, 24 * d, Math.PI * 0.5 - (p.dmg / 300) * Math.PI, Math.PI * 0.5 + (p.dmg / 300) * Math.PI); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `900 ${22 * d}px system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(L.name[0], x + 34 * d, y + 43 * d);
      ctx.textAlign = 'left';
      ctx.font = `bold ${12 * d}px system-ui, sans-serif`; ctx.fillStyle = pc;
      const nm = (this.cfg.players[p.i].name || `P${p.i + 1}`).slice(0, 12);
      ctx.fillText(nm, x + 64 * d, y + 18 * d);
      ctx.font = `900 ${28 * d}px system-ui, sans-serif`;
      ctx.lineWidth = 4 * d; ctx.strokeStyle = '#000';
      const dmgText = p.stocks > 0 ? `${p.dmg}%` : 'OUT';
      ctx.strokeText(dmgText, x + 64 * d, y + 50 * d);
      ctx.fillStyle = p.stocks > 0 ? damageColor(p.dmg) : '#777';
      ctx.fillText(dmgText, x + 64 * d, y + 50 * d);
      for (let k = 0; k < p.stocks; k++) {
        ctx.fillStyle = pc;
        ctx.beginPath(); ctx.arc(x + 70 * d + k * 13 * d, y + 62 * d, 4.5 * d, 0, Math.PI * 2); ctx.fill();
      }
      ctx.font = `${11 * d}px system-ui, sans-serif`; ctx.fillStyle = '#bbb'; ctx.textAlign = 'right';
      ctx.fillText(weaponOf(p), x + cw - 10 * d, y + 64 * d);
      ctx.textAlign = 'left';
      x += cw + gap;
    }

    // timer
    if (s.time > 0 || this.cfg.time > 0) {
      const secs = Math.ceil(s.time / FPS);
      ctx.font = `900 ${30 * d}px system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.lineWidth = 5 * d; ctx.strokeStyle = '#000';
      const tt = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      ctx.strokeText(tt, W / 2, 44 * d); ctx.fillStyle = '#fff'; ctx.fillText(tt, W / 2, 44 * d);
    }

    // countdown / banners
    let text = null, color = '#fff', scale = 1;
    if (s.phase === 0) {
      const c = Math.ceil(s.timer / 60);
      if (c !== this.lastCount) { this.lastCount = c; if (!this.quiet) SFX.beep(); }
      text = String(c); scale = 1 + (s.timer % 60) / 60 * 0.6;
    } else if (this.banner) {
      text = this.banner.text; color = this.banner.color;
      scale = 1 + Math.max(0, (this.banner.t - 55) / 15) * 0.8;
      if (--this.banner.t <= 0) this.banner = null;
    }
    if (text) {
      ctx.save();
      ctx.translate(W / 2, H * 0.4); ctx.scale(scale, scale);
      ctx.font = `900 ${110 * d}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 12 * d; ctx.strokeStyle = '#1a1030'; ctx.strokeText(text, 0, 0);
      ctx.fillStyle = color; ctx.fillText(text, 0, 0);
      ctx.restore();
    }

    if (hud && hud.net) {
      const st = hud.net;
      ctx.font = `${12 * d}px ui-monospace, monospace`; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(`ping ${st.ping}ms  rollback ${st.rollback}f  buffer ${st.lead}f${st.desyncs ? `  resyncs ${st.desyncs}` : ''}`, 12 * d, 20 * d);
    }
  }
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = c => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
export { shade };

const previews = new WeakMap();
/** Draw a legend standing idle into a small canvas (lobby cards). */
export function drawPreview(cv, lg, color, frame, wslot = -1) {
  let r = previews.get(cv);
  if (!r) { r = new Renderer(cv); previews.set(cv, r); }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.floor(cv.clientWidth * dpr)), h = Math.max(1, Math.floor(cv.clientHeight * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = r.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  r.cfg = { mode: 0, players: [{ name: ' ' }] };
  r.me = -1;
  r.t = frame / 60;
  r.pcolor = () => color;
  const sc = (h / 120) * 1.05;
  ctx.setTransform(sc, 0, 0, sc, w / 2, h - 8 * sc);
  r.drawFighter({ i: 0, lg, x: 0, y: 0, vx: 0, vy: 0, face: 1, st: ST.STAND, hp: 0, inv: 0, wpn: wslot, mt: 0 }, { frame });
}
