/* =============================================================
   gl.js — موتور سه‌بعدی اختصاصی زرّین (WebGL2، بدون هیچ کتابخانه‌ی بیرونی)
   ریاضیات ماتریسی، سازنده‌های هندسه و کمک‌کننده‌های GL
   ============================================================= */

/* ------------------------------ ریاضی ------------------------------ */
export const M4 = {
  create: () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]),

  perspective(out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out[0]=f/aspect; out[1]=0; out[2]=0;  out[3]=0;
    out[4]=0; out[5]=f; out[6]=0; out[7]=0;
    out[8]=0; out[9]=0; out[10]=(far+near)*nf; out[11]=-1;
    out[12]=0; out[13]=0; out[14]=2*far*near*nf; out[15]=0;
    return out;
  },

  lookAt(out, eye, center, up) {
    const [ex,ey,ez]=eye, [cx,cy,cz]=center, [ux,uy,uz]=up;
    let zx=ex-cx, zy=ey-cy, zz=ez-cz;
    let l = 1/Math.hypot(zx,zy,zz) || 0; zx*=l; zy*=l; zz*=l;
    let xx=uy*zz-uz*zy, xy=uz*zx-ux*zz, xz=ux*zy-uy*zx;
    l = Math.hypot(xx,xy,xz); l = l ? 1/l : 0; xx*=l; xy*=l; xz*=l;
    const yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
    out[0]=xx; out[1]=yx; out[2]=zx; out[3]=0;
    out[4]=xy; out[5]=yy; out[6]=zy; out[7]=0;
    out[8]=xz; out[9]=yz; out[10]=zz; out[11]=0;
    out[12]=-(xx*ex+xy*ey+xz*ez);
    out[13]=-(yx*ex+yy*ey+yz*ez);
    out[14]=-(zx*ex+zy*ey+zz*ez);
    out[15]=1;
    return out;
  },

  mul(out, a, b) {
    for (let i = 0; i < 4; i++) {
      const ai0=a[i], ai1=a[i+4], ai2=a[i+8], ai3=a[i+12];
      out[i]    = ai0*b[0]  + ai1*b[1]  + ai2*b[2]  + ai3*b[3];
      out[i+4]  = ai0*b[4]  + ai1*b[5]  + ai2*b[6]  + ai3*b[7];
      out[i+8]  = ai0*b[8]  + ai1*b[9]  + ai2*b[10] + ai3*b[11];
      out[i+12] = ai0*b[12] + ai1*b[13] + ai2*b[14] + ai3*b[15];
    }
    return out;
  },

  identity(out){ out.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); return out; },

  fromRotationTranslationScale(out, rx, ry, rz, tx, ty, tz, sx, sy, sz) {
    const cx=Math.cos(rx), sxr=Math.sin(rx);
    const cy=Math.cos(ry), syr=Math.sin(ry);
    const cz=Math.cos(rz), szr=Math.sin(rz);
    // R = Ry * Rx * Rz
    const m00 = cy*cz + syr*sxr*szr,  m01 = -cy*szr + syr*sxr*cz, m02 = syr*cx;
    const m10 = cx*szr,               m11 = cx*cz,                m12 = -sxr;
    const m20 = -syr*cz + cy*sxr*szr, m21 = syr*szr + cy*sxr*cz,  m22 = cy*cx;
    out[0]=m00*sx; out[1]=m10*sx; out[2]=m20*sx; out[3]=0;
    out[4]=m01*sy; out[5]=m11*sy; out[6]=m21*sy; out[7]=0;
    out[8]=m02*sz; out[9]=m12*sz; out[10]=m22*sz; out[11]=0;
    out[12]=tx; out[13]=ty; out[14]=tz; out[15]=1;
    return out;
  },

  /** ماتریس از سه بردار پایه‌ی متعامد + جابه‌جایی (برای جای‌گذاری دقیق چنگه‌ها) */
  fromBasis(out, x, y, z, t, s = 1) {
    const sx = Array.isArray(s) ? s[0] : s, sy = Array.isArray(s) ? s[1] : s, sz = Array.isArray(s) ? s[2] : s;
    out[0]=x[0]*sx; out[1]=x[1]*sx; out[2]=x[2]*sx; out[3]=0;
    out[4]=y[0]*sy; out[5]=y[1]*sy; out[6]=y[2]*sy; out[7]=0;
    out[8]=z[0]*sz; out[9]=z[1]*sz; out[10]=z[2]*sz; out[11]=0;
    out[12]=t[0]; out[13]=t[1]; out[14]=t[2]; out[15]=1;
    return out;
  },

  /** چرخش حول محور Y سپس X، همراه با جابه‌جایی — برای ماتریس گروه صحنه */
  yawPitch(out, yaw, pitch) {
    const cy=Math.cos(yaw), sy=Math.sin(yaw), cx=Math.cos(pitch), sx=Math.sin(pitch);
    out[0]=cy;     out[1]=0;   out[2]=-sy;     out[3]=0;
    out[4]=sy*sx;  out[5]=cx;  out[6]=cy*sx;   out[7]=0;
    out[8]=sy*cx;  out[9]=-sx; out[10]=cy*cx;  out[11]=0;
    out[12]=0; out[13]=0; out[14]=0; out[15]=1;
    return out;
  },

  /* ماتریس نرمال ۳×۳ = ترانهاده‌ی معکوس بخش چرخشی */
  normalFrom(out3, m) {
    const a00=m[0],a01=m[1],a02=m[2], a10=m[4],a11=m[5],a12=m[6], a20=m[8],a21=m[9],a22=m[10];
    const b01= a22*a11 - a12*a21, b11=-a22*a10 + a12*a20, b21= a21*a10 - a11*a20;
    let det = a00*b01 + a01*b11 + a02*b21;
    if (!det) { out3.set([1,0,0, 0,1,0, 0,0,1]); return out3; }
    det = 1 / det;
    out3[0]=b01*det;                       out3[1]=(-a22*a01 + a02*a21)*det;      out3[2]=( a12*a01 - a02*a11)*det;
    out3[3]=b11*det;                       out3[4]=( a22*a00 - a02*a20)*det;      out3[5]=(-a12*a00 + a02*a10)*det;
    out3[6]=b21*det;                       out3[7]=(-a21*a00 + a01*a20)*det;      out3[8]=( a11*a00 - a01*a10)*det;
    return out3;
  },
};

/* --------------------------- هندسه‌سازها --------------------------- */

/** تبدیل مثلث‌های ایندکس‌دار به هندسه‌ی مسطح (flat shading) با نرمال هر وجه */
export function flatten(pos, idx) {
  const P = [], N = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax=pos[a],ay=pos[a+1],az=pos[a+2];
    const bx=pos[b],by=pos[b+1],bz=pos[b+2];
    const cx=pos[c],cy=pos[c+1],cz=pos[c+2];
    let nx=(by-ay)*(cz-az)-(bz-az)*(cy-ay);
    let ny=(bz-az)*(cx-ax)-(bx-ax)*(cz-az);
    let nz=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) continue;               // مثلث تباه‌شده (نوک کولت / مرکز تیبل)
    nx/=l; ny/=l; nz/=l;
    for (let k = 0; k < 3; k++) {
      const s = idx[t + k] * 3;
      P.push(pos[s], pos[s + 1], pos[s + 2]);
      N.push(nx, ny, nz);
    }
  }
  return { pos: new Float32Array(P), nrm: new Float32Array(N), count: P.length / 3 };
}

/** حلقه (رینگ) — مقطع دایره‌ای با امکان پخ‌کردن لبه */
export function torus(R = 1, r = 0.12, seg = 128, ring = 28, flat = false) {
  const pos = [], nrm = [], idx = [];
  // مقطع «کامفورت‌فیت»: دایره‌ای که به سمت داخل حلقه کمی صاف می‌شود
  const f  = (v) => r * (1 - 0.16 * Math.abs(Math.cos(v)));
  const df = (v) => r * 0.16 * Math.sign(Math.cos(v)) * Math.sin(v);
  for (let i = 0; i <= seg; i++) {
    const u = (i / seg) * Math.PI * 2, cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j <= ring; j++) {
      const v = (j / ring) * Math.PI * 2, cv = Math.cos(v), sv = Math.sin(v);
      const fv = f(v), fd = df(v);
      const g  = fv * cv,            h  = fv * sv;          // انحراف شعاعی و ارتفاع مقطع
      const gd = fd * cv - fv * sv,  hd = fd * sv + fv * cv; // مشتق‌ها
      pos.push((R + g) * cu, (R + g) * su, h);
      // نرمال دقیق = ∂P/∂u × ∂P/∂v  →  (cu·h', su·h', −g')
      const nx = cu * hd, ny = su * hd, nz = -gd;
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm.push(nx / l, ny / l, nz / l);
    }
  }
  const row = ring + 1;
  for (let i = 0; i < seg; i++) for (let j = 0; j < ring; j++) {
    const a = i * row + j, b = a + row;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const P = new Float32Array(pos);
  if (flat) return flatten(P, idx);
  return { pos: P, nrm: new Float32Array(nrm), idx: new Uint32Array(idx), count: idx.length };
}

/** استوانه/مخروط برای چنگه‌ها */
export function taper(r0 = 0.06, r1 = 0.04, h = 0.3, seg = 20) {
  const pos = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * r0, -h / 2, s * r0);
    pos.push(c * r1,  h / 2, s * r1);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2, b = a + 2;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  // درپوش بالا (سر گرد چنگه)
  const top = pos.length / 3;
  pos.push(0, h / 2 + r1 * 0.9, 0);
  for (let i = 0; i < seg; i++) idx.push(i * 2 + 1, top, (i + 1) * 2 + 1);
  const base = pos.length / 3;
  pos.push(0, -h / 2, 0);
  for (let i = 0; i < seg; i++) idx.push((i + 1) * 2, base, i * 2);
  return flatten(new Float32Array(pos), idx);
}

/** کره (برای مروارید و توپی‌ها) */
export function sphere(r = 1, seg = 48, ring = 32) {
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i <= ring; i++) {
    const phi = (i / ring) * Math.PI, sp = Math.sin(phi), cp = Math.cos(phi);
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const x = sp * Math.cos(th), y = cp, z = sp * Math.sin(th);
      pos.push(x * r, y * r, z * r); nrm.push(x, y, z);
    }
  }
  const row = seg + 1;
  for (let i = 0; i < ring; i++) for (let j = 0; j < seg; j++) {
    const a = i * row + j, b = a + row;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint32Array(idx), count: idx.length };
}

/**
 * الماس تراش برلیان — پروفیل چرخشی با وجه‌های تخت.
 * نسبت‌ها بر پایه‌ی تراش ایده‌آل تولکوفسکی: تیبل ۵۵٪، تاج ۳۴.۵°، پاویون ۴۰.۷۵°
 */
export function brilliant(scale = 1, seg = 16) {
  const profile = [
    [0.000,  0.470],  // مرکز تیبل
    [0.545,  0.470],  // لبه‌ی تیبل
    [0.800,  0.300],  // ستاره
    [1.000,  0.162],  // بالای کمربند
    [1.000,  0.082],  // کمربند
    [0.985,  0.030],  // پایین کمربند
    [0.520, -0.430],  // پاویون میانی
    [0.000, -0.900],  // کولت
  ];
  const pos = [], idx = [];
  const rings = profile.length;
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      // نوسان ریز شعاع برای ایجاد وجه‌های بالا/پایین کمربند
      const wob = (j >= 2 && j <= 5) ? 1 + 0.026 * ((i % 2) ? 1 : -1) : 1;
      const r = profile[j][0] * wob * scale;
      pos.push(Math.cos(a) * r, profile[j][1] * scale, Math.sin(a) * r);
    }
  }
  const row = seg + 1;
  for (let j = 0; j < rings - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * row + i, b = a + row;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  return flatten(new Float32Array(pos), idx);
}

/** حلقه‌ی ریزنگین‌ها دور نگین اصلی (هاله/پاوه) */
export function paveRing(count = 14, radius = 0.42, gemR = 0.075, y = 0) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    parts.push({ x: Math.cos(a) * radius, y, z: Math.sin(a) * radius, r: gemR });
  }
  return parts;
}

/* ------------------------------- GL ------------------------------- */
export function compile(gl, vsSrc, fsSrc) {
  const mk = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Shader: ' + log);
    }
    return sh;
  };
  const vs = mk(gl.VERTEX_SHADER, vsSrc), fs = mk(gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  gl.deleteShader(vs); gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p); gl.deleteProgram(p);
    throw new Error('Program: ' + log);
  }
  const u = new Proxy({}, { get: (c, k) => (k in c ? c[k] : (c[k] = gl.getUniformLocation(p, k))) });
  return { p, u };
}

export function makeMesh(gl, geo) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, geo.pos, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const nb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, nb);
  gl.bufferData(gl.ARRAY_BUFFER, geo.nrm, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  let ib = null;
  if (geo.idx) {
    ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx, gl.STATIC_DRAW);
  }
  gl.bindVertexArray(null);
  return { vao, vb, nb, ib, count: geo.count, indexed: !!geo.idx,
    draw(g) {
      g.bindVertexArray(vao);
      if (this.indexed) g.drawElements(g.TRIANGLES, this.count, g.UNSIGNED_INT, 0);
      else g.drawArrays(g.TRIANGLES, 0, this.count);
    },
    dispose(g){ g.deleteVertexArray(vao); g.deleteBuffer(vb); g.deleteBuffer(nb); if (ib) g.deleteBuffer(ib); }
  };
}

export function makeTarget(gl, w, h, half) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, half ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA,
    half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

/* ---------------------------- بردارها ---------------------------- */
export const V3 = {
  norm(v){ const l=Math.hypot(v[0],v[1],v[2])||1; return [v[0]/l,v[1]/l,v[2]/l]; },
  cross(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; },
  dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; },
  /** پایه‌ی متعامد راست‌گرد از یک بردار «بالا» */
  basisFromUp(up){
    const y = V3.norm(up);
    const ref = Math.abs(y[1]) > 0.94 ? [1,0,0] : [0,1,0];
    const x = V3.norm(V3.cross(ref, y));
    const z = V3.cross(x, y);
    return { x, y, z };
  },
};
