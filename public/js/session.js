import { createMatch, step, cloneState, hashState, FPS } from '/shared/sim.js';
import { readInput } from './input.js';

export const FRAME_MS = 1000 / FPS;
const MAX_PREDICT = 24; // stall instead of predicting more than ~400ms ahead

/** WebSocket wrapper with RTT measurement. */
export class Net {
  constructor() {
    this.on = {};
    this.rtt = 80;
    this.samples = 0;
    this.open = false;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}`);
    this.ws.onopen = () => { this.open = true; this.emit('open', {}); this.ping(); };
    this.ws.onclose = () => { this.open = false; clearInterval(this.pinger); this.emit('close', {}); };
    this.ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.t === 'pong') {
        const sample = performance.now() - m.c;
        this.rtt = this.samples++ ? this.rtt * 0.8 + sample * 0.2 : sample;
        return;
      }
      this.emit(m.t, m);
    };
    this.pinger = setInterval(() => this.ping(), 1000);
  }
  emit(t, m) { if (this.on[t]) this.on[t](m); }
  ping() { this.send({ t: 'ping', c: performance.now() }); }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
}

/** Offline match: local keyboard/gamepad players and bots. */
export class LocalSession {
  constructor(cfg, devices) {
    this.cfg = cfg;
    this.state = createMatch(cfg);
    this.devices = devices;
    this.acc = 0;
    this.events = [];
    this.paused = false;
  }
  update(dt) {
    if (this.paused) return;
    this.acc += dt;
    let n = 0;
    while (this.acc >= FRAME_MS && n++ < 5) {
      this.acc -= FRAME_MS;
      step(this.state, this.devices.map(d => (d ? readInput(d) : 0)));
      this.events.push(...this.state.ev);
    }
    if (n >= 5) this.acc = 0;
  }
  view() {
    const evs = this.events;
    this.events = [];
    return { s: this.state, evs };
  }
  stats() { return null; }
}

/**
 * Online match with rollback. `conf` is the state at the last frame the
 * server has confirmed; every render we clone it and re-simulate forward to
 * our local frame using our own real inputs and predicted remote inputs.
 */
export class OnlineSession {
  constructor(net, cfg, slot, device) {
    this.net = net;
    this.cfg = cfg;
    this.slot = slot;
    this.device = device;
    this.conf = createMatch(cfg);
    this.lastIn = cfg.players.map(() => 0);
    this.local = new Map();
    this.lf = 0;
    this.started = false;
    this.waitSnap = slot < 0;
    this.lead = 2;
    this.leadHold = 0;
    this.acc = 0;
    this.presented = 0;
    this.specEvents = [];
    this.desyncs = 0;
    this.rollback = 0;
  }

  onFrame(m) {
    if (this.waitSnap) return;
    if (m.f !== this.conf.frame + 1) return this.requestSnap();
    step(this.conf, m.i);
    this.lastIn = m.i;
    if (this.slot < 0) this.specEvents.push(...this.conf.ev);
    if (m.h !== undefined && hashState(this.conf) !== m.h) { this.desyncs++; this.requestSnap(); }
    this.lead = m.l;
    if (!this.started && this.slot >= 0) {
      this.started = true;
      this.lf = m.f + Math.ceil(this.net.rtt / FRAME_MS) + 2;
    }
    for (const f of this.local.keys()) if (f <= m.f) this.local.delete(f);
  }

  onSnap(m) {
    this.conf = { ...m.s, ev: [] };
    this.lastIn = m.li || this.lastIn;
    this.waitSnap = false;
    if (this.slot >= 0 && this.lf < this.conf.frame) this.lf = this.conf.frame + 2;
  }

  requestSnap() {
    if (this.waitSnap) return;
    this.waitSnap = true;
    this.net.send({ t: 'sync' });
  }

  sendInputs(f0, ks) { this.net.send({ t: 'i', f: f0, k: ks }); }

  update(dt) {
    if (!this.started || this.slot < 0) return;
    // Overwatch-style clock dilation: keep our inputs arriving ~2 frames early.
    if (this.leadHold > 0) this.leadHold--;
    else if (this.lead < -3) {
      // badly late: jump ahead in one go
      const jump = Math.min(20, -this.lead + 2), f0 = this.lf + 1, k = readInput(this.device), ks = [];
      for (let j = 0; j < jump; j++) { this.lf++; this.local.set(this.lf, k); ks.push(k); }
      this.sendInputs(f0, ks);
      this.leadHold = Math.ceil(this.net.rtt / FRAME_MS) + 10;
    }
    const rate = this.lead < 1 ? 1.08 : this.lead > 6 ? 0.9 : this.lead > 3 ? 0.97 : 1;
    this.acc += dt * rate;
    let n = 0;
    while (this.acc >= FRAME_MS && n++ < 5) {
      this.acc -= FRAME_MS;
      if (this.lf - this.conf.frame >= MAX_PREDICT || this.waitSnap) { this.acc = 0; break; }
      this.lf++;
      const k = readInput(this.device);
      this.local.set(this.lf, k);
      this.sendInputs(this.lf, [k]);
    }
    if (n >= 5) this.acc = 0;
  }

  view() {
    if (this.slot < 0) {
      const evs = this.specEvents;
      this.specEvents = [];
      return { s: this.conf, evs };
    }
    const s = cloneState(this.conf);
    const evs = [];
    const inp = this.lastIn.slice();
    for (let f = s.frame + 1; f <= this.lf; f++) {
      const k = this.local.get(f);
      if (k !== undefined) inp[this.slot] = k;
      step(s, inp);
      if (f > this.presented) evs.push(...s.ev);
    }
    this.rollback = this.lf - this.conf.frame;
    if (s.frame > this.presented) this.presented = s.frame;
    return { s, evs };
  }

  stats() {
    return { ping: Math.round(this.net.rtt), rollback: this.rollback, lead: this.lead, desyncs: this.desyncs };
  }
}
