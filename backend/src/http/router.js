// A router, because a dependency is a thing an operator has to trust.
//
// Patterns are literal segments plus `:name` captures. That covers every route
// this service has, and it is small enough to read in one sitting.

const MAX_BODY_BYTES = 1024 * 1024;

export function createRouter() {
  const routes = [];

  const compile = (pattern) => pattern.split('/').filter(Boolean);

  return {
    add(method, pattern, handler) {
      routes.push({ method, segments: compile(pattern), handler });
      return this;
    },
    get(p, h) { return this.add('GET', p, h); },
    post(p, h) { return this.add('POST', p, h); },

    match(method, pathname) {
      const parts = pathname.split('/').filter(Boolean);
      for (const route of routes) {
        if (route.method !== method || route.segments.length !== parts.length) continue;
        const params = {};
        let ok = true;
        for (let i = 0; i < route.segments.length; i++) {
          const seg = route.segments[i];
          if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(parts[i]);
          else if (seg !== parts[i]) { ok = false; break; }
        }
        if (ok) return { handler: route.handler, params };
      }
      return null;
    },
  };
}

export function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        // Stop reading rather than buffering an unbounded upload.
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limit) {
  const raw = await readBody(req, limit);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}

export function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export function cookie(req, name) {
  const raw = req.headers.cookie || '';
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(raw);
  return match ? decodeURIComponent(match[1]) : '';
}

export function sendRedirect(res, location, setCookie) {
  const headers = { location, 'cache-control': 'no-store' };
  if (setCookie) headers['set-cookie'] = setCookie;
  res.writeHead(302, headers);
  res.end();
}

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

export function sendHtml(res, status, html, csp, setCookie) {
  res.writeHead(status, {
    ...(setCookie ? { 'set-cookie': setCookie } : {}),
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
    // Supplied by the page module, which pins its own script by hash rather
    // than allowing inline script wholesale.
    'content-security-policy': csp ?? "default-src 'none'; style-src 'unsafe-inline'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
  });
  res.end(html);
}
