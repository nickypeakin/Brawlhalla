// Graphics test page (test.html): draws the same thing several different
// ways so a player with a black game screen can show which ones work.
import * as THREE from 'three';
import { Post } from './post.js';
import { LocalSession } from './session.js';
import { Renderer } from './render.js';
import { Renderer3D } from './render3d.js';

const grid = document.getElementById('tests');
const info = document.getElementById('info');

function box(n, title, expect) {
  const el = document.createElement('div');
  el.className = 'test';
  el.innerHTML = `<h3>${n}. ${title}</h3><canvas width="240" height="150"></canvas><p class="expect">Should show: ${expect}</p><p class="res">running...</p>`;
  grid.appendChild(el);
  return { cv: el.querySelector('canvas'), res: el.querySelector('.res') };
}
const ok = (t, msg) => { t.res.textContent = msg || 'drew without errors'; t.res.className = 'res ok'; };
const bad = (t, err) => { t.res.textContent = `error: ${err && err.message ? err.message : err}`; t.res.className = 'res bad'; };

function draw2d(ctx, w, h, label) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#3d8be8'); g.addColorStop(1, '#bfe3ff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#5cc24a'; ctx.fillRect(0, h * 0.7, w, h * 0.3);
  ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.arc(w / 2, h * 0.5, 28, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#000'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(label, 10, 24);
}

const t1 = box(1, '2D canvas', 'blue sky, green ground, red ball');
try { draw2d(t1.cv.getContext('2d'), 240, 150, 'Test 1'); ok(t1); } catch (e) { bad(t1, e); }

const t2 = box(2, '2D canvas on the CPU (Safe mode)', 'blue sky, green ground, red ball');
try { draw2d(t2.cv.getContext('2d', { willReadFrequently: true }), 240, 150, 'Test 2'); ok(t2); } catch (e) { bad(t2, e); }

const t3 = box(3, 'Plain WebGL', 'solid green with an orange triangle');
let glInfo = 'none';
try {
  const gl = t3.cv.getContext('webgl2') || t3.cv.getContext('webgl');
  if (!gl) throw new Error('WebGL is not available in this browser');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  glInfo = `${gl instanceof WebGL2RenderingContext ? 'WebGL 2' : 'WebGL 1'} · ${dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)} · half-float targets: ${gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float') ? 'yes' : 'no'}`;
  gl.clearColor(0.2, 0.7, 0.3, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }'));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, 'precision mediump float; void main(){ gl_FragColor = vec4(1.0, 0.55, 0.1, 1.0); }'));
  gl.linkProgram(p); gl.useProgram(p);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.6, -0.6, 0.6, -0.6, 0, 0.6]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  ok(t3);
} catch (e) { bad(t3, e); }

// three.js scenes: a lit orange cube on a blue background
function cubeScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x3d8be8);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(3, 5, 4); scene.add(sun);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshStandardMaterial({ color: 0xff8c1a, roughness: 0.5 }));
  scene.add(cube);
  const cam = new THREE.PerspectiveCamera(40, 240 / 150, 0.1, 50); cam.position.set(0, 0.6, 4.2); cam.lookAt(0, 0, 0);
  return { scene, cube, cam };
}
const threeTests = [];
function threeTest(n, title, opts, usePost) {
  const t = box(n, title, 'a spinning orange cube on blue');
  try {
    const r = new THREE.WebGLRenderer({ canvas: t.cv, ...opts });
    r.setSize(240, 150, false);
    const s = cubeScene();
    let post = null;
    if (usePost) { post = new Post(r); post.setSize(240, 150, 1); }
    threeTests.push(() => {
      s.cube.rotation.x += 0.01; s.cube.rotation.y += 0.015;
      if (post) post.render(target => { r.setRenderTarget(target); r.render(s.scene, s.cam); });
      else r.render(s.scene, s.cam);
    });
    ok(t);
  } catch (e) { bad(t, e); }
}
threeTest(4, '3D, smoothing on (the first 3D version)', { antialias: true }, false);
threeTest(5, '3D, smoothing off', { antialias: false }, false);
threeTest(6, '3D with the fears-to-fathom picture pass (the game now)', { antialias: false, powerPreference: 'high-performance' }, true);

const t7 = box(7, 'Picture (not a canvas)', 'blue sky, green ground, red ball');
try {
  const img = document.createElement('img');
  img.width = 240; img.height = 150;
  img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="150"><rect width="240" height="150" fill="#3d8be8"/><rect y="105" width="240" height="45" fill="#5cc24a"/><circle cx="120" cy="75" r="28" fill="#ff4d4d"/><text x="10" y="24" font-family="sans-serif" font-weight="bold" font-size="18">Test 7</text></svg>');
  t7.cv.replaceWith(img);
  ok(t7);
} catch (e) { bad(t7, e); }

// the real game picture, with one feature switched off at a time
const gameTests = [];
function gameTest(n, title, make) {
  const t = box(n, title, 'the game: sky, stage and fighters moving');
  try {
    const r = make(t.cv);
    r.quiet = true;
    const cfg = { seed: 42, map: 0, mode: 0, stocks: 3, time: 0, players: [0, 1, 2, 3].map(i => ({ legend: i, bot: 3, name: '' })) };
    const sess = new LocalSession(cfg, [null, null, null, null]);
    r.reset(cfg, -1);
    gameTests.push({ t, r, sess, dead: false });
    ok(t, 'running');
  } catch (e) { bad(t, e); }
}
gameTest(8, 'Game in 3D (everything on, like the game)', cv => new Renderer3D(cv, { hud: false }));
gameTest(9, 'Game in 3D, no reflections', cv => new Renderer3D(cv, { hud: false, env: false }));
gameTest(10, 'Game in 3D, no shadows', cv => new Renderer3D(cv, { hud: false, shadows: false }));
gameTest(11, 'Game in 3D, no glow', cv => new Renderer3D(cv, { hud: false, bloom: false }));
gameTest(12, 'Game in 3D, no smoothing', cv => new Renderer3D(cv, { hud: false, samples: 0 }));
gameTest(13, 'Game in 2D', cv => new Renderer(cv));
gameTest(14, 'Game in 2D, Safe mode', cv => new Renderer(cv, { software: true }));

info.textContent = `Browser: ${navigator.userAgent}\nScreen: ${innerWidth}x${innerHeight} at ${devicePixelRatio}x\nGraphics: ${glInfo}`;

let last = performance.now();
(function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.max(0, Math.min(100, (now || last) - last));
  last = now || last;
  for (const f of threeTests) f();
  for (const g of gameTests) {
    if (g.dead) continue;
    try {
      g.sess.update(dt);
      const v = g.sess.view();
      g.r.draw(v.s, v.evs, dt, null);
    } catch (e) { g.dead = true; bad(g.t, e); }
  }
})();
