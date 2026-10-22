import { LEGENDS, MAPS, ST } from '/shared/sim.js';
import { Renderer, drawPreview, PLAYER_COLORS, TEAM_COLORS } from './render.js';
import { Net, LocalSession, OnlineSession } from './session.js';
import { DEVICES, connectedPads } from './input.js';
import { unlockAudio, setMuted, muted, sfx } from './audio.js';

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const renderer = new Renderer($('game'));
let net = null, room = null, session = null, screen = 'menu', myId = 0;
let mode = 'menu'; // menu | local | online
let demo = null;
let onlineDevice = store.get('device', 'kb');
let lastLocal = null;

// ------------------------------------------------------------ helpers
function show(id) {
  screen = id;
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
}
let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
const myName = () => ($('name').value.trim() || 'Brawler').slice(0, 16);
const legendOptions = sel => LEGENDS.map((L, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${L.name} - ${L.title}</option>`).join('');
const statLine = L => `STR ${L.str} · DEX ${L.dex} · DEF ${L.def} · SPD ${L.spd}<br>${L.weapons.join(' + ')}`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
for (const id of ['set-map', 'l-map']) $(id).innerHTML = MAPS.map((m, i) => `<option value="${i}">${m.name}</option>`).join('');

$('name').value = store.get('name', '');
$('name').addEventListener('change', () => { store.set('name', myName()); if (net && net.open) net.send({ t: 'hello', name: myName() }); });
addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);
$('btn-mute').onclick = () => { setMuted(!muted); $('btn-mute').textContent = muted ? '🔇' : '🔊'; };
document.addEventListener('click', e => { if (e.target instanceof HTMLButtonElement) sfx.click(); });

// ------------------------------------------------------------ attract mode
function startDemo() {
  const cfg = {
    seed: (Math.random() * 1e9) | 0, map: Math.floor(Math.random() * MAPS.length), mode: 0, stocks: 2, time: 0,
    players: [0, 1, 2, 3].map(i => ({ legend: (i * 2 + Math.floor(Math.random() * 6)) % LEGENDS.length, bot: 3, name: '' })),
  };
  cfg.players.forEach((p, i) => { p.name = LEGENDS[p.legend].name; });
  demo = new LocalSession(cfg, [null, null, null, null]);
  renderer.reset(cfg, -1);
}

// ------------------------------------------------------------ networking
function ensureNet() {
  if (net && net.open) return Promise.resolve(net);
  return new Promise((resolve, reject) => {
    $('status').textContent = 'Connecting...';
    net = new Net();
    const timer = setTimeout(() => reject(new Error('timeout')), 6000);
    net.on.open = () => { clearTimeout(timer); $('status').textContent = ''; net.send({ t: 'hello', name: myName() }); resolve(net); };
    net.on.close = () => {
      clearTimeout(timer);
      if (mode === 'online' || screen === 'lobby') { toast('Disconnected from server'); backToMenu(); }
      reject(new Error('closed'));
    };
    net.on.welcome = m => { myId = m.id; };
    net.on.err = m => toast(m.msg);
    net.on.room = onRoom;
    net.on.start = onStart;
    net.on.f = m => { if (session instanceof OnlineSession) session.onFrame(m); };
    net.on.snap = m => { if (session instanceof OnlineSession) session.onSnap(m); };
    net.on.end = onEnd;
    net.on.chat = m => {
      const log = $('chat-log');
      log.insertAdjacentHTML('beforeend', `<div><b>${esc(m.name)}:</b> ${esc(m.text)}</div>`);
      log.scrollTop = log.scrollHeight;
    };
    net.on.left = () => { room = null; backToMenu(); };
  });
}

async function online(msg) {
  store.set('name', myName());
  try { await ensureNet(); } catch { $('status').textContent = 'Could not reach the server. Run `npm start` and open http://localhost:3000'; return; }
  $('chat-log').innerHTML = '';
  net.send(msg);
}

function onRoom(m) {
  room = m;
  if (mode !== 'online') { show('lobby'); renderLobby(); history.replaceState(null, '', `?room=${m.code}`); }
}

function onStart(m) {
  mode = 'online';
  demo = null;
  session = new OnlineSession(net, m.cfg, m.slot, onlineDevice);
  renderer.quiet = false;
  renderer.reset(m.cfg, m.slot);
  show('none');
  if (m.slot < 0) toast('Spectating match in progress');
}

function onEnd() {
  if (!(session instanceof OnlineSession)) return;
  showResults(session.conf, session.cfg, true);
}

// ------------------------------------------------------------ lobby UI
function renderLobby() {
  if (!room) return;
  const isHost = room.host === myId;
  $('room-code').textContent = room.code;
  const mine = room.slots.findIndex(s => s.cid === myId);
  const html = [];
  for (let i = 0; i < 4; i++) {
    const sl = room.slots[i];
    if (!sl) {
      html.push(`<div class="slot empty"><div>Open slot</div>${isHost ? '<button class="small" data-act="addbot">+ Add bot</button>' : ''}</div>`);
      continue;
    }
    const L = LEGENDS[sl.legend];
    const color = room.settings.mode === 1 ? TEAM_COLORS[sl.team] : PLAYER_COLORS[i];
    const editable = i === mine || (isHost && sl.kind === 'bot');
    const badge = sl.kind === 'bot' ? `<span class="badge">BOT</span>` : sl.ready ? `<span class="badge ready">READY</span>` : `<span class="badge">...</span>`;
    html.push(`<div class="slot ${i === mine ? 'me' : ''}" style="border-color:${color}">
      <div class="who"><span style="color:${color}">${esc(sl.name)}${sl.cid === room.host ? ' 👑' : ''}</span>${badge}</div>
      <canvas data-preview="${sl.legend}" data-color="${color}"></canvas>
      <select data-i="${i}" data-act="legend" ${editable ? '' : 'disabled'}>${legendOptions(sl.legend)}</select>
      <div class="stats">${statLine(L)}</div>
      ${room.settings.mode === 1 ? `<select data-i="${i}" data-act="team" ${editable ? '' : 'disabled'}><option value="0" ${sl.team === 0 ? 'selected' : ''}>Red team</option><option value="1" ${sl.team === 1 ? 'selected' : ''}>Blue team</option></select>` : ''}
      ${sl.kind === 'bot' && isHost ? `<div class="row"><select data-i="${i}" data-act="level">${['Easy', 'Normal', 'Hard'].map((n, k) => `<option value="${k + 1}" ${sl.level === k + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select><button class="small danger" data-i="${i}" data-act="rmbot">Remove</button></div>` : ''}
    </div>`);
  }
  $('slots').innerHTML = html.join('');
  for (const el of $('host-tools').querySelectorAll('select,button')) el.disabled = !isHost;
  $('set-map').value = room.settings.map;
  $('set-stocks').value = room.settings.stocks;
  $('set-mode').value = room.settings.mode;
  $('set-time').value = room.settings.time;
  $('btn-start').classList.toggle('hidden', !isHost);
  const me = room.slots[mine];
  $('btn-ready').disabled = !me;
  $('btn-ready').textContent = me && me.ready ? 'Ready ✓' : 'Ready';
  $('btn-ready').classList.toggle('on', !!(me && me.ready));
  $('spectators').textContent = room.spectators.length ? `Spectating: ${room.spectators.join(', ')}` : room.inMatch ? 'Match in progress...' : '';
  $('online-device').innerHTML = deviceOptions(onlineDevice, false);
}

$('slots').addEventListener('change', e => {
  const el = e.target, i = +el.dataset.i, act = el.dataset.act;
  if (!room) return;
  const sl = room.slots[i];
  if (sl.kind === 'bot') net.send({ t: 'botcfg', i, legend: act === 'legend' ? +el.value : sl.legend, level: act === 'level' ? +el.value : sl.level, team: act === 'team' ? +el.value : sl.team });
  else if (act === 'legend') net.send({ t: 'pick', legend: +el.value });
  else if (act === 'team') net.send({ t: 'team', team: +el.value });
});
$('slots').addEventListener('click', e => {
  const act = e.target.dataset && e.target.dataset.act;
  if (act === 'addbot') net.send({ t: 'bot', level: 2 });
  if (act === 'rmbot') net.send({ t: 'botcfg', i: +e.target.dataset.i, remove: true });
});
const sendSettings = () => net.send({ t: 'set', map: +$('set-map').value, stocks: +$('set-stocks').value, mode: +$('set-mode').value, time: +$('set-time').value });
for (const id of ['set-map', 'set-stocks', 'set-mode', 'set-time']) $(id).addEventListener('change', sendSettings);
$('btn-addbot').onclick = () => net.send({ t: 'bot', level: 2 });
$('btn-ready').onclick = () => { const me = room && room.slots.find(s => s.cid === myId); if (me) net.send({ t: 'ready', v: !me.ready }); };
$('btn-start').onclick = () => net.send({ t: 'start' });
$('btn-leave').onclick = () => { net.send({ t: 'leave' }); history.replaceState(null, '', location.pathname); };
$('btn-copy').onclick = async () => {
  const link = `${location.origin}${location.pathname}?room=${room.code}`;
  try { await navigator.clipboard.writeText(link); toast('Invite link copied!'); } catch { toast(link); }
};
$('online-device').onchange = e => { onlineDevice = e.target.value; store.set('device', onlineDevice); };
$('chat-in').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.value.trim()) { net.send({ t: 'chat', text: e.target.value }); e.target.value = ''; }
});

// ------------------------------------------------------------ local battle
const localSlots = [
  { dev: 'kb1', legend: 0, team: 0 }, { dev: 'bot2', legend: 1, team: 1 },
  { dev: 'off', legend: 2, team: 0 }, { dev: 'off', legend: 3, team: 1 },
];
function deviceOptions(sel, withBots = true) {
  const pads = connectedPads();
  const opts = [];
  if (withBots) opts.push(['off', 'Empty']);
  opts.push(['kb', 'Keyboard (all keys)'], ['kb1', 'Keyboard: WASD + JKL'], ['kb2', 'Keyboard: Arrows + , . /']);
  for (let i = 0; i < 4; i++) opts.push([`pad${i}`, `Gamepad ${i + 1}${pads.includes(i) ? '' : ' (press a button)'}`]);
  if (withBots) opts.push(['bot1', 'Bot - Easy'], ['bot2', 'Bot - Normal'], ['bot3', 'Bot - Hard']);
  return opts.map(([v, n]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${n}</option>`).join('');
}
function renderLocal() {
  const teams = +$('l-mode').value === 1;
  $('local-slots').innerHTML = localSlots.map((sl, i) => {
    const color = teams ? TEAM_COLORS[sl.team] : PLAYER_COLORS[i];
    const L = LEGENDS[sl.legend];
    return `<div class="slot" style="border-color:${sl.dev === 'off' ? '#333' : color}">
      <div class="who"><span style="color:${color}">Player ${i + 1}</span></div>
      <select data-i="${i}" data-k="dev">${deviceOptions(sl.dev)}</select>
      ${sl.dev === 'off' ? '' : `<canvas data-preview="${sl.legend}" data-color="${color}"></canvas>
      <select data-i="${i}" data-k="legend">${legendOptions(sl.legend)}</select>
      <div class="stats">${statLine(L)}</div>
      ${teams ? `<select data-i="${i}" data-k="team"><option value="0" ${sl.team === 0 ? 'selected' : ''}>Red team</option><option value="1" ${sl.team === 1 ? 'selected' : ''}>Blue team</option></select>` : ''}`}
    </div>`;
  }).join('');
}
$('local-slots').addEventListener('change', e => {
  const i = +e.target.dataset.i, k = e.target.dataset.k;
  localSlots[i][k] = k === 'dev' ? e.target.value : +e.target.value;
  renderLocal();
});
$('l-mode').addEventListener('change', renderLocal);
addEventListener('gamepadconnected', () => { if (screen === 'local') renderLocal(); if (screen === 'lobby') renderLobby(); });

function startLocal(cfg) {
  const devices = [], players = [];
  if (!cfg) {
    for (const sl of localSlots) {
      if (sl.dev === 'off') continue;
      const bot = sl.dev.startsWith('bot') ? +sl.dev[3] : 0;
      players.push({ legend: sl.legend, team: sl.team, bot, name: bot ? `${LEGENDS[sl.legend].name} (CPU)` : `P${players.length + 1}` });
      devices.push(bot ? null : sl.dev);
    }
    if (players.length < 2) return toast('Add at least 2 fighters');
    cfg = { seed: 0, map: +$('l-map').value, mode: +$('l-mode').value, stocks: +$('l-stocks').value, time: +$('l-time').value, players };
    lastLocal = { cfg, devices };
  }
  cfg.seed = (Math.random() * 1e9) | 0;
  mode = 'local';
  demo = null;
  session = new LocalSession(cfg, lastLocal.devices);
  renderer.quiet = false;
  renderer.reset(cfg, lastLocal.devices.findIndex(d => d));
  show('none');
}

// ------------------------------------------------------------ results & menus
function showResults(s, cfg, isOnline) {
  const teams = cfg.mode === 1;
  const winName = teams ? `${['RED', 'BLUE'][s.winner] || '?'} TEAM WINS!` : `${cfg.players[s.winner]?.name || 'Nobody'} WINS!`;
  $('res-title').textContent = winName;
  const rows = s.players.slice().sort((a, b) => b.stocks - a.stocks || a.dmg - b.dmg || b.kos - a.kos);
  $('res-table').innerHTML = `<tr><th>Fighter</th><th>Legend</th><th>KOs</th><th>Falls</th><th>Damage dealt</th></tr>` +
    rows.map(p => {
      const win = teams ? p.team === s.winner : p.i === s.winner;
      return `<tr class="${win ? 'win' : ''}"><td>${win ? '🏆 ' : ''}${esc(cfg.players[p.i].name)}</td><td>${LEGENDS[p.lg].name}</td><td>${p.kos}</td><td>${p.falls}</td><td>${p.dealt}</td></tr>`;
    }).join('');
  $('btn-res-again').textContent = isOnline ? 'Back to lobby' : 'Rematch';
  mode = isOnline ? 'online-results' : 'local-results';
  show('results');
}
$('btn-res-again').onclick = () => {
  if (mode === 'online-results') { session = null; mode = 'menu'; startDemo(); renderer.quiet = true; if (room) { show('lobby'); renderLobby(); } else backToMenu(); }
  else startLocal(lastLocal.cfg);
};
$('btn-res-menu').onclick = () => { if (mode === 'online-results' && net) net.send({ t: 'leave' }); backToMenu(); };

function backToMenu() {
  session = null;
  mode = 'menu';
  if (!demo) { startDemo(); renderer.quiet = true; }
  show('menu');
}

$('btn-quick').onclick = () => online({ t: 'quick' });
$('btn-create').onclick = () => online({ t: 'create', public: false });
$('btn-join').onclick = () => { const code = $('code').value.trim().toUpperCase(); if (code.length === 4) online({ t: 'join', code }); else toast('Enter a 4-letter room code'); };
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });
$('btn-local').onclick = () => { show('local'); renderLocal(); };
$('btn-local-back').onclick = () => show('menu');
$('btn-local-start').onclick = () => startLocal();
$('btn-help').onclick = () => show('help');
$('btn-help-back').onclick = () => show('menu');
$('btn-resume').onclick = () => togglePause(false);
$('btn-quit').onclick = () => {
  if (mode === 'online' && net) { net.send({ t: 'leave' }); history.replaceState(null, '', location.pathname); }
  backToMenu();
};

function togglePause(v) {
  if (mode !== 'local' && mode !== 'online') return;
  const on = v ?? screen !== 'pause';
  if (session instanceof LocalSession) session.paused = on;
  $('btn-quit').textContent = mode === 'online' ? 'Leave match' : 'Quit match';
  show(on ? 'pause' : 'none');
}
addEventListener('keydown', e => { if (e.code === 'Escape' || e.code === 'KeyP' && mode === 'local') togglePause(); });

// ------------------------------------------------------------ main loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(100, now - last);
  last = now;
  const sess = session || demo;
  if (sess) {
    sess.update(dt);
    const v = sess.view();
    renderer.draw(v.s, v.evs, dt, { net: session instanceof OnlineSession ? session.stats() : null });
    if (sess === demo && v.s.phase === 2 && v.s.endT > 180) startDemo();
    if (sess === session && mode === 'local' && v.s.phase === 2 && v.s.endT > 200) showResults(v.s, session.cfg, false);
  }
  // animate lobby previews
  if (screen === 'lobby' || screen === 'local') {
    const f = Math.floor(now / (1000 / 60));
    for (const cv of document.querySelectorAll('canvas[data-preview]')) {
      drawPreview(cv, +cv.dataset.preview, cv.dataset.color, f, Math.floor(now / 1800) % 3 - 1);
    }
  }
  requestAnimationFrame(frame);
}

startDemo();
renderer.quiet = true;
show('menu');
requestAnimationFrame(frame);

const qRoom = new URLSearchParams(location.search).get('room');
if (qRoom) { $('code').value = qRoom.toUpperCase(); online({ t: 'join', code: qRoom.toUpperCase() }); }

// handy for debugging from the console: brawl.session.stats()
window.brawl = { get session() { return session; }, get room() { return room; } };
