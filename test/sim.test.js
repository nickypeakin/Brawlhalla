import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, step, cloneState, hashState, MAPS } from '../shared/sim.js';

const cfg = (map) => ({ seed: 1234, map, mode: 0, stocks: 3, time: 240,
  players: [{ legend: 0, bot: 3 }, { legend: 1, bot: 2 }, { legend: 2, bot: 3 }, { legend: 3, bot: 1 }] });

test('bot match is deterministic and finishes', () => {
  for (let map = 0; map < MAPS.length; map++) {
    const a = createMatch(cfg(map)), b = createMatch(cfg(map));
    let kos = 0;
    for (let f = 0; f < 60 * 60 * 5 && a.phase !== 2; f++) {
      step(a, [0, 0, 0, 0]); step(b, [0, 0, 0, 0]);
      kos += a.ev.filter(e => e.type === 'ko').length;
      if (f % 97 === 0) assert.equal(hashState(a), hashState(b));
    }
    assert.ok(kos > 0, `KOs happen on map ${map}`);
    assert.equal(a.phase, 2, `match on map ${map} ends (kos=${kos}, frame=${a.frame})`);
  }
});

test('rollback: restoring a clone and re-simulating gives the same state', () => {
  const s = createMatch({ ...cfg(0), players: [{ legend: 0 }, { legend: 4 }, { legend: 5, bot: 2 }] });
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const inputs = [];
  for (let f = 0; f < 3000; f++) inputs.push([Math.floor(rand() * 512), Math.floor(rand() * 512), 0]);
  for (let f = 0; f < 1500; f++) step(s, inputs[f]);
  const snap = cloneState(s);
  const json = JSON.parse(JSON.stringify(snap)); // also works over the wire
  for (let f = 1500; f < 3000; f++) step(s, inputs[f]);
  for (let f = 1500; f < 3000; f++) { step(snap, inputs[f]); step(json, inputs[f]); }
  assert.equal(hashState(snap), hashState(s));
  assert.equal(hashState(json), hashState(s));
});
