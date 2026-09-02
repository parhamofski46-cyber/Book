/* =============================================================
   jewel3d.js — نمایشگر سه‌بعدی جواهر
   رندر PBR فلز + شکست نور و پاشندگی نگین + بلوم، تماماً بدون وابستگی
   ============================================================= */
import { M4, V3, torus, taper, brilliant, sphere, compile, makeMesh, makeTarget } from './gl.js';

/* ---------------------------- شیدرها ---------------------------- */
const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
uniform mat4 uProj, uView, uModel;
uniform mat3 uNrm;
out vec3 vW;   // موقعیت جهانی
out vec3 vN;   // نرمال جهانی
out vec3 vL;   // موقعیت محلی (برای تقریب بازتاب داخلی نگین)
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = normalize(uNrm * aNrm);
  vL = aPos;
  gl_Position = uProj * uView * w;
}`;

/* محیط استودیویی تحلیلی — جای HDR بیرونی را می‌گیرد */
const ENV = `
const vec3 KEY  = vec3( 0.552, 0.640, 0.535);
const vec3 FILL = vec3(-0.760, 0.250, -0.400);
const vec3 WARM = vec3(-0.350, -0.700, 0.450);

vec3 envMap(vec3 d){
  d = normalize(d);
  float up = d.y * 0.5 + 0.5;
  vec3 col = mix(vec3(0.010,0.011,0.017), vec3(0.085,0.090,0.115), pow(up, 1.4));
  col += vec3(1.00,0.975,0.930) * smoothstep(0.58, 0.995, d.y) * 2.35;      // سقف نور
  col += vec3(1.00,0.900,0.720) * pow(max(dot(d, normalize(KEY)),  0.0), 52.0) * 16.0; // نور کلیدی
  col += vec3(0.420,0.580,1.000) * pow(max(dot(d, normalize(FILL)), 0.0), 22.0) * 4.6;  // پرکننده‌ی سرد
  col += vec3(1.00,0.680,0.240) * pow(max(dot(d, normalize(WARM)), 0.0), 11.0) * 1.7;   // بازتاب گرم از پایین
  col += vec3(0.30,0.31,0.37) * exp(-pow((d.y + 0.02) * 8.5, 2.0)) * 0.5;     // نوار افق
  return col;
}
vec3 envDiff(vec3 n){
  float up = n.y * 0.5 + 0.5;
  return mix(vec3(0.035,0.038,0.052), vec3(0.46,0.47,0.54), up);
}
vec3 envSpec(vec3 r, float rough){
  return mix(envMap(r), envDiff(r) * 1.7, clamp(rough * 1.25, 0.0, 1.0));
}
float ggx(vec3 N, vec3 V, vec3 L, float rough){
  vec3 H = normalize(V + L);
  float a = max(rough * rough, 0.0016);
  float NoH = max(dot(N, H), 0.0);
  float k = NoH * NoH * (a * a - 1.0) + 1.0;
  return (a * a / (3.14159265 * k * k)) * max(dot(N, L), 0.0);
}`;

const FS_METAL = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec3 vL;
uniform vec3 uCam, uAlbedo;
uniform float uRough, uBrush;
out vec4 outColor;
${ENV}
void main(){
  vec3 N = normalize(vN);
  if(!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCam - vW);

  // بافت بسیار ریز پولیش — فرکانس پایین نگه داشته می‌شود تا موآره ایجاد نکند
  float grain = sin(vL.x * 26.0) * sin(vL.y * 23.0) * sin(vL.z * 29.0);
  float rough = clamp(uRough + grain * uBrush, 0.02, 0.85);
  N = normalize(N + grain * uBrush * 0.25 * vec3(vL.z, vL.x, vL.y));

  float NoV = max(dot(N, V), 1e-4);
  vec3 F0 = uAlbedo;
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - NoV, 5.0);

  vec3 col = envSpec(reflect(-V, N), rough) * F;
  col += ggx(N, V, normalize(KEY),  rough) * vec3(1.00,0.94,0.80) * 3.2 * F0;
  col += ggx(N, V, normalize(FILL), rough) * vec3(0.50,0.62,1.00) * 1.3 * F0;
  col += ggx(N, V, normalize(WARM), rough) * vec3(1.00,0.72,0.30) * 0.9 * F0;
  col += uAlbedo * envDiff(N) * 0.11;                      // نور محیطی جذب‌شده
  col += F0 * pow(1.0 - NoV, 3.5) * 0.35;                  // لبه‌ی درخشان
  outColor = vec4(col, 1.0);
}`;

const FS_GEM = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec3 vL;
uniform vec3 uCam, uTint;
uniform float uIOR, uDisp, uFire;
out vec4 outColor;
${ENV}

/* تقریب مسیر نور درون نگین: شکست ورودی، دو بازتاب داخلی روی پاویون، خروج */
vec3 traceGem(vec3 V, vec3 N, float eta, vec3 P){
  vec3 d = refract(-V, N, eta);
  if(dot(d, d) < 1e-6) return envMap(reflect(-V, N));      // بازتاب کلی داخلی
  vec3 nb1 = normalize(vec3(P.x, P.y * 0.55 - 0.62, P.z)); // وجه پاویون مقابل
  d = reflect(d, nb1);
  vec3 nb2 = normalize(vec3(-P.x * 0.8, 0.42, -P.z * 0.8)); // بازگشت به سمت تیبل
  d = reflect(d, nb2);
  return envMap(d);
}

void main(){
  vec3 N = normalize(vN);
  if(!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCam - vW);
  float NoV = max(dot(N, V), 1e-4);

  float e = 1.0 / uIOR;
  // پاشندگی: هر کانال رنگ با ضریب شکست کمی متفاوت — منشأ «آتش» الماس
  vec3 refr = vec3(
    traceGem(V, N, e * (1.0 + uDisp), vL).r,
    traceGem(V, N, e,                 vL).g,
    traceGem(V, N, e * (1.0 - uDisp), vL).b
  );
  refr *= mix(vec3(1.0), uTint, 0.88);
  refr = refr * 1.30 + envDiff(N) * mix(vec3(0.30), uTint * 0.55, 0.7); // درخشش داخلی نگین

  float F = 0.05 + 0.95 * pow(1.0 - NoV, 4.4);             // بازتاب فرنل سطحی
  vec3 col = mix(refr, envMap(reflect(-V, N)), F);

  // جرقه‌های تیز روی وجه‌ها (با بلوم به ستاره تبدیل می‌شوند)
  vec3 R = reflect(-V, N);
  col += vec3(1.0) * pow(max(dot(R, normalize(KEY)), 0.0), 260.0) * 26.0 * uFire;
  col += vec3(0.85,0.92,1.0) * pow(max(dot(R, normalize(FILL)), 0.0), 190.0) * 9.0 * uFire;
  outColor = vec4(col, 1.0);
}`;

const VS_QUAD = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS_BRIGHT = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uTex; uniform float uThresh, uScale;
out vec4 outColor;
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(l - uThresh, 0.0) / max(l, 1e-4);
  // بافرهای بلوم ۸ بیتی‌اند (فیلتر خطی نیم‌شناور روی همه‌ی درایورها قابل اعتماد نیست)
  // پس دامنه‌ی HDR با ضریب کوچک می‌شود و هنگام ترکیب دوباره باز می‌گردد
  outColor = vec4(c * k * uScale, 1.0);
}`;

const FS_BLUR = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uTex; uniform vec2 uDir;
out vec4 outColor;
void main(){
  // گاوسی ۹ نمونه‌ای با نمونه‌برداری خطی
  vec3 c = texture(uTex, vUv).rgb * 0.227027;
  vec2 o1 = uDir * 1.3846153846, o2 = uDir * 3.2307692308;
  c += (texture(uTex, vUv + o1).rgb + texture(uTex, vUv - o1).rgb) * 0.3162162162;
  c += (texture(uTex, vUv + o2).rgb + texture(uTex, vUv - o2).rgb) * 0.0702702703;
  outColor = vec4(c, 1.0);
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene, uBloom;
uniform float uStrength, uExposure;
out vec4 outColor;
vec3 aces(vec3 x){
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main(){
  vec4 s = texture(uScene, vUv);
  vec3 b = texture(uBloom, vUv).rgb * uStrength;
  vec3 c = aces((s.rgb + b) * uExposure);
  c = pow(c, vec3(0.4545));                                 // تصحیح گاما
  float glow = clamp(dot(b, vec3(0.2126,0.7152,0.0722)) * 1.5, 0.0, 1.0);
  outColor = vec4(c, clamp(s.a + glow, 0.0, 1.0));          // آلفای شفاف برای هم‌آمیزی با صفحه
}`;

/* ضریب فشرده‌سازی دامنه‌ی بلوم برای عبور از بافر ۸ بیتی */
const BLOOM_SCALE = 0.2;

/* --------------------------- پیکربندی --------------------------- */
export const METAL_PBR = {
  yellow: { albedo: [1.000, 0.780, 0.336], rough: 0.115 },
  rose:   { albedo: [0.955, 0.638, 0.538], rough: 0.125 },
  white:  { albedo: [0.930, 0.945, 0.972], rough: 0.075 },
};
export const GEM_PBR = {
  diamond:  { tint: [1.00, 1.00, 1.00], ior: 2.417, disp: 0.026, fire: 1.00 },
  ruby:     { tint: [1.00, 0.12, 0.24], ior: 1.770, disp: 0.011, fire: 0.62 },
  emerald:  { tint: [0.12, 1.00, 0.52], ior: 1.577, disp: 0.010, fire: 0.55 },
  sapphire: { tint: [0.16, 0.34, 1.00], ior: 1.770, disp: 0.011, fire: 0.62 },
  amethyst: { tint: [0.62, 0.30, 1.00], ior: 1.544, disp: 0.010, fire: 0.58 },
  citrine:  { tint: [1.00, 0.68, 0.14], ior: 1.550, disp: 0.010, fire: 0.60 },
};

/* ------------------------- نمایشگر اصلی ------------------------- */
export class JewelViewer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = Object.assign({
      metal: 'yellow', gem: 'diamond', band: 0.115, halo: false,
      autoRotate: true, interactive: true, exposure: 1.0, dpr: 2,
    }, opts);

    const gl = canvas.getContext('webgl2', {
      antialias: true, alpha: true, premultipliedAlpha: false,
      powerPreference: 'high-performance', depth: true,
    });
    if (!gl) throw new Error('WebGL2 unsupported');
    this.gl = gl;

    this.float = !!gl.getExtension('EXT_color_buffer_float');
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 0);

    this.progMetal = compile(gl, VS, FS_METAL);
    this.progGem   = compile(gl, VS, FS_GEM);
    this.progBright= compile(gl, VS_QUAD, FS_BRIGHT);
    this.progBlur  = compile(gl, VS_QUAD, FS_BLUR);
    this.progComp  = compile(gl, VS_QUAD, FS_COMPOSITE);
    this.quadVao   = gl.createVertexArray();

    this.proj = M4.create(); this.view = M4.create();
    this.group = M4.create(); this.world = M4.create(); this.nrm = new Float32Array(9);
    this.camDist = 5.7; this.target = [0, 0.28, 0];
    this.cam = [0, 0, this.camDist];

    this.yaw = -0.5; this.pitch = -0.30;
    this.velYaw = 0; this.velPitch = 0;
    this.dragging = false; this.last = null;
    this.time = 0; this.running = false; this.visible = true;
    this.targets = null; this.size = [0, 0];

    this._build();
    if (this.opts.interactive) this._bindPointer();
    this._bindLifecycle();
    this.resize();
  }

  /* ------------------ ساخت قطعات و ماتریس‌های محلی ------------------ */
  _build() {
    const gl = this.gl;
    this.meshes = {
      band:  makeMesh(gl, torus(1.0, this.opts.band, 168, 34)),
      head:  makeMesh(gl, torus(1.0, 0.076, 96, 20)),   // با مقیاس‌دهی به شعاع دلخواه می‌رسد
      prong: makeMesh(gl, taper(0.030, 0.020, 1.0, 18)), // ارتفاع واحد؛ با مقیاس Y کشیده می‌شود
      gem:   makeMesh(gl, brilliant(1.0, 18)),
      bead:  makeMesh(gl, sphere(1.0, 30, 22)),
    };
    this._layout();
  }

  /** میله‌ای از نقطه‌ی a تا b با شعاع مشخص (چنگه‌ها و شانه‌های حلقه) */
  _strut(a, b, rs) {
    const d = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const L = Math.hypot(d[0], d[1], d[2]) || 1e-6;
    const basis = V3.basisFromUp(d);
    const mid = [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2];
    return M4.fromBasis(M4.create(), basis.x, basis.y, basis.z, mid, [rs, L, rs]);
  }

  _layout() {
    const parts = [];
    const bandTube = this.opts.band;
    const S  = 0.37;                       // مقیاس نگین
    const gy = 1.0 + bandTube + 0.405;     // مرکز نگین؛ کولت درست بالای بند
    this.gemY = gy; this.gemScale = S;

    const GIRDLE = 1.000 * S;              // شعاع کمربند نگین در فضای جهانی
    const yGirdle = gy + 0.082 * S;
    const headR = GIRDLE + 0.055, headY = gy - 0.055;

    // بند اصلی
    parts.push({ m: this.meshes.band, kind: 'metal', brush: 0.010, mat: M4.identity(M4.create()) });

    // سبد افقی زیر کمربند
    parts.push({
      m: this.meshes.head, kind: 'metal', brush: 0.006,
      mat: M4.fromBasis(M4.create(), [1,0,0], [0,0,-1], [0,1,0], [0, headY, 0], headR),
    });

    // دو شانه که بند را به سبد وصل می‌کنند (فرم «کاتدرال»)
    for (const sgn of [1, -1]) {
      const u = Math.PI / 2 - sgn * 0.42;   // هم‌سو با همان سمت، تا شانه‌ها یکدیگر را قطع نکنند
      parts.push({
        m: this.meshes.prong, kind: 'metal', brush: 0.006,
        mat: this._strut([Math.cos(u), Math.sin(u), 0], [sgn * headR, headY, 0], 1.35),
      });
    }

    // شش چنگه که از سبد بالا می‌آیند و تاج نگین را می‌گیرند
    const NP = 6;
    for (let i = 0; i < NP; i++) {
      const a = (i / NP) * Math.PI * 2 + 0.26;
      const rad = [Math.sin(a), 0, Math.cos(a)];
      const rB = GIRDLE + 0.035, rT = GIRDLE - 0.012;
      parts.push({
        m: this.meshes.prong, kind: 'metal', brush: 0.004,
        mat: this._strut(
          [rad[0] * rB, headY - 0.03, rad[2] * rB],
          [rad[0] * rT, yGirdle + 0.085, rad[2] * rT], 1.0),
      });
    }

    // نگین اصلی
    parts.push({
      m: this.meshes.gem, kind: 'gem',
      mat: M4.fromBasis(M4.create(), [1,0,0], [0,1,0], [0,0,1], [0, gy, 0], S),
    });

    // هاله‌ی ریزنگین دور نگین اصلی
    if (this.opts.halo) {
      const H = 14, hr = GIRDLE + 0.105, hs = 0.088;
      for (let i = 0; i < H; i++) {
        const a = (i / H) * Math.PI * 2;
        parts.push({
          m: this.meshes.gem, kind: 'gem',
          mat: M4.fromBasis(M4.create(), [1,0,0], [0,1,0], [0,0,1],
            [Math.sin(a) * hr, yGirdle - 0.012, Math.cos(a) * hr], hs),
        });
      }
    }

    this.parts = parts;
    // قاب‌بندی دوربین بر پایه‌ی ارتفاع واقعی مجموعه
    const top = gy + 0.470 * S, bottom = -(1.0 + bandTube);
    this.target = [0, (top + bottom) / 2, 0];
    const height = (top - bottom) / 0.84;
    this.camDist = height / (2 * Math.tan(0.56 / 2));
  }

  /* ------------------------- تعامل کاربر ------------------------- */
  _bindPointer() {
    const c = this.canvas;
    c.style.touchAction = 'pan-y';
    const down = (e) => {
      this.dragging = true; this.last = [e.clientX, e.clientY];
      c.setPointerCapture?.(e.pointerId); c.style.cursor = 'grabbing';
    };
    const move = (e) => {
      if (!this.dragging) { this._hover(e); return; }
      const dx = e.clientX - this.last[0], dy = e.clientY - this.last[1];
      this.last = [e.clientX, e.clientY];
      this.velYaw = dx * 0.0075; this.velPitch = dy * 0.0055;
      this.yaw += this.velYaw; this.pitch += this.velPitch;
      this.pitch = Math.max(-1.1, Math.min(1.1, this.pitch));
      if (Math.abs(dx) > Math.abs(dy)) e.preventDefault();
    };
    const up = () => { this.dragging = false; c.style.cursor = 'grab'; };
    c.style.cursor = 'grab';
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    this._off = () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }

  _hover(e) {
    const r = this.canvas.getBoundingClientRect();
    this.px = ((e.clientX - r.left) / r.width - 0.5) * 2;
    this.py = ((e.clientY - r.top) / r.height - 0.5) * 2;
  }

  _bindLifecycle() {
    this.io = new IntersectionObserver(([en]) => {
      this.visible = en.isIntersecting;
      if (this.visible) this.start(); else this.stop();
    }, { threshold: 0.02 });
    this.io.observe(this.canvas);
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); this.stop();
      this.canvas.dispatchEvent(new CustomEvent('jewel:lost', { bubbles: true }));
    });
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  /* --------------------------- ابعاد --------------------------- */
  resize() {
    const gl = this.gl, c = this.canvas;
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    let dpr = Math.min(window.devicePixelRatio || 1, this.opts.dpr);
    let w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    const MAXPX = 2_400_000;                       // سقف تعداد پیکسل برای روانی
    if (w * h > MAXPX) { const k = Math.sqrt(MAXPX / (w * h)); w = Math.round(w * k); h = Math.round(h * k); }
    if (w === this.size[0] && h === this.size[1]) return;
    c.width = w; c.height = h; this.size = [w, h];
    M4.perspective(this.proj, 0.56, w / h, 0.1, 60);
    this._makeTargets(w, h);
    this.dirty = true;
  }

  _makeTargets(w, h) {
    const gl = this.gl;
    if (this.targets) for (const t of Object.values(this.targets)) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1);
    this.targets = {
      scene: makeTarget(gl, w, h, this.float),
      ping:  makeTarget(gl, hw, hh, false),
      pong:  makeTarget(gl, hw, hh, false),
    };
    const fmt = this.float ? gl.RGBA16F : gl.RGBA8;

    // بافر چندنمونه‌ای (MSAA) — بوم اصلی به بافر داخلی می‌رود، پس ضدلبه‌ی مرورگر کار نمی‌کند
    for (const rb of [this.msColor, this.msDepth]) if (rb) gl.deleteRenderbuffer(rb);
    if (this.msFbo) gl.deleteFramebuffer(this.msFbo);
    this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
    if (this.samples >= 2) {
      this.msColor = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.msColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, fmt, w, h);
      this.msDepth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.msDepth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT16, w, h);
      this.msFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msColor);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msDepth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { this.samples = 0; this.msFbo = null; }
    } else { this.msFbo = null; }

    if (this.depth) gl.deleteRenderbuffer(this.depth);
    this.depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.scene.fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }

  /* -------------------------- تنظیمات -------------------------- */
  setMetal(k){ if (METAL_PBR[k]) { this.opts.metal = k; this.dirty = true; } }
  setGem(k){ if (GEM_PBR[k]) { this.opts.gem = k; this.dirty = true; } }
  setHalo(on){ this.opts.halo = !!on; this._layout(); this.dirty = true; }
  setBand(w) {
    const v = Math.max(0.06, Math.min(0.2, w));
    if (Math.abs(v - this.opts.band) < 1e-4) return;
    this.opts.band = v;
    this.meshes.band.dispose(this.gl);
    this.meshes.band = makeMesh(this.gl, torus(1.0, v, 168, 34));
    this._layout(); this.dirty = true;
  }
  setAutoRotate(on){ this.opts.autoRotate = !!on; }

  /* --------------------------- حلقه --------------------------- */
  start(){ if (this.running || this.dead) return; this.running = true; this.lastT = performance.now(); this._loop(); }
  stop(){ this.running = false; if (this.raf) cancelAnimationFrame(this.raf); }

  _loop = () => {
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastT) / 1000, 0.05);
    this.lastT = now; this.time += dt;

    if (!this.dragging) {
      if (this.opts.autoRotate) this.yaw += dt * 0.32;
      this.velYaw *= 0.92; this.velPitch *= 0.92;
      this.yaw += this.velYaw; this.pitch += this.velPitch;
      // بازگشت نرم زاویه‌ی عمودی به حالت پایه
      this.pitch += (-0.30 - this.pitch) * dt * 0.9;
    }
    this.render();
    this.raf = requestAnimationFrame(this._loop);
  };

  render() {
    const gl = this.gl, [w, h] = this.size;
    if (!w || !h) return;

    // پارالاکس نرم دوربین با حرکت نشانگر
    const tx = (this.px || 0) * 0.20, ty = -(this.py || 0) * 0.15;
    this.cam = [tx, this.target[1] + ty, this.camDist];
    M4.lookAt(this.view, this.cam, this.target, [0, 1, 0]);
    M4.yawPitch(this.group, this.yaw, this.pitch);

    // ۱) رسم صحنه در بافر چندنمونه‌ای
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo || this.targets.scene.fbo);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    const metal = METAL_PBR[this.opts.metal] || METAL_PBR.yellow;
    const gem = GEM_PBR[this.opts.gem] || GEM_PBR.diamond;

    let cur = null;
    for (const part of this.parts) {
      const pr = part.kind === 'gem' ? this.progGem : this.progMetal;
      if (cur !== pr) {
        cur = pr; gl.useProgram(pr.p);
        gl.uniformMatrix4fv(pr.u.uProj, false, this.proj);
        gl.uniformMatrix4fv(pr.u.uView, false, this.view);
        gl.uniform3fv(pr.u.uCam, this.cam);
        if (part.kind === 'gem') {
          gl.uniform3fv(pr.u.uTint, gem.tint);
          gl.uniform1f(pr.u.uIOR, gem.ior);
          gl.uniform1f(pr.u.uDisp, gem.disp);
          gl.uniform1f(pr.u.uFire, gem.fire);
        } else {
          gl.uniform3fv(pr.u.uAlbedo, metal.albedo);
          gl.uniform1f(pr.u.uRough, metal.rough);
        }
      }
      if (part.kind !== 'gem') gl.uniform1f(pr.u.uBrush, part.brush || 0);
      M4.mul(this.world, this.group, part.mat);
      M4.normalFrom(this.nrm, this.world);
      gl.uniformMatrix4fv(pr.u.uModel, false, this.world);
      gl.uniformMatrix3fv(pr.u.uNrm, false, this.nrm);
      part.m.draw(gl);
    }

    // ۱ب) حل‌کردن MSAA به بافت صحنه
    if (this.msFbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.targets.scene.fbo);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }

    // ۲) استخراج نواحی پرنور و محو کردن (بلوم)
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.quadVao);
    const T = this.targets, hw = T.ping.w, hh = T.ping.h;

    gl.bindFramebuffer(gl.FRAMEBUFFER, T.ping.fbo);
    gl.viewport(0, 0, hw, hh);
    gl.useProgram(this.progBright.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.scene.tex);
    gl.uniform1i(this.progBright.u.uTex, 0);
    gl.uniform1f(this.progBright.u.uThresh, 0.85);
    gl.uniform1f(this.progBright.u.uScale, BLOOM_SCALE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(this.progBlur.p);
    gl.uniform1i(this.progBlur.u.uTex, 0);
    const passes = [[2.2 / hw, 0], [0, 2.2 / hh], [5.4 / hw, 0], [0, 5.4 / hh]];
    let src = T.ping, dst = T.pong;
    for (const dir of passes) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, hw, hh);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform2f(this.progBlur.u.uDir, dir[0], dir[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const t = src; src = dst; dst = t;
    }

    // ۳) ترکیب نهایی روی بوم شفاف
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.progComp.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.scene.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(this.progComp.u.uScene, 0);
    gl.uniform1i(this.progComp.u.uBloom, 1);
    gl.uniform1f(this.progComp.u.uStrength, 0.85 / BLOOM_SCALE);
    gl.uniform1f(this.progComp.u.uExposure, this.opts.exposure);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
  }

  dispose() {
    this.stop(); this.dead = true;
    const gl = this.gl;
    this._off?.(); this.io?.disconnect();
    window.removeEventListener('resize', this._onResize);
    for (const m of Object.values(this.meshes || {})) m.dispose(gl);
    for (const p of [this.progMetal, this.progGem, this.progBright, this.progBlur, this.progComp]) gl.deleteProgram(p.p);
    if (this.targets) for (const t of Object.values(this.targets)) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    for (const rb of [this.depth, this.msColor, this.msDepth]) if (rb) gl.deleteRenderbuffer(rb);
    if (this.msFbo) gl.deleteFramebuffer(this.msFbo);
    gl.deleteVertexArray(this.quadVao);
  }
}

/** نصب امن — در صورت نبود WebGL2 مقدار null برمی‌گرداند تا نسخه‌ی جایگزین نمایش داده شود */
export function mountJewel(canvas, opts) {
  try {
    const v = new JewelViewer(canvas, opts);
    v.start();
    return v;
  } catch (err) {
    console.warn('[zarrin] 3D unavailable:', err.message);
    return null;
  }
}
