// The final picture, copied from nickypeakin/fears-to-fathom (client/post.js)
// and trimmed for a fighting game. The scene renders in HDR into a
// multisampled target (the canvas itself has no anti-aliasing, which some
// graphics drivers show as a black screen); a cheap two-level bloom makes
// hits and the sun glow; then one pass tone-maps (ACES), sharpens and adds
// a light vignette.
import * as THREE from 'three';

const quadVert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const brightFrag = /* glsl */`
  uniform sampler2D tex;
  uniform float threshold;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tex, vUv).rgb;
    float l = max(c.r, max(c.g, c.b));
    float k = smoothstep(threshold, threshold * 2.5, l);
    gl_FragColor = vec4(c * k, 1.0);
  }
`;

const blurFrag = /* glsl */`
  uniform sampler2D tex;
  uniform vec2 dir;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tex, vUv).rgb * 0.227;
    c += (texture2D(tex, vUv + dir * 1.385).rgb + texture2D(tex, vUv - dir * 1.385).rgb) * 0.316;
    c += (texture2D(tex, vUv + dir * 3.231).rgb + texture2D(tex, vUv - dir * 3.231).rgb) * 0.07;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const finalFrag = /* glsl */`
  uniform sampler2D tex, bloomA, bloomB;
  uniform vec2 res;
  uniform float aspect, exposure, bloom, vignette, sharpen;
  varying vec2 vUv;

  vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

  void main() {
    vec2 uv = vUv;
    vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
    vec3 glow = (texture2D(bloomA, uv).rgb * 0.7 + texture2D(bloomB, uv).rgb * 0.9) * bloom;
    float k = exposure;
    vec3 col = aces((texture2D(tex, uv).rgb + glow) * k);
    if (sharpen > 0.0) {
      // contrast-adaptive sharpening on the tone-mapped picture
      vec2 px = 1.0 / res;
      vec3 n = aces((texture2D(tex, uv + vec2(0.0, px.y)).rgb + glow) * k);
      vec3 so = aces((texture2D(tex, uv - vec2(0.0, px.y)).rgb + glow) * k);
      vec3 e = aces((texture2D(tex, uv + vec2(px.x, 0.0)).rgb + glow) * k);
      vec3 w = aces((texture2D(tex, uv - vec2(px.x, 0.0)).rgb + glow) * k);
      vec3 mn = min(col, min(min(n, so), min(e, w)));
      vec3 mx = max(col, max(max(n, so), max(e, w)));
      vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(0.0001)), 0.0, 1.0));
      vec3 wt = amp * (-1.0 / mix(8.0, 4.5, sharpen));
      col = clamp((col + (n + so + e + w) * wt) / (1.0 + 4.0 * wt), 0.0, 1.0);
    }
    float vig = smoothstep(1.05, 0.25, length(c * vec2(0.9, 1.1)));
    col *= mix(1.0, vig, vignette);
    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <colorspace_fragment>
  }
`;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.maxDpr = 1.5;
    this.bloomOn = true;
    const hdr = { type: THREE.HalfFloatType };
    this.target = new THREE.WebGLRenderTarget(4, 4, { ...hdr, samples: 2 });
    this.a1 = new THREE.WebGLRenderTarget(4, 4, hdr);
    this.a2 = new THREE.WebGLRenderTarget(4, 4, hdr);
    this.b1 = new THREE.WebGLRenderTarget(4, 4, hdr);
    this.b2 = new THREE.WebGLRenderTarget(4, 4, hdr);
    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ uniforms, vertexShader: quadVert, fragmentShader: frag, depthTest: false, depthWrite: false });
    this.bright = mk(brightFrag, { tex: { value: null }, threshold: { value: 1.1 } });
    this.blur = mk(blurFrag, { tex: { value: null }, dir: { value: new THREE.Vector2() } });
    this.u = {
      tex: { value: this.target.texture }, bloomA: { value: this.a1.texture }, bloomB: { value: this.b1.texture },
      res: { value: new THREE.Vector2(4, 4) }, aspect: { value: 1 },
      exposure: { value: 1.3 }, bloom: { value: 0.8 }, vignette: { value: 0.15 }, sharpen: { value: 0.5 },
    };
    this.final = mk(finalFrag, this.u);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.final);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  // pixel density cap, anti-aliasing samples (0, 2 or 4) and bloom
  configure({ maxDpr, samples, bloom }) {
    this.maxDpr = maxDpr;
    this.bloomOn = bloom;
    if (samples !== this.target.samples) {
      const { width, height } = this.target;
      this.target.dispose();
      this.target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples });
      this.u.tex.value = this.target.texture;
    }
  }

  // full resolution (capped on high-density screens) times `quality`
  setSize(w, h, quality = 1) {
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(dpr, this.maxDpr) * quality;
    const rw = Math.max(2, Math.round(w * scale)), rh = Math.max(2, Math.round(h * scale));
    this.u.sharpen.value = Math.min(1, 0.45 + Math.max(0, 1 - scale / dpr) * 1.4);
    this.target.setSize(rw, rh);
    const q = (t, d) => t.setSize(Math.max(1, Math.round(rw / d)), Math.max(1, Math.round(rh / d)));
    q(this.a1, 4); q(this.a2, 4); q(this.b1, 12); q(this.b2, 12);
    this.u.res.value.set(rw, rh);
    this.u.aspect.value = w / h;
    this.renderer.setPixelRatio(scale);
    this.renderer.setSize(w, h, false);
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  // draw(target) renders the world into `target`
  render(draw) {
    const r = this.renderer;
    draw(this.target);
    if (this.bloomOn) {
      this.bright.uniforms.tex.value = this.target.texture;
      this.pass(this.bright, this.a1);
      const blur = (src, dst, dx, dy) => {
        this.blur.uniforms.tex.value = src.texture;
        this.blur.uniforms.dir.value.set(dx / src.width, dy / src.height);
        this.pass(this.blur, dst);
      };
      blur(this.a1, this.a2, 1, 0); blur(this.a2, this.a1, 0, 1);
      blur(this.a1, this.b2, 1, 0); blur(this.b2, this.b1, 0, 1);
    }
    this.u.bloom.value = this.bloomOn ? 0.8 : 0;
    this.quad.material = this.final;
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}
