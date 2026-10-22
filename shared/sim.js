// Deterministic game simulation, shared by the server and every browser.
//
// The netcode is rollback (GGPO-style): every machine runs this exact code on
// the exact same inputs and must produce bit-identical states. To keep that
// true across engines the sim only uses IEEE-exact math (+ - * / sqrt, floor,
// round, abs, min, max, Math.imul) and its own seeded RNG. No Math.random,
// no sin/cos/atan2, no Date — anything visual-only lives in the renderer.

export const FPS = 60;
export const B = { L: 1, R: 2, U: 4, D: 8, JUMP: 16, LIGHT: 32, HEAVY: 64, DODGE: 128, THROW: 256 };
export const INPUT_MASK = 511;
export const BOT_FLAG = 4096; // server sets this on a slot whose human disconnected

export const ST = { STAND: 0, AIR: 1, MOVE: 2, HIT: 3, DODGE: 4, DEAD: 5, WALL: 6, LAG: 7 };
export const HW = 18; // player half width
export const PH = 72; // player height (y is the feet)

const GRAV = 0.55, MAX_FALL = 11, FAST_FALL = 17, HIT_FALL = 24;
const AIR_JUMPS = 2;
const COUNTDOWN = 180;

// ---------------------------------------------------------------- maps
export const MAPS = [
  {
    name: 'Kings Hall', theme: 0,
    solids: [{ x: -480, y: 0, w: 960, h: 520 }],
    softs: [{ x: -370, y: -175, w: 230 }, { x: 140, y: -175, w: 230 }, { x: -110, y: -330, w: 220 }],
    blast: { l: -1300, r: 1300, t: -950, b: 800 },
    spawns: [[-300, 0], [300, 0], [-110, 0], [110, 0]],
  },
  {
    name: 'Twin Isles', theme: 1,
    solids: [{ x: -640, y: 0, w: 450, h: 320 }, { x: 190, y: 0, w: 450, h: 320 }],
    softs: [{ x: -130, y: -130, w: 260 }, { x: -520, y: -260, w: 190 }, { x: 330, y: -260, w: 190 }],
    blast: { l: -1400, r: 1400, t: -950, b: 800 },
    spawns: [[-450, 0], [450, 0], [-300, 0], [300, 0]],
  },
  {
    name: 'Sky Ruins', theme: 2,
    solids: [{ x: -330, y: 0, w: 660, h: 140 }],
    softs: [{ x: -580, y: -120, w: 200 }, { x: 380, y: -120, w: 200 }, { x: -110, y: -270, w: 220 }],
    blast: { l: -1250, r: 1250, t: -900, b: 750 },
    spawns: [[-220, 0], [220, 0], [-80, 0], [80, 0]],
  },
];
for (const m of MAPS) {
  m.l = Math.min(...m.solids.map(s => s.x));
  m.r = Math.max(...m.solids.map(s => s.x + s.w));
}

// ---------------------------------------------------------------- legends
export const LEGENDS = [
  { name: 'Sigrun', title: 'The Valkyrie', color: '#4a7bd8', trim: '#f2d46b', skin: '#f3c9a0', hair: '#f6e08a', look: 0, weapons: ['sword', 'spear'], str: 5, dex: 6, def: 5, spd: 6 },
  { name: 'Borg', title: 'The Bear', color: '#9c5a32', trim: '#e6e6e6', skin: '#d9a67a', hair: '#5a3a22', look: 1, weapons: ['hammer', 'gauntlets'], str: 8, dex: 4, def: 7, spd: 3 },
  { name: 'Mako', title: 'Sky Pirate', color: '#2fa58d', trim: '#e8433a', skin: '#e8b48a', hair: '#2a2a2a', look: 2, weapons: ['blasters', 'sword'], str: 5, dex: 7, def: 4, spd: 6 },
  { name: 'Yumi', title: 'Shadow Blade', color: '#c43c6c', trim: '#2b2b3a', skin: '#f0d0b0', hair: '#1c1c28', look: 3, weapons: ['spear', 'blasters'], str: 4, dex: 7, def: 4, spd: 7 },
  { name: 'Ragnar', title: 'Iron Jarl', color: '#7a7f8c', trim: '#c9a227', skin: '#e0b090', hair: '#c0602a', look: 4, weapons: ['hammer', 'sword'], str: 7, dex: 5, def: 6, spd: 4 },
  { name: 'Kai', title: 'Storm Fist', color: '#e08a1e', trim: '#3b2a7a', skin: '#c58c5c', hair: '#101010', look: 5, weapons: ['gauntlets', 'spear'], str: 6, dex: 6, def: 4, spd: 6 },
];
for (const L of LEGENDS) {
  L.dmgMul = 0.82 + L.str * 0.035;
  L.weight = 0.82 + L.def * 0.035;
  L.run = 5.4 + L.spd * 0.33;
  L.jump = 13.2;
}

// ---------------------------------------------------------------- moves
// Hitbox: offset (x forward, y up from feet), size, damage, base knockback,
// knockback scaling, launch direction, active-frame window, hit group.
function H(x, y, w, h, dmg, kb, ks, dx, dy, f0 = 0, f1 = 99, g = 0) {
  const n = Math.sqrt(dx * dx + dy * dy);
  return { x, y, w, h, dmg, kb, ks, dx: dx / n, dy: dy / n, f0, f1, g };
}
function P(o) {
  const n = Math.sqrt(o.dx * o.dx + o.dy * o.dy);
  return { ...o, dx: o.dx / n, dy: o.dy / n };
}

// Move keys: n/s/d = neutral/side/down, l = light (ground), a = air light,
// s-suffix = signature (ground heavy), rec = recovery, gp = ground pound.
// vel: [fromFrame, toFrame, vx (facing-relative) | null, vy | null]
const BASE = {
  nl: { s: 5, a: 4, r: 12, hb: [H(24, -52, 44, 34, 7, 4, 4, 0.25, -1)] },
  sl: { s: 6, a: 4, r: 15, hb: [H(40, -38, 56, 28, 8, 4, 5, 1, -0.35)], vel: [[1, 9, 7, null]] },
  dl: { s: 5, a: 5, r: 14, hb: [H(36, -12, 66, 22, 7, 4, 4, 0.5, -1)], vel: [[0, 8, 6.5, null]] },
  na: { s: 5, a: 6, r: 12, air: 1, hb: [H(0, -38, 84, 70, 8, 4, 4, 0.2, -1)] },
  sa: { s: 6, a: 5, r: 14, air: 1, hb: [H(42, -36, 56, 32, 8, 4, 5, 1, -0.3)] },
  da: { s: 7, a: 6, r: 14, air: 1, hb: [H(14, 2, 48, 42, 8, 3, 4, 0.3, 1)] },
  ns: { s: 15, a: 6, r: 24, hb: [H(24, -66, 56, 74, 15, 6, 13, 0.15, -1)] },
  ss: { s: 17, a: 5, r: 24, hb: [H(48, -36, 66, 38, 16, 7, 13, 1, -0.4)], vel: [[5, 16, 11, null]] },
  ds: { s: 14, a: 6, r: 24, hb: [H(-50, -16, 70, 30, 14, 6, 12, -0.6, -1), H(50, -16, 70, 30, 14, 6, 12, 0.6, -1)] },
  rec: { s: 4, a: 14, r: 20, air: 1, rec: 1, hb: [H(14, -50, 54, 80, 10, 6, 6, 0.2, -1)], vel: [[0, 18, 2.5, -15.5]] },
  gp: { s: 7, a: 40, r: 16, air: 1, gp: 1, hb: [H(0, 6, 52, 44, 12, 5, 10, 0.25, 1)], vel: [[0, 7, 0, -1.5], [7, 47, 0, 19]] },
};
export const MOVE_KEYS = Object.keys(BASE);

const SHOT = P({ x: 30, y: -42, vx: 18, vy: 0, g: 0, life: 32, w: 26, h: 12, dmg: 6, kb: 3, ks: 4, dx: 1, dy: -0.2 });
export const WEAPON_DEFS = {
  unarmed: { r: 0.8, d: 0.8, k: 0.9, sp: 0.9 },
  sword: { r: 1.25, d: 1.0, k: 1.0, sp: 1.0 },
  hammer: { r: 1.4, d: 1.22, k: 1.12, sp: 1.3 },
  spear: { r: 1.65, d: 0.95, k: 1.0, sp: 1.12 },
  gauntlets: { r: 0.95, d: 0.92, k: 0.95, sp: 0.75 },
  blasters: {
    r: 1.05, d: 0.9, k: 0.95, sp: 1.0, over: {
      sl: { s: 5, a: 2, r: 16, hb: [], proj: SHOT, vel: [[0, 6, -2, null]] },
      sa: { s: 5, a: 2, r: 16, air: 1, hb: [], proj: SHOT },
      ns: { s: 16, a: 2, r: 26, hb: [H(30, -40, 50, 40, 8, 4, 6, 1, -0.5)], proj: P({ x: 30, y: -42, vx: 13, vy: 0, g: 0, life: 50, w: 44, h: 30, dmg: 14, kb: 6, ks: 11, dx: 1, dy: -0.45 }) },
    },
  },
};

export const MOVES = {};
for (const [wname, W] of Object.entries(WEAPON_DEFS)) {
  MOVES[wname] = {};
  for (const key of MOVE_KEYS) {
    const over = W.over && W.over[key];
    const b = over || BASE[key];
    const m = { ...b, key };
    if (!over) {
      m.s = Math.max(2, Math.round(b.s * W.sp));
      m.r = Math.max(4, Math.round(b.r * W.sp));
      m.hb = b.hb.map(h => ({ ...h, x: h.x * W.r, w: h.w * (0.4 + 0.6 * W.r), h: h.h * (0.7 + 0.3 * W.r), dmg: Math.round(h.dmg * W.d), ks: h.ks * W.k }));
    }
    MOVES[wname][key] = m;
  }
}

export function weaponOf(p) {
  return p.wpn < 0 ? 'unarmed' : LEGENDS[p.lg].weapons[p.wpn];
}
export function moveOf(p) {
  return MOVES[weaponOf(p)][p.mv];
}

// ---------------------------------------------------------------- state
function rnd(s) {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** cfg: { seed, map, mode (0 ffa, 1 teams), stocks, time (seconds, 0 = none), players: [{legend, team, bot}] } */
export function createMatch(cfg) {
  const map = MAPS[cfg.map] || MAPS[0];
  const s = {
    frame: 0, rng: cfg.seed | 0, map: MAPS.indexOf(map), mode: cfg.mode | 0,
    phase: 0, timer: COUNTDOWN, time: (cfg.time | 0) * FPS, endT: 0, winner: -1,
    nextPick: 40, eid: 1, players: [], proj: [], picks: [], ev: [],
  };
  cfg.players.forEach((pc, i) => {
    const sp = map.spawns[i % map.spawns.length];
    s.players.push({
      i, lg: pc.legend | 0, team: pc.team | 0, bot: pc.bot | 0,
      x: sp[0], y: sp[1], vx: 0, vy: 0, face: sp[0] < 0 ? 1 : -1,
      gr: 1, plat: -1, jumps: AIR_JUMPS, rec: 1, adodge: 1, dcd: 0,
      st: ST.STAND, t: 0, dk: 0, mv: '', mt: 0, hit: [], ng: 0,
      wpn: -1, dmg: 0, stocks: cfg.stocks || 3, hs: 0, hp: 0, inv: 0,
      inp: 0, pin: 0, buf: 0, bufT: 0, drop: 0, ff: 0, wall: 0,
      kos: 0, falls: 0, dealt: 0, last: -1, lastT: 0, resp: 0,
      ai: { t: 0 },
    });
  });
  return s;
}

export function cloneState(s) {
  const c = structuredClone({ ...s, ev: [] });
  return c;
}

const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
function mix(h, v) {
  f64[0] = v;
  h = Math.imul(h ^ u32[0], 16777619);
  return Math.imul(h ^ u32[1], 16777619);
}
const P_FIELDS = ['x', 'y', 'vx', 'vy', 'face', 'gr', 'jumps', 'rec', 'adodge', 'dcd', 'st', 't', 'mt', 'wpn', 'dmg', 'stocks', 'hs', 'hp', 'inv', 'buf', 'resp', 'kos'];
export function hashState(s) {
  let h = mix(2166136261 | 0, s.frame);
  h = mix(h, s.rng); h = mix(h, s.phase); h = mix(h, s.proj.length); h = mix(h, s.picks.length);
  for (const p of s.players) {
    for (const f of P_FIELDS) h = mix(h, p[f]);
    h = mix(h, MOVE_KEYS.indexOf(p.mv));
  }
  for (const q of s.proj) { h = mix(h, q.x); h = mix(h, q.y); h = mix(h, q.life); }
  for (const w of s.picks) { h = mix(h, w.x); h = mix(h, w.y); h = mix(h, w.slot); }
  return h >>> 0;
}

function ev(s, type, p, extra) {
  s.ev.push({ type, p: p ? p.i : -1, x: p ? p.x : 0, y: p ? p.y : 0, ...extra });
}
export function allies(s, a, b) {
  return s.mode === 1 && s.players[a].team === s.players[b].team;
}

// ---------------------------------------------------------------- step
/** Advance one frame in place. inputs[i] is the bitmask for player slot i. */
export function step(s, inputs) {
  s.ev = [];
  s.frame++;
  const map = MAPS[s.map];
  if (s.phase === 0 && --s.timer <= 0) { s.phase = 1; ev(s, 'go'); }

  for (const p of s.players) {
    let k = inputs[p.i] | 0;
    if (p.bot || (k & BOT_FLAG)) k = botInput(s, p, map);
    p.inp = s.phase === 1 ? k & INPUT_MASK : 0;
  }
  for (const p of s.players) updatePlayer(s, p, map);
  resolveHits(s);
  updateProjectiles(s, map);
  updatePickups(s, map);
  for (const p of s.players) p.pin = p.inp;

  if (s.phase === 1) checkEnd(s);
  else if (s.phase === 2) s.endT++;
}

function bufAct(p, a) { p.buf = a; p.bufT = 8; }

function updatePlayer(s, p, map) {
  if (p.st === ST.DEAD) {
    if (p.stocks > 0 && --p.resp <= 0) respawn(s, p, map);
    return;
  }
  const inp = p.inp, pin = p.pin;
  const pr = b => (inp & b) !== 0 && (pin & b) === 0;
  if (pr(B.JUMP)) bufAct(p, 1);
  if (pr(B.LIGHT)) bufAct(p, 2);
  if (pr(B.HEAVY)) bufAct(p, 3);
  if (pr(B.DODGE)) bufAct(p, 4);
  if (pr(B.THROW)) bufAct(p, 5);
  if (p.hp > 0) { p.hp--; return; } // hit-pause freeze

  if (p.inv > 0) p.inv--;
  if (p.dcd > 0) p.dcd--;
  if (p.drop > 0) p.drop--;
  if (p.bufT > 0 && --p.bufT === 0) p.buf = 0;
  const dx = ((inp & B.R) ? 1 : 0) - ((inp & B.L) ? 1 : 0);
  const dy = ((inp & B.D) ? 1 : 0) - ((inp & B.U) ? 1 : 0);
  const L = LEGENDS[p.lg];
  p.ng = 0;

  switch (p.st) {
    case ST.HIT:
      p.vx = p.vx * 0.955 + dx * 0.14;
      p.vy *= 0.955;
      if (p.gr) p.vx *= 0.85;
      if (--p.hs <= 0) p.st = p.gr ? ST.STAND : ST.AIR;
      break;
    case ST.DODGE:
      if (p.dk === 1) p.vx *= 0.86;
      else if (p.dk === 2) { p.vx *= 0.9; p.vy *= 0.9; }
      else if (p.dk === 3) { p.vx *= 0.8; p.vy = 0; }
      else p.vx *= 0.7;
      if (--p.t <= 0) p.st = p.gr ? ST.STAND : ST.AIR;
      break;
    case ST.LAG:
      p.vx *= p.gr ? 0.8 : 0.97;
      if (--p.t <= 0) p.st = p.gr ? ST.STAND : ST.AIR;
      break;
    case ST.MOVE:
      runMove(s, p, L, dx);
      break;
    default:
      actionable(s, p, L, dx, dy, pr);
  }

  // gravity
  let g = 1;
  if (p.st === ST.HIT) g = 0.5;
  else if (p.st === ST.DODGE && p.dk >= 2) g = 0;
  else if (p.st === ST.MOVE && p.ng) g = 0;
  else if (p.st === ST.AIR && p.vy < 0 && !(inp & (B.JUMP | B.U))) g = 1.8; // short hop
  if (!p.gr || p.st === ST.HIT) {
    p.vy += GRAV * g;
    const cap = p.st === ST.HIT ? HIT_FALL : p.ff ? FAST_FALL : (p.st === ST.MOVE && p.ng) ? 99 : MAX_FALL;
    if (p.vy > cap) p.vy = cap;
    if (p.st === ST.WALL && p.vy > 2.5) p.vy = 2.5;
  } else {
    p.vy += GRAV; // keeps us pressed against the floor so support is re-checked
  }

  const wasGr = p.gr;
  collide(p, map);
  if (p.gr && !wasGr) land(s, p);
  if (!p.gr && (p.st === ST.STAND)) p.st = ST.AIR;

  const bz = map.blast;
  if (p.x < bz.l || p.x > bz.r || p.y > bz.b || p.y < bz.t) ko(s, p);
}

function actionable(s, p, L, dx, dy, pr) {
  const b = p.buf;
  if (b) {
    let used = true;
    if (b === 1) {
      if (p.gr) { p.vy = -L.jump; p.gr = 0; p.st = ST.AIR; ev(s, 'jump', p); }
      else if (p.st === ST.WALL) { p.vx = -p.wall * 8; p.vy = -12.5; p.face = -p.wall; p.st = ST.AIR; ev(s, 'jump', p); }
      else if (p.jumps > 0) { p.jumps--; p.vy = -L.jump * 0.92; p.ff = 0; ev(s, 'jump2', p); }
      else used = false;
    } else if (b === 4) {
      if (p.dcd <= 0 && (p.gr || p.adodge)) startDodge(s, p, L, dx, dy); else used = false;
    } else if (b === 2 || b === 3) {
      if (!(b === 2 && p.wpn < 0 && tryPickup(s, p))) {
        const key = pickMove(p, b, dx, dy);
        if (key) startMove(s, p, key); else used = false;
      }
    } else if (b === 5) {
      if (p.wpn >= 0) throwWeapon(s, p, dx, dy);
      else if (!tryPickup(s, p)) used = false;
    }
    if (used) { p.buf = 0; p.bufT = 0; }
    if (p.st !== ST.STAND && p.st !== ST.AIR && p.st !== ST.WALL) return;
  }

  if (p.gr) {
    p.st = ST.STAND;
    const target = dx * L.run;
    const d = target - p.vx;
    p.vx += d > 1.3 ? 1.3 : d < -1.3 ? -1.3 : d;
    if (dx) p.face = dx;
    if (pr(B.D) && p.plat >= 0) { p.drop = 10; p.gr = 0; p.st = ST.AIR; p.y += 2; }
  } else {
    const am = L.run * 0.92;
    if (dx) { if (p.vx * dx < am) { p.vx += dx * 0.6; if (p.vx * dx > am) p.vx = am * dx; } }
    else p.vx *= 0.96;
    if (pr(B.D) && p.vy > -3) p.ff = 1;
    if (p.st === ST.WALL) {
      if (dx !== p.wall) p.st = ST.AIR;
      else p.vx = p.wall;
    } else if (p.wall && dx === p.wall && p.vy > 0) {
      p.st = ST.WALL; p.rec = 1; p.ff = 0; p.face = -p.wall;
      if (p.jumps < 1) p.jumps = 1;
    }
  }
}

function startDodge(s, p, L, dx, dy) {
  p.st = ST.DODGE;
  if (p.gr) {
    if (dx) { p.dk = 1; p.vx = dx * 14; p.t = 16; p.inv = 13; p.face = dx; }
    else { p.dk = 0; p.t = 18; p.inv = 16; }
    p.dcd = 45 - L.dex * 2;
  } else {
    if (dx || dy) {
      const n = dx && dy ? 0.7071 : 1;
      p.dk = 2; p.vx = dx * 13 * n; p.vy = dy * 13 * n; p.t = 16; p.inv = 13;
    } else { p.dk = 3; p.t = 18; p.inv = 16; }
    p.adodge = 0; p.ff = 0;
    p.dcd = 60 - L.dex * 2;
  }
  ev(s, 'dodge', p);
}

function pickMove(p, b, dx, dy) {
  let k;
  if (b === 2) k = p.gr ? (dy > 0 ? 'dl' : dx ? 'sl' : 'nl') : (dy > 0 ? 'da' : dx ? 'sa' : 'na');
  else if (p.gr) k = dy > 0 ? 'ds' : dx ? 'ss' : 'ns';
  else if (dy > 0) k = 'gp';
  else if (p.rec) k = 'rec';
  else return null;
  if (dx) p.face = dx;
  return k;
}

function startMove(s, p, key) {
  p.st = ST.MOVE; p.mv = key; p.mt = 0; p.hit = []; p.inv = 0; p.ff = 0;
  if (key === 'rec') p.rec = 0;
  ev(s, 'swing', p, { mv: key, heavy: key.length > 2 || key[1] === 's' });
}

function runMove(s, p, L, dx) {
  const m = moveOf(p);
  p.mt++;
  let setX = false;
  if (m.vel) for (const v of m.vel) {
    if (p.mt > v[0] && p.mt <= v[1]) {
      if (v[2] !== null) { p.vx = v[2] * p.face; setX = true; }
      if (v[3] !== null) { p.vy = v[3]; p.ng = 1; }
    }
  }
  if (!setX) {
    if (p.gr) p.vx *= 0.8;
    else {
      const am = L.run * 0.8;
      if (dx && p.vx * dx < am) p.vx += dx * 0.3;
      p.vx *= 0.99;
    }
  }
  if (m.proj && p.mt === m.s + 1) {
    const q = m.proj;
    s.proj.push({
      id: s.eid++, o: p.i, kind: 0, slot: -1, x: p.x + q.x * p.face, y: p.y + q.y,
      vx: q.vx * p.face, vy: q.vy, g: q.g, life: q.life, w: q.w, h: q.h,
      dmg: q.dmg, kb: q.kb, ks: q.ks, dx: q.dx, dy: q.dy,
    });
    ev(s, 'shot', p);
  }
  if (p.mt >= m.s + m.a + m.r) { p.st = p.gr ? ST.STAND : ST.AIR; p.mv = ''; }
}

function land(s, p) {
  p.jumps = AIR_JUMPS; p.rec = 1; p.adodge = 1; p.ff = 0;
  if (p.st === ST.AIR || p.st === ST.WALL) { p.st = ST.STAND; ev(s, 'land', p); }
  else if (p.st === ST.MOVE) {
    const m = moveOf(p);
    if (m.air) {
      p.st = ST.LAG; p.t = m.gp ? 12 : 5; p.mv = '';
      ev(s, m.gp ? 'pound' : 'land', p);
    }
  }
}

function collide(p, map) {
  p.wall = 0;
  p.x += p.vx;
  for (const b of map.solids) {
    if (p.x - HW < b.x + b.w && p.x + HW > b.x && p.y - PH < b.y + b.h && p.y > b.y) {
      if (p.x < b.x + b.w / 2) { p.x = b.x - HW; p.wall = 1; } else { p.x = b.x + b.w + HW; p.wall = -1; }
      p.vx = p.st === ST.HIT ? -p.vx * 0.4 : 0;
    }
  }
  const oy = p.y;
  p.y += p.vy;
  p.gr = 0; p.plat = -1;
  for (const b of map.solids) {
    if (p.x - HW < b.x + b.w && p.x + HW > b.x && p.y - PH < b.y + b.h && p.y > b.y) {
      if (oy <= b.y + 1) {
        p.y = b.y;
        if (p.st === ST.HIT && p.vy > 9) p.vy = -p.vy * 0.45; else { p.vy = 0; p.gr = 1; }
      } else { p.y = b.y + b.h + PH; if (p.vy < 0) p.vy = 0; }
    }
  }
  if (p.vy >= 0 && p.drop <= 0) {
    for (let k = 0; k < map.softs.length; k++) {
      const b = map.softs[k];
      if (oy <= b.y && p.y >= b.y && p.x + HW > b.x && p.x - HW < b.x + b.w) {
        p.y = b.y;
        if (p.st === ST.HIT && p.vy > 9) p.vy = -p.vy * 0.45; else { p.vy = 0; p.gr = 1; p.plat = k; }
      }
    }
  }
}

function respawn(s, p, map) {
  const sp = map.spawns[p.i % map.spawns.length];
  p.x = sp[0]; p.y = -420; p.vx = 0; p.vy = 0; p.dmg = 0;
  p.st = ST.AIR; p.inv = 150; p.jumps = AIR_JUMPS; p.rec = 1; p.adodge = 1;
  p.last = -1; p.gr = 0; p.ff = 0; p.buf = 0;
  ev(s, 'spawn', p);
}

function ko(s, p) {
  ev(s, 'ko', p, { vx: p.vx, vy: p.vy });
  p.stocks--; p.falls++;
  if (p.last >= 0 && s.frame - p.lastT < 900) s.players[p.last].kos++;
  p.st = ST.DEAD; p.resp = 110; p.wpn = -1; p.vx = 0; p.vy = 0;
  p.hs = 0; p.hp = 0; p.mv = ''; p.buf = 0;
}

function checkEnd(s) {
  const alive = s.players.filter(p => p.stocks > 0);
  const groups = new Set(alive.map(p => (s.mode === 1 ? p.team : p.i)));
  let over = s.players.length > 1 && groups.size <= 1;
  if (s.time > 0 && --s.time === 0) over = true;
  if (!over) return;
  const score = p => p.stocks * 10000 - p.dmg;
  const best = s.players.slice().sort((a, b) => score(b) - score(a) || a.i - b.i)[0];
  s.winner = s.mode === 1 ? best.team : best.i;
  s.phase = 2; s.endT = 0;
  ev(s, 'game');
}

// ---------------------------------------------------------------- combat
function hurtOverlap(d, x, y, w, h) {
  return d.x - HW < x + w && d.x + HW > x && d.y - PH < y + h && d.y > y;
}
function canBeHit(s, a, d) {
  return d !== a && d.st !== ST.DEAD && d.inv <= 0 && !allies(s, a.i, d.i);
}

function resolveHits(s) {
  for (const a of s.players) {
    if (a.st !== ST.MOVE || a.hp > 0) continue;
    const m = moveOf(a);
    const af = a.mt - m.s - 1;
    if (af < 0 || af >= m.a) continue;
    for (const h of m.hb) {
      if (af < h.f0 || af > h.f1) continue;
      const x = a.x + h.x * a.face - h.w / 2, y = a.y + h.y - h.h / 2;
      for (const d of s.players) {
        if (!canBeHit(s, a, d)) continue;
        const key = d.i * 8 + h.g;
        if (a.hit.includes(key)) continue;
        if (hurtOverlap(d, x, y, h.w, h.h)) {
          a.hit.push(key);
          applyHit(s, a, d, h, a.face, true);
        }
      }
    }
  }
}

function applyHit(s, a, d, h, face, melee) {
  const dmg = Math.max(1, Math.round(h.dmg * LEGENDS[a.lg].dmgMul));
  d.dmg = Math.min(999, d.dmg + dmg);
  a.dealt += dmg;
  const F = (h.kb + h.ks * d.dmg / 38) / LEGENDS[d.lg].weight;
  const kx = h.dx * face;
  let ky = h.dy;
  if (d.gr && ky > 0) ky = -ky * 0.6;
  d.vx = kx * F; d.vy = ky * F;
  if (d.vy < 0) d.gr = 0;
  d.st = ST.HIT; d.hs = Math.min(55, Math.floor(6 + F * 1.15));
  const hp = Math.min(13, 3 + Math.floor(dmg / 3));
  d.hp = hp;
  if (melee) a.hp = hp;
  d.mv = ''; d.ff = 0; d.buf = 0;
  d.rec = 1; d.adodge = 1; d.jumps = AIR_JUMPS;
  d.last = a.i; d.lastT = s.frame;
  ev(s, 'hit', d, { y: d.y - PH / 2, dmg, F, a: a.i, kx, ky });
}

function updateProjectiles(s, map) {
  for (let k = s.proj.length - 1; k >= 0; k--) {
    const q = s.proj[k];
    q.x += q.vx; q.y += q.vy; q.vy += q.g; q.life--;
    let dead = q.life <= 0;
    if (!dead) {
      for (const b of map.solids) {
        if (q.x > b.x && q.x < b.x + b.w && q.y > b.y && q.y < b.y + b.h) { dead = true; break; }
      }
      if (!dead && q.kind === 1 && q.vy > 0) {
        for (const b of map.softs) {
          if (q.x > b.x && q.x < b.x + b.w && q.y >= b.y && q.y - q.vy <= b.y) { dead = true; break; }
        }
      }
      if (dead && q.kind === 1) addPickup(s, q.x - q.vx * 2, Math.min(q.y - q.vy * 2, q.y - 10), q.slot, 360);
    }
    if (!dead) {
      const a = s.players[q.o];
      for (const d of s.players) {
        if (!canBeHit(s, a, d)) continue;
        if (hurtOverlap(d, q.x - q.w / 2, q.y - q.h / 2, q.w, q.h)) {
          applyHit(s, a, d, q, q.vx >= 0 ? 1 : -1, false);
          dead = true;
          break;
        }
      }
    }
    if (dead) s.proj.splice(k, 1);
  }
}

function throwWeapon(s, p, dx, dy) {
  let vx, vy;
  if (dy < 0) { vx = p.face * 3 + dx * 3; vy = -16; }
  else if (dy > 0 && !p.gr) { vx = p.face * 7; vy = 13; }
  else { if (dx) p.face = dx; vx = p.face * 17; vy = -3; }
  s.proj.push({
    id: s.eid++, o: p.i, kind: 1, slot: p.wpn, x: p.x + p.face * 20, y: p.y - 44,
    vx, vy, g: 0.3, life: 90, w: 38, h: 26, dmg: 10, kb: 5, ks: 6, dx: 0.91, dy: -0.41,
  });
  p.wpn = -1; p.st = ST.LAG; p.t = 10;
  ev(s, 'throw', p);
}

function addPickup(s, x, y, slot, life) {
  s.picks.push({ id: s.eid++, x, y, vy: 0, gr: 0, slot, life });
}

function tryPickup(s, p) {
  for (let k = 0; k < s.picks.length; k++) {
    const w = s.picks[k];
    if (Math.abs(w.x - p.x) < 46 && w.y > p.y - PH - 14 && w.y < p.y + 24) {
      p.wpn = w.slot;
      s.picks.splice(k, 1);
      ev(s, 'pickup', p);
      return true;
    }
  }
  return false;
}

function updatePickups(s, map) {
  if (s.phase === 1 && --s.nextPick <= 0) {
    s.nextPick = 420 + Math.floor(rnd(s) * 300);
    const n = s.picks.length < 2 ? 2 : s.picks.length < 4 ? 1 : 0;
    for (let j = 0; j < n; j++) {
      const sol = map.solids[Math.floor(rnd(s) * map.solids.length)];
      addPickup(s, sol.x + 40 + rnd(s) * (sol.w - 80), map.blast.t + 250, rnd(s) < 0.5 ? 0 : 1, 1500);
    }
  }
  for (let k = s.picks.length - 1; k >= 0; k--) {
    const w = s.picks[k];
    if (--w.life <= 0 || w.y > map.blast.b) { s.picks.splice(k, 1); continue; }
    if (w.gr) continue;
    const oy = w.y;
    w.vy = Math.min(w.vy + 0.3, 9);
    w.y += w.vy;
    for (const b of map.solids.concat(map.softs)) {
      if (w.x >= b.x && w.x <= b.x + b.w && oy <= b.y && w.y >= b.y) { w.y = b.y; w.gr = 1; w.vy = 0; }
    }
  }
}

// ---------------------------------------------------------------- bots
// Bot "brains" run inside the deterministic sim, so bots cost no bandwidth
// and every client predicts them perfectly.
function solidUnder(map, x) {
  for (const b of map.solids) if (x >= b.x && x <= b.x + b.w) return b;
  return null;
}

function botInput(s, p, map) {
  if (p.st === ST.DEAD || s.phase !== 1) return 0;
  const lvl = p.bot || 2;
  const tap = b => (p.pin & b ? 0 : b);
  let k = 0;

  // recovery: get back over solid ground
  const sol = solidUnder(map, p.x);
  if (!p.gr && (!sol || p.y > sol.y + 4)) {
    let dir;
    if (sol) dir = p.x < sol.x + sol.w / 2 ? -1 : 1; // under the stage: get out sideways
    else {
      let best = null, bd = 1e9;
      for (const b of map.solids) {
        const ex = Math.max(b.x + 40, Math.min(b.x + b.w - 40, p.x));
        const d = Math.abs(ex - p.x);
        if (d < bd) { bd = d; best = ex; }
      }
      dir = best < p.x ? -1 : 1;
    }
    k |= dir < 0 ? B.L : B.R;
    if (p.st === ST.WALL) return tap(B.JUMP) | (dir < 0 ? B.L : B.R);
    if (p.vy > -1 && p.y > -140) {
      if (p.jumps > 0) k |= tap(B.JUMP);
      else if (p.rec && p.vy > 0) k |= tap(B.HEAVY);
      else if (p.adodge && p.dcd <= 0 && p.vy > 4) k |= tap(B.DODGE) | B.U;
    }
    return k;
  }

  // find a target
  let t = null, best = 1e9;
  for (const o of s.players) {
    if (o === p || o.st === ST.DEAD || allies(s, o.i, p.i)) continue;
    const d = Math.abs(o.x - p.x) + Math.abs(o.y - p.y);
    if (d < best) { best = d; t = o; }
  }

  // grab a weapon if one is close
  if (p.wpn < 0 && s.picks.length) {
    let w = null, wd = 1e9;
    for (const c of s.picks) {
      const d = Math.abs(c.x - p.x) + Math.abs(c.y - p.y);
      if (c.gr && d < wd) { wd = d; w = c; }
    }
    if (w && (!t || wd < best + 250)) {
      if (Math.abs(w.x - p.x) > 30) k |= w.x < p.x ? B.L : B.R;
      else if (Math.abs(w.y - p.y) < 60) return k | tap(B.THROW);
      if (w.y < p.y - 90 && p.gr) k |= tap(B.JUMP);
      if (w.y > p.y + 60 && p.gr && p.plat >= 0) k |= tap(B.D);
      return k;
    }
  }
  if (!t) return 0;

  const dx = t.x - p.x, dy = t.y - p.y, adx = Math.abs(dx);
  const dir = dx < 0 ? -1 : 1;
  const reach = p.wpn < 0 ? 70 : 105;
  if (adx > reach * 0.7) k |= dir < 0 ? B.L : B.R;
  // don't run off a ledge chasing someone
  if (p.gr && (k & (B.L | B.R)) && p.plat < 0 && !solidUnder(map, p.x + dir * 50)) k &= ~(B.L | B.R);
  if (dy < -110 && adx < 320 && (p.gr || (p.jumps > 0 && p.vy > 0))) k |= tap(B.JUMP);
  if (p.gr && p.plat >= 0 && dy > 90 && adx < 260) k |= tap(B.D);

  const react = lvl >= 3 ? 3 : lvl === 2 ? 8 : 18;
  if (--p.ai.t > 0) return k;
  p.ai.t = react + Math.floor(rnd(s) * react);
  const r = rnd(s);
  const toward = dir < 0 ? B.L : B.R, away = dir < 0 ? B.R : B.L;
  if (t.st === ST.MOVE && adx < 160 && Math.abs(dy) < 120 && p.dcd <= 0 && r < [0, 0.1, 0.3, 0.55][lvl]) {
    return (k & ~(B.L | B.R)) | tap(B.DODGE) | away;
  }
  if (adx < reach && Math.abs(dy) < 70) {
    k &= ~(B.L | B.R);
    if (t.dmg > 90 && r < 0.55 && p.gr) return k | toward | tap(B.HEAVY);
    if (r < 0.55) return k | toward | tap(B.LIGHT);
    if (r < 0.8 && p.gr) return k | B.D | tap(B.LIGHT);
    return k | tap(B.LIGHT);
  }
  if (adx < 90 && dy < -50 && dy > -230) return p.gr ? k | tap(B.JUMP) : (k & ~(B.L | B.R)) | tap(B.LIGHT);
  if (!p.gr && adx < 70 && dy > 40 && dy < 260) return (k & ~(B.L | B.R)) | B.D | tap(B.LIGHT);
  if (p.wpn >= 0 && adx > 220 && adx < 600 && Math.abs(dy) < 60 && r < 0.05 * lvl) return (k & ~(B.L | B.R)) | toward | tap(B.THROW);
  return k;
}
