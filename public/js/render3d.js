// 3D renderer built with three.js, in the style of nickypeakin/backrooms:
// physically based materials, soft shadows, an environment map for
// reflections, jointed characters built from primitives, and every texture
// generated in code. The simulation is still 2D; this draws it as a 2.5D stage.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MAPS, LEGENDS, ST, PH, moveOf, weaponOf, FPS } from '/shared/sim.js';
import { sfx as SFX } from './audio.js';
import { PLAYER_COLORS, TEAM_COLORS, damageColor } from './render.js';
import { Post } from './post.js';

const MUTE = new Proxy({}, { get: () => () => {} });
const K = 1 / 40; // sim pixels -> world units: a fighter is 1.8 units tall
const wx = x => x * K, wy = y => -y * K;
const DEPTH = 5; // how deep the stages are
const lerp = (a, b, t) => a + (b - a) * t;

const THEMES = [
  { top: 0x3d8be8, bottom: 0xbfe3ff, sun: 0xfff1d6, sunI: 2.6, hemi: [0xcfe8ff, 0x6b5a45, 0.9], far: 0x8fb3e0, near: 0x6a8fc4, grass: [92, 194, 74], rock: [[154, 123, 92], [94, 70, 51]], cloud: 0xffffff, cloudO: 0.95, sunPos: [40, 60, -150] },
  { top: 0xff6f4f, bottom: 0xffd6a0, sun: 0xffc08a, sunI: 2.4, hemi: [0xffc7a0, 0x5a3a4a, 0.8], far: 0xc97a8a, near: 0x8c4f6b, grass: [217, 164, 65], rock: [[122, 90, 106], [69, 48, 63]], cloud: 0xffd9c8, cloudO: 0.9, sunPos: [-50, 18, -150] },
  { top: 0x0b0f2e, bottom: 0x3b2f73, sun: 0xbfc8ff, sunI: 1.5, hemi: [0x6a70c0, 0x1a1a30, 0.7], far: 0x2b2d63, near: 0x1c1d47, grass: [70, 195, 163], rock: [[74, 74, 114], [38, 38, 74]], cloud: 0x8a8ad0, cloudO: 0.35, stars: true, sunPos: [45, 55, -150] },
];

// ------------------------------------------------------------ textures
// Built as DataTextures (no 2D canvas involved).
function hash(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, p) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const m = v => ((v % p) + p) % p;
  const a = hash(m(xi), m(yi)), b = hash(m(xi + 1), m(yi)), c = hash(m(xi), m(yi + 1)), d = hash(m(xi + 1), m(yi + 1));
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}
function fbm(u, v, base = 8) {
  let s = 0, amp = 0.5, f = base;
  for (let o = 0; o < 4; o++) { s += vnoise(u * f, v * f, f) * amp; amp *= 0.5; f *= 2; }
  return s;
}
function dataTex(size, fn, srgb = true) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = fn(x / size, y / size);
    const i = (y * size + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c.length > 3 ? c[3] : 255;
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function brickTex(rock) {
  return dataTex(256, (u, v) => {
    const row = Math.floor(v * 6), off = row % 2 ? 0.125 : 0;
    const bu = (u + off) * 4 - Math.floor((u + off) * 4), bv = v * 6 - row;
    const mortar = bu < 0.04 || bv < 0.07;
    const n = fbm(u, v, 8);
    const tone = hash(Math.floor((u + off) * 4), row) * 0.25;
    const c = mixc(rock[0], rock[1], 0.25 + n * 0.5 + tone);
    return mortar ? c.map(x => x * 0.55) : c;
  });
}
function grassTex(g) {
  return dataTex(128, (u, v) => {
    const n = fbm(u, v, 16);
    const blade = hash(Math.floor(u * 128), Math.floor(v * 32)) * 0.2;
    return g.map(x => Math.min(255, x * (0.75 + n * 0.45 + blade)));
  });
}
function woodTex() {
  return dataTex(128, (u, v) => {
    const grain = Math.sin((v * 22 + fbm(u, v, 4) * 6) * Math.PI) * 0.5 + 0.5;
    const plank = Math.floor(u * 4);
    const seam = (u * 4 - plank) < 0.03 ? 0.6 : 1;
    const k = (0.75 + grain * 0.25 + hash(plank, 3) * 0.1) * seam;
    return [200 * k, 140 * k, 86 * k];
  });
}
let glowTexture = null;
function glowTex() {
  if (!glowTexture) {
    glowTexture = dataTex(64, (u, v) => {
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const a = Math.max(0, 1 - d);
      return [255, 255, 255, 255 * a * a];
    }, false);
    glowTexture.wrapS = glowTexture.wrapT = THREE.ClampToEdgeWrapping;
  }
  return glowTexture;
}
function skyTex(th) {
  const top = new THREE.Color(th.top), bot = new THREE.Color(th.bottom);
  const d = new Uint8Array(4 * 256);
  for (let y = 0; y < 256; y++) {
    const t = Math.pow(y / 255, 0.8);
    const c = bot.clone().lerp(top, t);
    d.set([c.r * 255, c.g * 255, c.b * 255, 255], y * 4);
  }
  const tex = new THREE.DataTexture(d, 1, 256, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------ model helpers
const geoCache = new Map();
const cached = (key, make) => { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); };
const rbox = (w, h, d, r = 0.03) => cached(`rb${w}:${h}:${d}:${r}`, () => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)));
const capsule = (r, len) => cached(`cap${r}:${len}`, () => new THREE.CapsuleGeometry(r, len, 6, 14));
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 20);
const ballGeo = new THREE.SphereGeometry(1, 24, 16);
const coneGeo = new THREE.ConeGeometry(1, 1, 18);

function place(parent, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
const block = (g, m, x, y, z, w, h, d, r) => place(g, rbox(w, h, d, r), m, x, y, z);
function cyl(g, m, x, y, z, r, h) { const c = place(g, cylGeo, m, x, y, z); c.scale.set(r, h, r); return c; }
function ball(g, m, x, y, z, sx, sy = sx, sz = sx) { const b = place(g, ballGeo, m, x, y, z); b.scale.set(sx, sy, sz); return b; }
function cone(g, m, x, y, z, r, h) { const c = place(g, coneGeo, m, x, y, z); c.scale.set(r, h, r); return c; }
function joint(parent, x, y, z = 0) { const j = new THREE.Group(); j.position.set(x, y, z); parent.add(j); return j; }

// Weapons point along +x from the grip.
function buildWeapon(name, M) {
  const g = new THREE.Group();
  const steel = M('#dfe6ef', { rough: 0.22, metal: 0.9 });
  const gold = M('#d9b03a', { rough: 0.3, metal: 0.85 });
  const woodM = M('#7a5530', { rough: 0.7 });
  const rot = o => { o.rotation.z = -Math.PI / 2; return o; };
  if (name === 'sword') {
    rot(cyl(g, M('#5a3a22', { rough: 0.8 }), -0.04, 0, 0, 0.04, 0.24));
    ball(g, gold, -0.17, 0, 0, 0.055);
    block(g, gold, 0.09, 0, 0, 0.07, 0.36, 0.1, 0.02);
    block(g, steel, 0.68, 0, 0, 1.1, 0.14, 0.04, 0.015);
    rot(cone(g, steel, 1.31, 0, 0, 0.07, 0.18)).scale.z = 0.02;
  } else if (name === 'hammer') {
    rot(cyl(g, woodM, 0.45, 0, 0, 0.045, 1.2));
    block(g, M('#9aa3b2', { rough: 0.3, metal: 0.85 }), 1.02, 0, 0, 0.42, 0.62, 0.42, 0.06);
    block(g, gold, 1.02, 0, 0, 0.46, 0.12, 0.46, 0.02);
  } else if (name === 'spear') {
    rot(cyl(g, woodM, 0.45, 0, 0, 0.038, 2.3));
    rot(cone(g, steel, 1.78, 0, 0, 0.09, 0.42));
    rot(cyl(g, M('#c0302a', { rough: 0.9 }), 1.52, 0, 0, 0.06, 0.1));
  } else if (name === 'blasters') {
    block(g, M('#444b5a', { rough: 0.35, metal: 0.6 }), 0.16, 0.04, 0, 0.36, 0.12, 0.09, 0.02);
    block(g, gold, 0.36, 0.04, 0, 0.06, 0.1, 0.1, 0.02);
    block(g, M('#6b4a2a', { rough: 0.7 }), 0.02, -0.06, 0, 0.09, 0.18, 0.08, 0.02);
  }
  return g;
}

// A legend, standing on its feet at the origin and facing +z.
function buildFighter(L, makeMat) {
  const M = makeMat;
  const root = new THREE.Group();
  const body = joint(root, 0, 0);
  const color = M(L.color, { rough: 0.7 });
  const dark = M(new THREE.Color(L.color).multiplyScalar(0.45).getStyle(), { rough: 0.8 });
  const trim = M(L.trim, { rough: 0.4, metal: 0.3 });
  const skin = M(L.skin, { rough: 0.55 });
  const hair = M(L.hair, { rough: 0.7 });
  const boot = M('#24201c', { rough: 0.5 });
  const metal = M('#c3cad6', { rough: 0.25, metal: 0.9 });

  const leg = side => {
    const hip = joint(body, side * 0.12, 0.78);
    place(hip, capsule(0.11, 0.24), dark, 0, -0.19, 0);
    const knee = joint(hip, 0, -0.38);
    place(knee, capsule(0.095, 0.22), dark, 0, -0.18, 0);
    block(knee, boot, 0, -0.37, 0.05, 0.2, 0.14, 0.34, 0.05);
    return { hip, knee };
  };
  const legN = leg(-1), legF = leg(1);
  ball(body, dark, 0, 0.82, 0, 0.24, 0.15, 0.18);
  const torso = place(body, cached('torso', () => {
    const pts = [[0, 0.8], [0.21, 0.81], [0.22, 0.9], [0.23, 1.02], [0.25, 1.14], [0.27, 1.24], [0.26, 1.3], [0.2, 1.35], [0.1, 1.38], [0, 1.38]];
    return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 24);
  }), color);
  torso.scale.z = 0.72;
  const belt = cyl(body, trim, 0, 0.9, 0, 0.225, 0.08);
  belt.scale.z = 0.165;
  block(body, trim, 0, 1.2, 0.17, 0.16, 0.08, 0.04, 0.02);
  cyl(body, skin, 0, 1.4, 0, 0.07, 0.1);

  const arm = side => {
    ball(body, color, side * 0.27, 1.26, 0, 0.11);
    const shoulder = joint(body, side * 0.29, 1.25);
    place(shoulder, capsule(0.075, 0.2), skin, 0, -0.15, 0);
    place(shoulder, cached('sleeve', () => new THREE.CylinderGeometry(0.1, 0.09, 0.16, 16)), color, 0, -0.06, 0);
    const elbow = joint(shoulder, 0, -0.3);
    place(elbow, capsule(0.066, 0.17), skin, 0, -0.12, 0);
    const hand = joint(elbow, 0, -0.29);
    const fist = ball(hand, skin, 0, 0, 0, 0.085);
    const gaunt = ball(hand, M('#e3b23c', { rough: 0.3, metal: 0.85 }), 0, 0, 0, 0.15);
    const pistol = buildWeapon('blasters', M);
    pistol.rotation.z = -Math.PI / 2;
    hand.add(pistol);
    return { shoulder, elbow, hand, fist, gaunt, pistol };
  };
  const armN = arm(-1), armF = arm(1);

  // head: big and cartoony, eyes on the +z side
  const head = joint(body, 0, 1.42);
  ball(head, skin, 0, 0.22, 0, 0.25, 0.27, 0.25);
  const white = M('#fbfbf6', { rough: 0.2 }), pupil = M('#1d140e', { rough: 0.2 });
  for (const s of [-1, 1]) {
    ball(head, white, s * 0.09, 0.25, 0.21, 0.06, 0.07, 0.04);
    ball(head, pupil, s * 0.09, 0.25, 0.245, 0.03, 0.036, 0.02);
    const brow = block(head, hair, s * 0.09, 0.335, 0.225, 0.09, 0.022, 0.03, 0.008);
    brow.rotation.z = s * -0.15;
  }
  ball(head, M(new THREE.Color(L.skin).multiplyScalar(0.9).getStyle(), { rough: 0.55 }), 0, 0.2, 0.245, 0.035, 0.045, 0.035);

  switch (L.look) {
    case 0: { // valkyrie: winged helm, long hair
      const helm = place(head, cached('helm', () => new THREE.SphereGeometry(0.27, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.45)), metal, 0, 0.24, -0.01);
      helm.rotation.x = -0.15;
      block(head, M(L.trim, { rough: 0.3, metal: 0.8 }), 0, 0.33, 0.2, 0.36, 0.05, 0.08, 0.02);
      for (const s of [-1, 1]) {
        const wing = ball(head, M('#ffffff', { rough: 0.6 }), s * 0.3, 0.4, -0.06, 0.04, 0.2, 0.12);
        wing.rotation.set(-0.5, 0, s * -0.5);
      }
      const locks = place(head, capsule(0.12, 0.4), hair, 0, 0.0, -0.18);
      locks.rotation.x = 0.25;
      break;
    }
    case 1: { // bear hood
      const hood = place(head, cached('hood', () => new THREE.SphereGeometry(0.3, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.55)), hair, 0, 0.2, -0.04);
      hood.rotation.x = -0.35;
      for (const s of [-1, 1]) ball(head, hair, s * 0.2, 0.47, -0.05, 0.08, 0.08, 0.05);
      for (const s of [-1, 1]) ball(head, M('#e6d2b0', { rough: 0.8 }), s * 0.11, 0.42, 0.13, 0.03, 0.04, 0.02);
      break;
    }
    case 2: { // tricorn hat
      const black = M('#26262e', { rough: 0.7 });
      const brim = cyl(head, black, 0, 0.42, 0, 0.36, 0.04);
      brim.scale.z = 0.3;
      cyl(head, black, 0, 0.52, -0.02, 0.2, 0.2);
      cyl(head, M(L.trim, { rough: 0.6 }), 0, 0.45, -0.02, 0.205, 0.05);
      for (const s of [-1, 1]) { const flap = block(head, black, s * 0.26, 0.5, 0, 0.04, 0.16, 0.34, 0.02); flap.rotation.z = s * 0.4; }
      break;
    }
    case 3: { // ninja hood and mask
      const hood = place(head, cached('nhood', () => new THREE.SphereGeometry(0.28, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.62)), hair, 0, 0.21, -0.02);
      hood.rotation.x = -0.55;
      const mask = cyl(head, hair, 0, 0.13, 0.02, 0.255, 0.12);
      mask.scale.z = 0.255;
      const tail = place(head, capsule(0.04, 0.45), color, 0.05, 0.3, -0.3);
      tail.rotation.set(1.1, 0, 0.3);
      break;
    }
    case 4: { // horned helm and beard
      place(head, cached('jhelm', () => new THREE.SphereGeometry(0.275, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.42)), M('#9aa3b2', { rough: 0.3, metal: 0.85 }), 0, 0.24, 0);
      for (const s of [-1, 1]) {
        const horn = cone(head, M('#f2ead8', { rough: 0.5 }), s * 0.3, 0.46, 0, 0.06, 0.28);
        horn.rotation.z = s * -0.7;
      }
      const beard = ball(head, hair, 0, 0.06, 0.12, 0.2, 0.2, 0.14);
      beard.rotation.x = 0.3;
      break;
    }
    case 5: { // spiky hair and headband
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const sp = cone(head, hair, Math.cos(a) * 0.12, 0.45, Math.sin(a) * 0.12 - 0.04, 0.08, 0.26);
        sp.rotation.set(Math.sin(a) * -0.6, 0, Math.cos(a) * -0.6);
      }
      ball(head, hair, 0, 0.36, -0.03, 0.24, 0.16, 0.24);
      const band = cyl(head, M(L.trim, { rough: 0.6 }), 0, 0.33, 0, 0.255, 0.06);
      band.scale.z = 0.255;
      break;
    }
  }

  const weapons = {};
  for (const w of new Set(L.weapons)) {
    if (w === 'gauntlets' || w === 'blasters') continue;
    const wg = buildWeapon(w, M);
    wg.rotation.z = -Math.PI / 2;
    armN.hand.add(wg);
    weapons[w] = wg;
  }
  root.userData = { body, head, legN, legF, armN, armF, weapons };
  return root;
}

// ------------------------------------------------------------ particles
class Particles {
  constructor(scene, max, additive) {
    this.max = max;
    this.n = 0;
    this.p = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowTex() }, scale: { value: 400 } },
      vertexShader: /* glsl */`
        attribute float alpha; attribute float size; attribute vec3 color;
        uniform float scale; varying float vA; varying vec3 vC;
        void main() {
          vA = alpha; vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; varying float vA; varying vec3 vC;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vC, t.a * vA);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  add(x, y, z, vx, vy, vz, life, size, color, grow = 0, drag = 0.9, grav = 0) {
    if (this.p.length >= this.max) this.p.shift();
    const c = new THREE.Color(color);
    this.p.push({ x, y, z, vx, vy, vz, life, max: life, size, grow, drag, grav, r: c.r, g: c.g, b: c.b });
  }
  update(k) {
    let n = 0;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const q = this.p[i];
      q.life -= k;
      if (q.life <= 0) { this.p.splice(i, 1); continue; }
      q.x += q.vx * k; q.y += q.vy * k; q.z += q.vz * k;
      const d = Math.pow(q.drag, k);
      q.vx *= d; q.vy = q.vy * d - q.grav * k; q.vz *= d;
    }
    for (const q of this.p) {
      const u = q.life / q.max;
      this.pos[n * 3] = q.x; this.pos[n * 3 + 1] = q.y; this.pos[n * 3 + 2] = q.z;
      this.col[n * 3] = q.r; this.col[n * 3 + 1] = q.g; this.col[n * 3 + 2] = q.b;
      this.alpha[n] = Math.min(1, u * 1.6);
      this.size[n] = q.size * (1 + (1 - u) * q.grow);
      n++;
    }
    this.geo.setDrawRange(0, n);
    for (const a of ['position', 'color', 'alpha', 'size']) this.geo.attributes[a].needsUpdate = true;
  }
}

// ------------------------------------------------------------ renderer
export class Renderer3D {
  // opts (for the graphics test page): env, shadows, bloom (default on),
  // samples (multisampling, default 2), hud (the HTML overlay, default on)
  constructor(canvas, opts = {}) {
    this.cv = canvas;
    this.opts = opts;
    // same setup as fears-to-fathom: no anti-aliasing on the canvas itself,
    // the scene is drawn into a multisampled HDR target and post.js finishes it
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.shadowMap.enabled = opts.shadows !== false;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.post = new Post(this.gl);
    this.post.configure({ maxDpr: 1.5, samples: opts.samples ?? 2, bloom: opts.bloom !== false });
    this.quality = 1;
    this.slow = 0;
    this.envMap = null;
    if (opts.env !== false) {
      const pmrem = new THREE.PMREMGenerator(this.gl);
      this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 900);
    this.cam = { x: 0, y: 3, d: 30 };
    this.shake = 0;
    this.flash = 0;
    this.t = 0;
    this.quiet = false;
    this.banner = null;
    this.lost = false;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; if (this.cfg) this.reset(this.cfg, this.me); });
    if (opts.hud !== false) this.buildHud();
  }

  pcolor(i) { return this.cfg.mode === 1 ? TEAM_COLORS[this.cfg.players[i].team] : PLAYER_COLORS[i % 4]; }

  // -------------------------------------------------- scene setup
  reset(cfg, me) {
    this.cfg = cfg;
    this.me = me;
    this.banner = null;
    this.lastCount = -1;
    if (this.scene) disposeScene(this.scene);
    const map = (this.map = MAPS[cfg.map]);
    const th = (this.theme = THEMES[map.theme]);
    const s = (this.scene = new THREE.Scene());
    s.background = skyTex(th);
    s.environment = this.envMap;
    s.environmentIntensity = 0.45;
    if (!this.envMap) s.add(new THREE.AmbientLight(0xffffff, 0.5)); // stand-in for the reflections
    s.fog = new THREE.Fog(th.bottom, 70, 260);

    const hemi = new THREE.HemisphereLight(th.hemi[0], th.hemi[1], th.hemi[2]);
    s.add(hemi);
    const sun = (this.sun = new THREE.DirectionalLight(th.sun, th.sunI));
    sun.castShadow = this.opts.shadows !== false;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    const sc = sun.shadow.camera;
    sc.left = -28; sc.right = 28; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 90;
    s.add(sun, sun.target);

    // sun / moon disc and its glow, far behind the stage
    const disc = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(th.sun).multiplyScalar(2.2), fog: false }));
    disc.position.set(...th.sunPos);
    s.add(disc);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: th.sun, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.8 }));
    halo.scale.set(60, 60, 1);
    halo.position.copy(disc.position);
    s.add(halo);
    if (th.stars) {
      const n = 500, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 900;
        pos[i * 3 + 1] = Math.random() * 300 - 20;
        pos[i * 3 + 2] = -260 - Math.random() * 60;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      s.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, fog: false, map: glowTex(), transparent: true, depthWrite: false })));
    }

    // low-poly mountains in two layers
    const mtn = (color, z, count, hgt, spread) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
      for (let i = 0; i < count; i++) {
        const x = (i / (count - 1) - 0.5) * spread + (hash(i, z) - 0.5) * 30;
        const h = hgt * (0.6 + hash(z, i) * 0.7);
        const c = new THREE.Mesh(new THREE.ConeGeometry(h * 0.9, h, 6 + (i % 3)), m);
        c.position.set(x, h / 2 - 22, z);
        c.rotation.y = hash(i, i) * 3;
        s.add(c);
      }
    };
    mtn(th.far, -190, 12, 70, 700);
    mtn(th.near, -120, 10, 45, 420);

    // clouds: puffs of spheres drifting behind the stage
    this.clouds = [];
    const cloudMat = new THREE.MeshStandardMaterial({ color: th.cloud, roughness: 1, transparent: th.cloudO < 1, opacity: th.cloudO, emissive: th.cloud, emissiveIntensity: 0.25 });
    for (let i = 0; i < 12; i++) {
      const c = new THREE.Group();
      for (let j = 0; j < 5; j++) {
        const b = new THREE.Mesh(ballGeo, cloudMat);
        const r = 2.5 + hash(i, j) * 3;
        b.scale.set(r * 1.3, r, r);
        b.position.set((j - 2) * 3.2, Math.abs(j - 2) * -0.8 + hash(j, i) * 1.5, hash(i + 9, j) * 2);
        c.add(b);
      }
      c.position.set((hash(i, 99) - 0.5) * 260, 8 + hash(99, i) * 35, -45 - hash(i, 7) * 60);
      c.userData.v = 0.02 + hash(i, 3) * 0.04;
      s.add(c);
      this.clouds.push(c);
    }

    this.buildStage(map, th);

    // fighters
    this.fighters = cfg.players.map((pc, i) => {
      const mats = [];
      const makeMat = (color, o = {}) => {
        const m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.7, metalness: o.metal ?? 0 });
        m.userData.baseEmissive = m.emissive.clone();
        mats.push(m);
        return m;
      };
      const L = LEGENDS[pc.legend];
      const root = buildFighter(L, makeMat);
      s.add(root);
      const ring = new THREE.Mesh(cached('ring', () => new THREE.RingGeometry(0.45, 0.62, 32)), new THREE.MeshBasicMaterial({ color: this.pcolor(i), transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      s.add(ring);
      const arc = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      arc.visible = false;
      s.add(arc);
      return { root, mats, ring, arc, flashing: false, ghost: false };
    });

    // weapon pickups and projectiles are pooled by id
    this.pickMeshes = new Map();
    this.projMeshes = new Map();
    this.sparks = new Particles(s, 1500, true);
    this.smoke = new Particles(s, 700, false);
    this.fx = []; // rings and KO beams

    // HUD
    if (!this.hud) return;
    this.hudCards.innerHTML = '';
    this.cards = cfg.players.map((pc, i) => {
      const L = LEGENDS[pc.legend];
      const el = document.createElement('div');
      el.className = 'h3-card';
      el.style.borderColor = this.pcolor(i);
      el.innerHTML = `<div class="h3-port" style="background:${L.color}">${L.name[0]}</div><div class="h3-info"><div class="h3-name" style="color:${this.pcolor(i)}"></div><div class="h3-dmg"></div><div class="h3-foot"><span class="h3-stocks"></span><span class="h3-wpn"></span></div></div>`;
      el.querySelector('.h3-name').textContent = (pc.name || `P${i + 1}`).slice(0, 14);
      this.hudCards.appendChild(el);
      return { el, dmg: el.querySelector('.h3-dmg'), stocks: el.querySelector('.h3-stocks'), wpn: el.querySelector('.h3-wpn'), port: el.querySelector('.h3-port'), last: '' };
    });
    this.hudTags.innerHTML = '';
    this.tags = cfg.players.map((pc, i) => {
      const t = document.createElement('div');
      t.className = 'h3-tag' + (i === me ? ' me' : '');
      t.style.color = this.pcolor(i);
      t.textContent = pc.name || `P${i + 1}`;
      this.hudTags.appendChild(t);
      const b = document.createElement('div');
      b.className = 'h3-bubble';
      b.style.background = this.pcolor(i);
      this.hudTags.appendChild(b);
      return { t, b };
    });
    this.hud.hidden = false;
  }

  buildStage(map, th) {
    const s = this.scene;
    const rockTex = brickTex(th.rock);
    const grass = new THREE.MeshStandardMaterial({ map: grassTex(th.grass), roughness: 0.95 });
    for (const b of map.solids) {
      const x0 = wx(b.x), x1 = wx(b.x + b.w), top = wy(b.y), h = b.h * K;
      // rock body sits just under the grass (the bevel grows it by 0.2)
      const shape = new THREE.Shape(), rt = top - 0.35, i = 0.2;
      shape.moveTo(x0 + i, rt);
      shape.lineTo(x1 - i, rt);
      shape.lineTo(x1 - 0.75, top - h * 0.7);
      shape.lineTo((x0 + x1) / 2, top - h);
      shape.lineTo(x0 + 0.75, top - h * 0.7);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.2, bevelSegments: 3 });
      geo.translate(0, 0, -DEPTH / 2);
      const tex = rockTex.clone();
      tex.repeat.set(0.25, 0.25);
      tex.needsUpdate = true;
      const rock = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
      rock.castShadow = rock.receiveShadow = true;
      s.add(rock);
      const slab = new THREE.Mesh(new RoundedBoxGeometry(x1 - x0 + 0.5, 0.45, DEPTH + 0.7, 3, 0.15), grass);
      const gt = grass.map.clone();
      gt.repeat.set((x1 - x0) / 3, 2);
      gt.needsUpdate = true;
      slab.material = grass.clone();
      slab.material.map = gt;
      slab.position.set((x0 + x1) / 2, top - 0.225, 0);
      slab.castShadow = slab.receiveShadow = true;
      s.add(slab);
      // grass tufts and rocks along the front edge
      const tuft = new THREE.MeshStandardMaterial({ color: new THREE.Color(`rgb(${th.grass.join(',')})`).multiplyScalar(0.8), roughness: 1 });
      for (let x = x0 + 0.6; x < x1 - 0.4; x += 1.1 + hash(Math.round(x * 10), 1) * 1.2) {
        const c = cone(s, tuft, x, top + 0.12, DEPTH / 2 + 0.15 - hash(Math.round(x * 7), 2) * 0.4, 0.09, 0.35 + hash(Math.round(x * 3), 5) * 0.25);
        c.rotation.z = (hash(Math.round(x * 5), 9) - 0.5) * 0.6;
      }
      // banners on stone pillars at the back corners
      const stone = new THREE.MeshStandardMaterial({ color: new THREE.Color(`rgb(${th.rock[0].join(',')})`), roughness: 0.85 });
      const cloth = new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.9, side: THREE.DoubleSide });
      for (const px of [x0 + 0.9, x1 - 0.9]) {
        block(s, stone, px, top + 2.2, -DEPTH / 2 + 0.4, 0.7, 4.4, 0.7, 0.08);
        block(s, stone, px, top + 4.5, -DEPTH / 2 + 0.4, 0.95, 0.3, 0.95, 0.06);
        const flag = place(s, new THREE.PlaneGeometry(0.6, 1.6), cloth, px, top + 3.3, -DEPTH / 2 + 0.8);
        flag.castShadow = false;
        block(s, new THREE.MeshStandardMaterial({ color: 0xd9b03a, roughness: 0.3, metalness: 0.8 }), px, top + 3.3, -DEPTH / 2 + 0.81, 0.18, 0.18, 0.02, 0.02);
      }
    }
    const wood = new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.65 });
    const post = new THREE.MeshStandardMaterial({ color: 0x5a3e24, roughness: 0.8 });
    for (const b of map.softs) {
      const x0 = wx(b.x), x1 = wx(b.x + b.w), top = wy(b.y);
      block(s, wood, (x0 + x1) / 2, top - 0.14, 0, x1 - x0, 0.28, 2.4, 0.06);
      for (const px of [x0 + 0.35, x1 - 0.35]) for (const pz of [-0.9, 0.9]) cyl(s, post, px, top - 0.75, pz, 0.07, 1.0);
    }
  }

  // -------------------------------------------------- HUD (plain HTML)
  buildHud() {
    const hud = (this.hud = document.createElement('div'));
    hud.id = 'hud3d';
    hud.hidden = true;
    hud.innerHTML = '<div class="h3-flash"></div><div class="h3-tags"></div><div class="h3-timer"></div><div class="h3-net"></div><div class="h3-banner"></div><div class="h3-cards"></div>';
    this.cv.after(hud);
    this.hudCards = hud.querySelector('.h3-cards');
    this.hudTags = hud.querySelector('.h3-tags');
    this.hudTimer = hud.querySelector('.h3-timer');
    this.hudNet = hud.querySelector('.h3-net');
    this.hudBanner = hud.querySelector('.h3-banner');
    this.hudFlash = hud.querySelector('.h3-flash');
  }

  // -------------------------------------------------- events -> effects
  handleEvents(s, evs) {
    const sfx = this.quiet ? MUTE : SFX;
    for (const e of evs) {
      const x = wx(e.x), y = wy(e.y);
      switch (e.type) {
        case 'jump': case 'jump2':
          sfx[e.type]();
          this.dust(x, y, 8, e.type === 'jump2' ? 0xffffff : 0xd8cdb8);
          break;
        case 'land': sfx.land(); this.dust(x, y, 6, 0xd8cdb8); break;
        case 'swing': sfx.swing(e.heavy); break;
        case 'dodge': sfx.dodge(); break;
        case 'pickup': sfx.pickup(); this.ring(x, y + 1, 0xffffff, 1.5); break;
        case 'throw': sfx.throw(); break;
        case 'shot': sfx.shot(); break;
        case 'spawn': sfx.spawn(); this.ring(x, y + 0.9, this.pcolor(e.p), 2.5); break;
        case 'pound':
          sfx.pound(); this.shake = Math.max(this.shake, 0.35);
          this.ring(x, y + 0.1, 0xffffff, 3.5, true);
          this.dust(x, y, 18, 0xd8cdb8);
          break;
        case 'hit': {
          sfx.hit(e.dmg);
          const big = e.F > 22;
          const n = 14 + Math.min(16, e.dmg);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, sp = 0.08 + Math.random() * (0.12 + e.dmg * 0.012);
            this.sparks.add(x, y, 0.6, Math.cos(a) * sp + e.kx * 0.08, Math.sin(a) * sp - e.ky * 0.08, (Math.random() - 0.5) * 0.1, 14 + Math.random() * 8, 0.35 + Math.random() * 0.3, big ? 0xfff0a0 : 0xffffff, 0, 0.88);
          }
          this.sparks.add(x, y, 0.7, 0, 0, 0, 7, 2.2 + e.dmg * 0.12, 0xffffff, 0.8, 1);
          this.shake = Math.max(this.shake, Math.min(0.5, e.F * 0.012));
          if (big) this.flash = Math.max(this.flash, 0.15);
          break;
        }
        case 'ko': {
          sfx.ko();
          this.shake = 0.8; this.flash = 0.35;
          this.koBlast(x, y, this.pcolor(e.p));
          if (e.p === this.me) this.flash = 0.5;
          break;
        }
        case 'go': sfx.go(); this.banner = { text: 'BRAWL!', t: 70, color: '#ffd23f' }; break;
        case 'game': sfx.game(); this.banner = { text: 'GAME!', t: 9999, color: '#ffffff' }; break;
      }
    }
  }
  dust(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI;
      this.smoke.add(x, y + 0.1, (Math.random() - 0.5) * 1.5, Math.cos(a) * (0.03 + Math.random() * 0.06), 0.01 + Math.random() * 0.02, (Math.random() - 0.5) * 0.04, 26, 0.5 + Math.random() * 0.4, color, 1.2, 0.92);
    }
  }
  ring(x, y, color, size, flat = false) {
    const m = new THREE.Mesh(cached('fxring', () => new THREE.RingGeometry(0.8, 1, 48)), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(x, y, 0.5);
    if (flat) m.rotation.x = -Math.PI / 2;
    this.scene.add(m);
    this.fx.push({ m, life: 22, max: 22, size, kind: 'ring' });
  }
  koBlast(x, y, color) {
    const v = this.viewRect();
    const cx = Math.max(v.l + 2, Math.min(v.r - 2, x)), cy = Math.max(v.b + 2, Math.min(v.t - 2, y));
    const dx = this.cam.x - cx, dy = this.cam.y - cy, n = Math.hypot(dx, dy) || 1;
    const beam = new THREE.Mesh(cached('beam', () => { const g = new THREE.ConeGeometry(1, 1, 24, 1, true); g.translate(0, -0.5, 0); return g; }),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.set(cx, cy, 0.5);
    beam.rotation.z = Math.atan2(dy, dx) + Math.PI / 2;
    this.scene.add(beam);
    this.fx.push({ m: beam, life: 50, max: 50, size: 1, kind: 'beam' });
    for (let i = 0; i < 70; i++) {
      const a = Math.atan2(dy / n, dx / n) + (Math.random() - 0.5) * 2.4, sp = 0.2 + Math.random() * 0.7;
      this.sparks.add(cx, cy, 0.6, Math.cos(a) * sp, Math.sin(a) * sp, (Math.random() - 0.5) * 0.3, 30 + Math.random() * 20, 0.5 + Math.random() * 0.6, Math.random() < 0.5 ? color : 0xffffff, 0, 0.93);
    }
    this.ring(cx, cy, 0xffffff, 9);
    this.ring(cx, cy, color, 6);
  }

  viewRect() {
    const halfH = this.cam.d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfW = halfH * this.camera.aspect;
    return { l: this.cam.x - halfW, r: this.cam.x + halfW, t: this.cam.y + halfH, b: this.cam.y - halfH };
  }

  // -------------------------------------------------- per frame
  draw(s, evs, dt, hud) {
    if (!this.scene || this.lost) return;
    const k = dt / (1000 / FPS);
    this.t += dt / 1000;
    const W = this.cv.clientWidth || innerWidth, H = this.cv.clientHeight || innerHeight;
    // adaptive resolution: drop it if frames are slow
    this.slow = this.slow * 0.97 + (dt > 26 ? 1 : 0) * 0.03;
    if (this.slow > 0.6 && this.quality > 0.6) { this.quality = Math.max(0.6, this.quality - 0.1); this.slow = 0; }
    const sizeKey = `${W}x${H}@${this.quality}`;
    if (sizeKey !== this.sizeKey) {
      this.sizeKey = sizeKey;
      this.post.setSize(W, H, this.quality);
    }
    this.camera.aspect = W / Math.max(1, H);
    this.handleEvents(s, evs);

    // camera: frame everyone who's alive, like Brawlhalla
    const map = this.map;
    let l = -230, r = 230, t = -230, b = 110;
    for (const p of s.players) {
      if (p.st === ST.DEAD) continue;
      l = Math.min(l, p.x - 150); r = Math.max(r, p.x + 150);
      t = Math.min(t, p.y - PH - 130); b = Math.max(b, p.y + 150);
    }
    l = Math.max(l, map.blast.l + 100); r = Math.min(r, map.blast.r - 100);
    t = Math.max(t, map.blast.t + 50); b = Math.min(b, map.blast.b - 50);
    const needH = Math.max((b - t) * K, ((r - l) * K) / this.camera.aspect);
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const td = Math.max(11, Math.min(70, needH / 2 / tanH));
    const ck = 1 - Math.pow(0.0015, dt / 1000);
    this.cam.x = lerp(this.cam.x, wx((l + r) / 2), ck);
    this.cam.y = lerp(this.cam.y, wy((t + b) / 2), ck);
    this.cam.d = lerp(this.cam.d, td, ck);
    this.shake *= Math.pow(0.002, dt / 1000);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    this.camera.position.set(this.cam.x + sx, this.cam.y + this.cam.d * 0.2 + sy, this.cam.d);
    this.camera.lookAt(this.cam.x + sx * 0.5, this.cam.y + sy * 0.5, 0);
    this.camera.updateProjectionMatrix();
    this.sun.position.set(this.cam.x - 10, this.cam.y + 22, 16);
    this.sun.target.position.set(this.cam.x, this.cam.y, 0);

    for (const c of this.clouds) { c.position.x += c.userData.v * k; if (c.position.x > 150) c.position.x = -150; }

    s.players.forEach((p, i) => this.poseFighter(this.fighters[i], p, s));
    this.syncPickups(s);
    this.syncProjectiles(s, k);
    for (const p of s.players) {
      if (p.st === ST.HIT && p.hp <= 0 && Math.hypot(p.vx, p.vy) > 13) {
        this.smoke.add(wx(p.x), wy(p.y - PH / 2), 0, 0, 0, 0, 30, 0.9 + Math.random() * 0.5, 0xf0f0f0, 1, 1);
      }
    }
    this.sparks.update(k);
    this.smoke.update(k);
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= k;
      if (f.life <= 0) { this.scene.remove(f.m); f.m.material.dispose(); this.fx.splice(i, 1); continue; }
      const u = f.life / f.max;
      if (f.kind === 'ring') { f.m.scale.setScalar(f.size * (1.15 - u)); f.m.material.opacity = u; }
      else { f.m.scale.set(4 * u + 0.5, 60, 4 * u + 0.5); f.m.material.opacity = u * 0.9; }
    }
    this.sparks.mat.uniforms.scale.value = this.post.u.res.value.y / (2 * tanH);
    this.smoke.mat.uniforms.scale.value = this.sparks.mat.uniforms.scale.value;

    this.post.render(target => { this.gl.setRenderTarget(target); this.gl.render(this.scene, this.camera); });
    if (this.hud) this.updateHud(s, hud, dt);
  }

  poseFighter(F, p, s) {
    const root = F.root, u = root.userData;
    const dead = p.st === ST.DEAD;
    const blink = p.inv > 0 && p.st !== ST.DODGE && Math.floor(s.frame / 4) % 2 === 0;
    root.visible = !dead && !blink;
    F.ring.visible = !dead;
    F.arc.visible = false;
    if (dead) return;
    const L = LEGENDS[p.lg];
    const wpn = weaponOf(p);
    const thrust = wpn === 'spear' || wpn === 'gauntlets' || wpn === 'blasters' || wpn === 'unarmed';
    const f = s.frame;
    let ox = 0;
    if (p.hp > 0 && p.st === ST.HIT) ox = (Math.random() - 0.5) * 0.2;
    root.position.set(wx(p.x) + ox, wy(p.y), 0);
    root.rotation.y = p.face * 1.15;
    root.scale.set(p.face, 1, 1);
    F.ring.position.set(wx(p.x), wy(p.y) + 0.03, 0);

    // pose (same rules as the 2D renderer)
    const speed = Math.abs(p.vx);
    let lean = 0, bob = 0, legA = 0.15, legB = -0.15, kneeA = 0, kneeB = 0, armF = 0.9, armB = 1.2, ext = 1;
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
    let swing = null;
    if (p.st === ST.MOVE) {
      const m = moveOf(p);
      const hb = m.hb[0] || { x: m.proj ? m.proj.x : 40, y: m.proj ? m.proj.y : -40, w: 40, h: 30 };
      const target = Math.atan2(hb.y + 50, hb.x);
      const dir = hb.y + hb.h / 2 < -40 ? -1 : 1;
      const wind = target - dir * 1.6, end = target + dir * 0.9, mt = p.mt;
      if (thrust) {
        armF = target;
        if (mt <= m.s) ext = 1 - 0.4 * (mt / m.s);
        else if (mt <= m.s + m.a) ext = 1.5;
        else ext = 1.5 - 0.5 * Math.min(1, (mt - m.s - m.a) / m.r);
      } else if (mt <= m.s) armF = lerp(0.9, wind, Math.min(1, mt / m.s));
      else if (mt <= m.s + m.a) armF = lerp(wind, end, (mt - m.s) / m.a);
      else armF = lerp(end, 0.9, Math.min(1, (mt - m.s - m.a) / m.r));
      if (mt > m.s && mt <= m.s + m.a + 2 && m.hb.length) swing = { wind, now: armF, hb };
      if (m.key === 'rec') { lean = -0.2; legA = 0.3; kneeA = 1.4; }
      if (m.key === 'gp') { lean = 0.1; kneeA = 1.4; kneeB = 1.4; armF = 1.4; }
      if (m.key[1] === 'a' || m.key === 'na') { kneeA = 1.2; kneeB = 0.8; }
      if (m.key === 'na' && !thrust) lean = Math.sin(mt * 0.6) * 0.3;
      if (m.key[0] === 's') lean = 0.25;
      armB = armF + 0.6;
    }
    u.body.rotation.x = lean * 0.4;
    u.body.position.y = -bob * K;
    u.legN.hip.rotation.x = -legA; u.legN.knee.rotation.x = kneeA;
    u.legF.hip.rotation.x = -legB; u.legF.knee.rotation.x = kneeB;
    u.armN.shoulder.rotation.x = armF - Math.PI / 2;
    u.armN.elbow.rotation.x = thrust ? -0.05 : -0.25;
    u.armN.shoulder.position.z = (ext - 1) * 0.5;
    u.armF.shoulder.rotation.x = armB - Math.PI / 2;
    u.armF.elbow.rotation.x = -0.3;
    u.head.rotation.x = p.st === ST.HIT ? -0.3 : 0;

    // what's in their hands
    for (const [name, g] of Object.entries(u.weapons)) g.visible = name === wpn;
    const gaunt = wpn === 'gauntlets', blast = wpn === 'blasters';
    for (const a of [u.armN, u.armF]) { a.gaunt.visible = gaunt; a.pistol.visible = blast; a.fist.visible = !gaunt; }

    // hit flash and dodge ghosting
    const flashing = p.hp > 0 && p.st === ST.HIT;
    if (flashing !== F.flashing) {
      F.flashing = flashing;
      for (const m of F.mats) { if (flashing) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = 0.7; } else { m.emissive.copy(m.userData.baseEmissive); m.emissiveIntensity = 1; } }
    }
    const ghost = p.st === ST.DODGE;
    if (ghost !== F.ghost) {
      F.ghost = ghost;
      for (const m of F.mats) { m.transparent = ghost; m.opacity = ghost ? 0.45 : 1; m.needsUpdate = true; }
    }

    if (swing) {
      // the bright arc a swing leaves, drawn in the stage plane at the shoulder
      const r = Math.hypot(swing.hb.x, swing.hb.y + 50) * K + swing.hb.w * K * 0.35;
      const thick = Math.max(0.25, swing.hb.h * K * 0.55);
      const ang = a => Math.atan2(-Math.sin(a), p.face * Math.cos(a));
      let a0 = ang(swing.wind), a1 = ang(swing.now);
      let d = a1 - a0;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      F.arc.geometry.dispose();
      F.arc.geometry = new THREE.RingGeometry(Math.max(0.05, r - thick / 2), r + thick / 2, 20, 1, Math.min(a0, a0 + d), Math.abs(d) + 0.01);
      F.arc.position.set(wx(p.x), wy(p.y - 50), 0.9);
      F.arc.visible = true;
    }
  }

  syncPickups(s) {
    const seen = new Set();
    for (const w of s.picks) {
      seen.add(w.id);
      let m = this.pickMeshes.get(w.id);
      if (!m) {
        m = new THREE.Group();
        const col = w.slot === 0 ? '#ffffff' : '#ffcf4a';
        const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: o.rough ?? 0.4, metalness: o.metal ?? 0, emissive: col, emissiveIntensity: 0.35 });
        const sw = buildWeapon('sword', mat);
        sw.rotation.z = Math.PI / 2;
        sw.position.y = -0.4;
        m.add(sw);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: col, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }));
        glow.scale.set(2.4, 2.4, 1);
        glow.position.y = 0.3;
        m.add(glow);
        this.scene.add(m);
        this.pickMeshes.set(w.id, m);
      }
      const bob = w.gr ? Math.sin(this.t * 4 + w.id) * 0.1 : 0;
      m.position.set(wx(w.x), wy(w.y) + 0.75 + bob, 0.4);
      m.rotation.y = this.t * 1.5 + w.id;
      m.visible = !(w.life < 120 && Math.floor(w.life / 8) % 2 === 0);
    }
    for (const [id, m] of this.pickMeshes) if (!seen.has(id)) { this.scene.remove(m); this.pickMeshes.delete(id); }
  }

  syncProjectiles(s, k) {
    const seen = new Set();
    for (const q of s.proj) {
      seen.add(q.id);
      let m = this.projMeshes.get(q.id);
      if (!m) {
        m = new THREE.Group();
        if (q.kind === 1) {
          const owner = s.players[q.o];
          const w = LEGENDS[owner.lg].weapons[q.slot];
          const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: o.rough ?? 0.4, metalness: o.metal ?? 0 });
          const g = w === 'gauntlets' ? (() => { const gg = new THREE.Group(); ball(gg, mat('#e3b23c', { metal: 0.85, rough: 0.3 }), 0, 0, 0, 0.25); return gg; })() : buildWeapon(w, mat);
          g.position.x = -0.4;
          m.add(g);
        } else {
          const big = q.w > 30;
          const core = new THREE.Mesh(capsule(big ? 0.25 : 0.12, big ? 0.4 : 0.35), new THREE.MeshBasicMaterial({ color: big ? 0xffb347 : 0xfff3a0 }));
          core.rotation.z = Math.PI / 2;
          m.add(core);
          const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffde59, blending: THREE.AdditiveBlending, depthWrite: false }));
          glow.scale.set(big ? 2.4 : 1.4, big ? 2.4 : 1.4, 1);
          m.add(glow);
        }
        this.scene.add(m);
        this.projMeshes.set(q.id, m);
      }
      m.position.set(wx(q.x), wy(q.y), 0.4);
      if (q.kind === 1) m.rotation.z -= 0.3 * k * Math.sign(q.vx || 1);
      else m.rotation.z = Math.atan2(-q.vy, q.vx);
    }
    for (const [id, m] of this.projMeshes) if (!seen.has(id)) { this.scene.remove(m); this.projMeshes.delete(id); }
  }

  updateHud(s, hud, dt) {
    const W = innerWidth, H = innerHeight;
    // damage cards
    s.players.forEach((p, i) => {
      const c = this.cards[i];
      const key = `${p.dmg}|${p.stocks}|${p.wpn}|${p.st === ST.DEAD}`;
      if (key === c.last) return;
      c.last = key;
      c.dmg.textContent = p.stocks > 0 ? `${p.dmg}%` : 'OUT';
      c.dmg.style.color = p.stocks > 0 ? damageColor(p.dmg) : '#777';
      c.stocks.innerHTML = '<i></i>'.repeat(Math.max(0, p.stocks));
      c.stocks.style.color = this.pcolor(i);
      c.wpn.textContent = weaponOf(p);
      c.port.style.boxShadow = `inset 0 -${Math.min(48, p.dmg / 300 * 48)}px 0 ${damageColor(p.dmg)}`;
    });
    // name tags and off-screen bubbles
    const v = new THREE.Vector3();
    s.players.forEach((p, i) => {
      const { t, b } = this.tags[i];
      if (p.st === ST.DEAD) { t.style.display = 'none'; b.style.display = 'none'; return; }
      v.set(wx(p.x), wy(p.y - PH) + 0.45, 0).project(this.camera);
      const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
      const on = x > 0 && x < W && y > -20 && y < H;
      t.style.display = on ? 'block' : 'none';
      if (on) t.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      b.style.display = on ? 'none' : 'flex';
      if (!on) {
        const m = 44;
        b.style.transform = `translate(${Math.max(m, Math.min(W - m, x))}px, ${Math.max(m, Math.min(H - m - 90, y))}px) translate(-50%, -50%)`;
        const txt = `${p.dmg}%`;
        if (b.textContent !== txt) b.textContent = txt;
      }
    });
    // timer
    const tt = s.time > 0 || this.cfg.time > 0 ? (() => { const secs = Math.ceil(s.time / FPS); return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; })() : '';
    if (this.hudTimer.textContent !== tt) this.hudTimer.textContent = tt;
    // countdown and banners
    let text = '', color = '#fff', scale = 1;
    if (s.phase === 0) {
      const c = Math.ceil(s.timer / 60);
      if (c !== this.lastCount) { this.lastCount = c; if (!this.quiet) SFX.beep(); }
      text = String(c); scale = 1 + (s.timer % 60) / 60 * 0.6;
    } else if (this.banner) {
      text = this.banner.text; color = this.banner.color;
      scale = 1 + Math.max(0, (this.banner.t - 55) / 15) * 0.8;
      this.banner.t -= dt / (1000 / FPS);
      if (this.banner.t <= 0) this.banner = null;
    }
    if (this.hudBanner.textContent !== text) this.hudBanner.textContent = text;
    this.hudBanner.style.color = color;
    this.hudBanner.style.transform = `translate(-50%, -50%) scale(${scale})`;
    // flash
    this.hudFlash.style.opacity = this.flash;
    this.flash = Math.max(0, this.flash - dt / 1000 * 1.5);
    // net stats
    const ns = hud && hud.net ? `ping ${hud.net.ping}ms  rollback ${hud.net.rollback}f  buffer ${hud.net.lead}f${hud.net.desyncs ? `  resyncs ${hud.net.desyncs}` : ''}` : '';
    if (this.hudNet.textContent !== ns) this.hudNet.textContent = ns;
  }
}

function disposeScene(scene) {
  const keep = new Set([...geoCache.values(), cylGeo, ballGeo, coneGeo]);
  scene.traverse(o => {
    if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose();
    if (o.material) for (const m of [].concat(o.material)) { if (m.map && m.map !== glowTexture) m.map.dispose(); m.dispose(); }
  });
  if (scene.background && scene.background.dispose) scene.background.dispose();
}
