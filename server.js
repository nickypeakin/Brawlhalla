// Brawlheim server: static files + lobbies + authoritative rollback relay.
//
// Netcode model (what Brawlhalla, Smash/Slippi and GGPO games do, plus the
// Overwatch trick for clock sync):
//  * Every client runs the same deterministic sim (shared/sim.js).
//  * Clients run a few frames AHEAD of the server and send their input for
//    each frame. The server is the input authority: when it simulates frame F
//    it uses each player's input for F if it arrived in time, otherwise it
//    repeats their previous input. It then broadcasts the final inputs.
//  * Clients predict remote players (repeat last input), and roll back +
//    re-simulate when the confirmed inputs arrive.
//  * The server tells each client how early its inputs arrive ("lead"); the
//    client speeds up / slows down its clock to keep ~2 frames of buffer.
//  * Periodic state hashes catch desyncs; a desynced (or late-joining)
//    client gets a full snapshot.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createMatch, step, hashState, FPS, LEGENDS, MAPS, BOT_FLAG, INPUT_MASK } from './shared/sim.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const FRAME_MS = 1000 / FPS;
const MAX_SLOTS = 4;
const HASH_EVERY = 30;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
  if (url === '/') url = '/index.html';
  const isShared = url.startsWith('/shared/');
  const base = path.join(ROOT, isShared ? 'shared' : 'public');
  const file = path.normalize(path.join(base, isShared ? url.slice(7) : url));
  if (!file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});

const wss = new WebSocketServer({ server, maxPayload: 32 * 1024 });
const rooms = new Map();
let nextId = 1;

const send = (c, m) => { if (c.ws.readyState === 1) c.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); };
const clean = (s, n = 16) => String(s ?? '').replace(/[^\p{L}\p{N} _\-.!?']/gu, '').trim().slice(0, n);
const int = (v, lo, hi, d) => { v = Math.floor(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do { code = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(code));
  return code;
}

class Room {
  constructor(isPublic) {
    this.code = makeCode();
    this.public = isPublic;
    this.members = [];
    this.slots = [];
    this.host = null;
    this.settings = { map: 0, stocks: 3, mode: 0, time: 0 };
    this.match = null;
    this.chat = [];
    rooms.set(this.code, this);
  }
  broadcast(m) { const s = JSON.stringify(m); for (const c of this.members) send(c, s); }
  sync() {
    this.broadcast({
      t: 'room', code: this.code, public: this.public, host: this.host?.id, settings: this.settings,
      inMatch: !!this.match,
      slots: this.slots.map(sl => ({ kind: sl.kind, cid: sl.c?.id ?? 0, name: sl.kind === 'bot' ? sl.name : sl.c.name, legend: sl.legend, team: sl.team, ready: sl.ready, level: sl.level })),
      spectators: this.members.filter(c => !this.slots.some(s => s.c === c)).map(c => c.name),
    });
  }
  add(c) {
    this.members.push(c);
    c.room = this;
    if (!this.host) this.host = c;
    if (this.slots.length < MAX_SLOTS && !this.match) {
      this.slots.push({ kind: 'human', c, legend: Math.floor(Math.random() * LEGENDS.length), team: this.slots.length % 2, ready: false });
    } else if (this.slots.length >= MAX_SLOTS) {
      // replace a bot if the room is full of bots
      const bi = this.slots.findIndex(s => s.kind === 'bot');
      if (bi >= 0 && !this.match) this.slots[bi] = { kind: 'human', c, legend: this.slots[bi].legend, team: this.slots[bi].team, ready: false };
    }
    if (this.match) {
      // late joiner: spectate from a snapshot
      send(c, { t: 'start', cfg: this.match.cfg, slot: -1 });
      c.needSnap = true;
    }
    for (const line of this.chat) send(c, line);
    this.sync();
  }
  remove(c) {
    this.members = this.members.filter(x => x !== c);
    const si = this.slots.findIndex(s => s.c === c);
    if (this.match) {
      const slot = this.match.slotOf.get(c.id);
      if (slot !== undefined) { this.match.last[slot] = BOT_FLAG; this.match.pending[slot].clear(); this.match.slotOf.delete(c.id); }
      if (si >= 0) this.slots[si] = { kind: 'bot', name: `${c.name} (bot)`, legend: this.slots[si].legend, team: this.slots[si].team, level: 2, ready: true };
    } else if (si >= 0) this.slots.splice(si, 1);
    c.room = null;
    if (this.host === c) this.host = this.members[0] || null;
    if (!this.members.length) { rooms.delete(this.code); return; }
    if (!this.match) this.slots = this.slots.filter(s => s.kind === 'human' || this.slots.some(h => h.kind === 'human'));
    this.sync();
  }
  start(by) {
    if (this.match) return;
    if (this.slots.length < 2) return send(by, { t: 'err', msg: 'Need at least 2 fighters - add a bot!' });
    const cfg = {
      seed: (Math.random() * 2 ** 31) | 0, ...this.settings,
      players: this.slots.map(s => ({ legend: s.legend, team: s.team, bot: s.kind === 'bot' ? s.level : 0, name: s.kind === 'bot' ? s.name : s.c.name })),
    };
    const m = this.match = {
      cfg, state: createMatch(cfg), frame: 0,
      last: cfg.players.map(() => 0), pending: cfg.players.map(() => new Map()),
      slotOf: new Map(), t0: performance.now() + 250,
    };
    this.slots.forEach((s, i) => { if (s.kind === 'human') m.slotOf.set(s.c.id, i); });
    for (const c of this.members) send(c, { t: 'start', cfg, slot: m.slotOf.get(c.id) ?? -1 });
    this.sync();
  }
  tick() {
    const m = this.match;
    const F = m.frame + 1;
    const inputs = m.last.map((prev, slot) => {
      const v = m.pending[slot].get(F);
      if (v === undefined) return prev;
      m.pending[slot].delete(F);
      return (m.last[slot] = v);
    });
    step(m.state, inputs);
    m.frame = F;
    const h = F % HASH_EVERY === 0 ? hashState(m.state) : undefined;
    for (const c of this.members) {
      send(c, { t: 'f', f: F, i: inputs, l: c.lead, h });
      if (c.needSnap) { c.needSnap = false; send(c, { t: 'snap', f: F, s: { ...m.state, ev: [] }, li: m.last }); }
    }
    if (m.state.phase === 2 && m.state.endT > 240) this.end();
  }
  end() {
    const s = this.match.state;
    this.broadcast({ t: 'end', winner: s.winner });
    this.match = null;
    this.slots = this.slots.filter(sl => sl.kind === 'bot' ? !sl.name.endsWith('(bot)') : this.members.includes(sl.c));
    for (const sl of this.slots) sl.ready = sl.kind === 'bot';
    this.sync();
  }
}

function leave(c) { if (c.room) c.room.remove(c); }

function handle(c, m) {
  const r = c.room;
  const isHost = r && r.host === c;
  switch (m.t) {
    case 'hello': c.name = clean(m.name) || `Brawler${c.id}`; break;
    case 'ping': send(c, { t: 'pong', c: m.c }); break;
    case 'quick': {
      leave(c);
      const open = [...rooms.values()].find(x => x.public && !x.match && x.slots.filter(s => s.kind === 'human').length < MAX_SLOTS);
      (open || new Room(true)).add(c);
      break;
    }
    case 'create': leave(c); new Room(!!m.public).add(c); break;
    case 'join': {
      const target = rooms.get(clean(m.code, 4).toUpperCase());
      if (!target) return send(c, { t: 'err', msg: 'Room not found' });
      if (target !== r) { leave(c); target.add(c); }
      break;
    }
    case 'leave': leave(c); send(c, { t: 'left' }); break;
    case 'chat': {
      if (!r) return;
      const text = String(m.text ?? '').slice(0, 120).trim();
      if (!text) return;
      const line = { t: 'chat', name: c.name, text };
      r.chat = [...r.chat.slice(-19), line];
      r.broadcast(line);
      break;
    }
    case 'pick': case 'team': case 'ready': {
      const sl = r && !r.match && r.slots.find(s => s.c === c);
      if (!sl) return;
      if (m.t === 'pick') sl.legend = int(m.legend, 0, LEGENDS.length - 1, 0);
      if (m.t === 'team') sl.team = int(m.team, 0, 1, 0);
      if (m.t === 'ready') sl.ready = !!m.v;
      r.sync();
      if (r.slots.length >= 2 && r.slots.every(s => s.ready)) r.start(c);
      break;
    }
    case 'set':
      if (!isHost || r.match) return;
      r.settings = {
        map: int(m.map, 0, MAPS.length - 1, r.settings.map), stocks: int(m.stocks, 1, 9, r.settings.stocks),
        mode: int(m.mode, 0, 1, r.settings.mode), time: int(m.time, 0, 600, r.settings.time),
      };
      r.sync();
      break;
    case 'bot':
      if (!isHost || r.match || r.slots.length >= MAX_SLOTS) return;
      r.slots.push({ kind: 'bot', name: `Bot ${r.slots.length + 1}`, legend: Math.floor(Math.random() * LEGENDS.length), team: r.slots.length % 2, level: int(m.level, 1, 3, 2), ready: true });
      r.sync();
      break;
    case 'botcfg': {
      const sl = isHost && !r.match && r.slots[int(m.i, 0, MAX_SLOTS, -1)];
      if (!sl || sl.kind !== 'bot') return;
      if (m.remove) r.slots.splice(r.slots.indexOf(sl), 1);
      else { sl.legend = int(m.legend, 0, LEGENDS.length - 1, sl.legend); sl.level = int(m.level, 1, 3, sl.level); sl.team = int(m.team, 0, 1, sl.team); }
      r.sync();
      break;
    }
    case 'start': if (isHost) r.start(c); break;
    case 'i': {
      const mt = r && r.match;
      const slot = mt && mt.slotOf.get(c.id);
      if (slot === undefined || !Array.isArray(m.k)) return;
      const f0 = int(m.f, 0, 1e9, 0);
      for (let j = 0; j < m.k.length && j < 30; j++) {
        const f = f0 + j;
        if (f > mt.frame && f <= mt.frame + 240) mt.pending[slot].set(f, (m.k[j] | 0) & INPUT_MASK);
      }
      c.lead = f0 + m.k.length - 1 - mt.frame;
      break;
    }
    case 'sync': if (r && r.match) c.needSnap = true; break;
  }
}

wss.on('connection', ws => {
  const c = { id: nextId++, ws, name: `Brawler${nextId}`, room: null, lead: 0, needSnap: false };
  ws.on('message', data => {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (m && typeof m.t === 'string') handle(c, m);
  });
  ws.on('close', () => leave(c));
  ws.on('error', () => {});
  send(c, { t: 'welcome', id: c.id });
});

// Fixed-timestep loop with catch-up (Gaffer on Games, "Fix Your Timestep").
let running = true;
function loop() {
  if (!running) return;
  const now = performance.now();
  for (const r of rooms.values()) {
    const m = r.match;
    if (!m) continue;
    let n = 0;
    while (r.match === m && now - m.t0 >= (m.frame + 1) * FRAME_MS && n++ < 8) r.tick();
    if (r.match === m && n >= 8) m.t0 = now - m.frame * FRAME_MS; // fell far behind: don't spiral
  }
  setTimeout(loop, 2);
}
loop();

server.listen(PORT, () => console.log(`Brawlheim running at http://localhost:${server.address().port}`));

export function stop() {
  running = false;
  for (const c of wss.clients) c.terminate();
  wss.close();
  server.close();
}
export { server };
