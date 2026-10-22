// Two real WebSocket clients play an online match against the real server and
// re-simulate it locally from the confirmed inputs; every state hash the
// server sends must match (i.e. the rollback netcode never desyncs).
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createMatch, step, hashState } from '../shared/sim.js';

process.env.PORT = '0';
const { server, stop } = await import('../server.js');

function client(port, name) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const c = { ws, msgs: [], send: m => ws.send(JSON.stringify(m)), name };
  ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m); c.on && c.on(m); });
  return new Promise(res => ws.on('open', () => { c.send({ t: 'hello', name }); res(c); }));
}
const until = (c, pred) => new Promise(res => {
  const hit = c.msgs.find(pred);
  if (hit) return res(hit);
  c.on = m => { if (pred(m)) { c.on = null; res(m); } };
});

test('online match stays in sync', async () => {
  await new Promise(r => (server.listening ? r() : server.once('listening', r)));
  const port = server.address().port;
  const a = await client(port, 'A'), b = await client(port, 'B');
  a.send({ t: 'create' });
  const room = await until(a, m => m.t === 'room');
  b.send({ t: 'join', code: room.code });
  await until(b, m => m.t === 'room' && m.slots.length === 2);
  a.send({ t: 'bot', level: 3 });
  await until(a, m => m.t === 'room' && m.slots.length === 3);
  a.send({ t: 'ready', v: true }); b.send({ t: 'ready', v: true });
  const [sa, sb] = await Promise.all([until(a, m => m.t === 'start'), until(b, m => m.t === 'start')]);

  let checked = 0;
  for (const [c, st] of [[a, sa], [b, sb]]) {
    const state = createMatch(st.cfg);
    let f = 0, seed = st.slot + 3;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    c.timer = setInterval(() => { // play: send random-ish inputs a few frames ahead
      const k = [Math.floor(rand() * 512)];
      c.send({ t: 'i', f: ++f + 3, k });
    }, 16);
    c.on = m => {
      if (m.t !== 'f') return;
      step(state, m.i);
      assert.equal(state.frame, m.f);
      if (m.h !== undefined) { assert.equal(hashState(state), m.h, `hash at frame ${m.f}`); checked++; }
    };
  }
  await new Promise(r => setTimeout(r, 6000));
  clearInterval(a.timer); clearInterval(b.timer);
  a.ws.close(); b.ws.close();
  stop();
  assert.ok(checked >= 10, `checked ${checked} hashes`);
});
