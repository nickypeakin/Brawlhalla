import { B } from '/shared/sim.js';

const keys = new Set();
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash']);
addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return;
  keys.add(e.code);
  if (GAME_KEYS.has(e.code)) e.preventDefault();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const WASD = { KeyA: B.L, KeyD: B.R, KeyW: B.U | B.JUMP, KeyS: B.D, Space: B.JUMP, KeyJ: B.LIGHT, KeyK: B.HEAVY, KeyL: B.DODGE, ShiftLeft: B.DODGE, KeyH: B.THROW };
const ARROWS = { ArrowLeft: B.L, ArrowRight: B.R, ArrowUp: B.U | B.JUMP, ArrowDown: B.D, Numpad1: B.LIGHT, Numpad2: B.HEAVY, Numpad3: B.DODGE, Numpad0: B.THROW, Comma: B.LIGHT, Period: B.HEAVY, Slash: B.DODGE, KeyM: B.THROW };
const ZXCV = { KeyX: B.LIGHT, KeyC: B.HEAVY, KeyZ: B.DODGE, KeyV: B.THROW };

export const DEVICES = {
  kb: { name: 'Keyboard', map: { ...WASD, ...ARROWS, ...ZXCV } },
  kb1: { name: 'Keyboard WASD', map: WASD },
  kb2: { name: 'Keyboard Arrows', map: ARROWS },
  pad0: { name: 'Gamepad 1', pad: 0 }, pad1: { name: 'Gamepad 2', pad: 1 },
  pad2: { name: 'Gamepad 3', pad: 2 }, pad3: { name: 'Gamepad 4', pad: 3 },
};

export function readInput(dev) {
  const d = DEVICES[dev];
  if (!d) return 0;
  let k = 0;
  if (d.map) {
    for (const code of keys) k |= d.map[code] || 0;
    return k;
  }
  const gp = navigator.getGamepads ? navigator.getGamepads()[d.pad] : null;
  if (!gp) return 0;
  const btn = i => gp.buttons[i] && gp.buttons[i].pressed;
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  if (ax < -0.4 || btn(14)) k |= B.L;
  if (ax > 0.4 || btn(15)) k |= B.R;
  if (ay < -0.5 || btn(12)) k |= B.U;
  if (ay > 0.5 || btn(13)) k |= B.D;
  if (btn(0)) k |= B.JUMP;
  if (btn(2)) k |= B.LIGHT;
  if (btn(1)) k |= B.HEAVY;
  if (btn(3)) k |= B.THROW;
  if (btn(4) || btn(5) || btn(6) || btn(7)) k |= B.DODGE;
  return k;
}

export function connectedPads() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
  return pads.map((p, i) => (p ? i : -1)).filter(i => i >= 0);
}

export function anyKey(code) { return keys.has(code); }
