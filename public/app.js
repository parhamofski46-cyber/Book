/**
 * Alt Text Autopilot — embedded admin client.
 *
 * No framework and no build step: one cached document plus a few JSON calls.
 * That keeps hosting inside free tiers and makes first paint inside the Shopify
 * admin iframe genuinely fast.
 */

const root = document.getElementById('root');
let state = null;

/**
 * App Bridge mints a fresh, short-lived signed token per request. Cookies are
 * unreliable inside the admin iframe, so this is the only identity signal the
 * server can trust.
 */
async function api(path, options = {}) {
  const token = await shopify.idToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const num = (n) => Number(n || 0).toLocaleString();

/** Merchant-facing wording for each reason an image was left alone. */
const SKIP_LABELS = {
  already_has_alt: 'Already described',
  decorative: 'Decorative — left empty on purpose',
  low_quality: 'Draft rejected by quality check',
  refused: 'Could not be described',
  unreadable_image: 'Image could not be read',
  no_image_url: 'No image file',
};

const CHECKBOXES = [
  'autoProcessNewProducts',
  'includeBrandName',
  'useProductContext',
  'overwriteExisting',
];

function render() {
  const { coverage, quota, plan, plans, backfill, settings, shop, queue } = state;
  const quotaPct = quota.limit ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0;

  root.setAttribute('aria-busy', 'false');
  root.innerHTML = `
    <header class="app">
      <div>
        <h1>Alt Text Autopilot</h1>
        <p class="muted small">${esc(shop.name || shop.domain)}</p>
      </div>
      <span class="badge ${plan.key !== 'free' ? 'paid' : ''}">${esc(plan.name)} plan</span>
    </header>

    ${backfillNotice(backfill, queue)}
    ${quotaNotice(quota)}

    <section class="stats">
      <div class="stat">
        <div class="value">${coverage.coveragePercent}%</div>
        <div class="label">Images with alt text</div>
      </div>
      <div class="stat">
        <div class="value">${num(coverage.applied)}</div>
        <div class="label">Written by the app</div>
      </div>
      <div class="stat">
        <div class="value">${num(coverage.pending)}</div>
        <div class="label">Waiting in queue</div>
      </div>
      <div class="stat">
        <div class="value">${num(quota.used)}<span class="of"> / ${num(quota.limit)}</span></div>
        <div class="label">This month's allowance</div>
        <div class="bar ${quotaPct > 85 ? 'warn' : ''}"><span style="width:${quotaPct}%"></span></div>
      </div>
    </section>

    ${settingsCard()}

    <section class="card">
      <header><h2>Recent changes</h2></header>
      <div class="scroll">
        <div id="history"><div class="loading"><span class="spinner"></span>Loading…</div></div>
      </div>
    </section>

    <section class="card">
      <header><h2>Plan</h2></header>
      <div class="plans">${plans.map((p) => planCard(p, plan.key)).join('')}</div>
      <p class="muted small" style="margin-top:12px">
        Billed by Shopify and added to your regular Shopify invoice. Cancel any time.
      </p>
    </section>
  `;

  hydrateSettings(settings);
  wire();
  loadHistory();
}

function backfillNotice(backfill, queue) {
  if (backfill.state !== 'running') return '';
  const left = queue.queued;
  return `
    <div class="notice info">
      <span class="spinner" aria-hidden="true"></span>
      <span>Scanning your catalogue. ${num(left)} product${left === 1 ? '' : 's'} left in the
      queue — you can close this page, it keeps running.</span>
    </div>`;
}

function quotaNotice(quota) {
  if (quota.remaining > 0) return '';
  return `
    <div class="notice warning">
      <span>You have used all ${num(quota.limit)} images in this month's allowance. Remaining
      images stay queued and resume automatically next month — or upgrade to continue now.</span>
    </div>`;
}

function settingsCard() {
  return `
    <section class="card">
      <header>
        <h2>How your alt text is written</h2>
        <p class="muted small">
          Changes apply to images described from now on. Use “Rescan catalogue” to reapply
          to everything.
        </p>
      </header>
      <form id="settings">
        <div class="grid2">
          <div class="field">
            <label for="tone">Tone</label>
            <select id="tone">
              <option value="descriptive">Descriptive — most detail</option>
              <option value="concise">Concise — shortest useful</option>
              <option value="marketing">Warm — product-aware</option>
            </select>
          </div>
          <div class="field">
            <label for="language">Language</label>
            <input id="language" type="text" maxlength="12" placeholder="en">
            <p class="hint">A BCP-47 tag, e.g. <code>en</code>, <code>de</code>, <code>fa</code>.</p>
          </div>
          <div class="field">
            <label for="maxLength">Maximum length</label>
            <input id="maxLength" type="number" min="40" max="250">
            <p class="hint">Screen readers commonly truncate past 125 characters.</p>
          </div>
          <div class="field">
            <label for="brandName">Brand name</label>
            <input id="brandName" type="text" maxlength="60">
          </div>
        </div>

        <div class="field">
          <label for="keywords">Preferred keywords</label>
          <input id="keywords" type="text" placeholder="organic cotton, handmade">
          <p class="hint">
            Comma separated, up to 10. Used only where they honestly describe the image —
            forcing keywords into alt text hurts both accessibility and search.
          </p>
        </div>

        <div class="check">
          <input type="checkbox" id="autoProcessNewProducts">
          <label for="autoProcessNewProducts">Describe new products automatically as they are added</label>
        </div>
        <div class="check">
          <input type="checkbox" id="includeBrandName">
          <label for="includeBrandName">Put the brand name at the start of each description</label>
        </div>
        <div class="check">
          <input type="checkbox" id="useProductContext">
          <label for="useProductContext">Use product type and vendor as context</label>
        </div>
        <div class="check">
          <input type="checkbox" id="overwriteExisting">
          <label for="overwriteExisting">
            Replace alt text that already exists
            <span class="muted">— off by default, so your own wording is never overwritten</span>
          </label>
        </div>

        <div class="actions">
          <button type="submit">Save settings</button>
          <button type="button" class="secondary" id="rescan">Rescan catalogue</button>
          <span id="settings-status" class="muted small" role="status"></span>
        </div>
      </form>
    </section>`;
}

function planCard(p, currentKey) {
  const isCurrent = p.key === currentKey;
  const action = isCurrent
    ? '<button class="secondary" disabled>Current plan</button>'
    : p.price === 0
      ? '<button class="secondary" data-cancel>Downgrade</button>'
      : `<button data-plan="${esc(p.key)}">Choose ${esc(p.name)}</button>`;

  return `
    <div class="plan ${isCurrent ? 'current' : ''}">
      <div class="price">
        ${p.price === 0 ? 'Free' : '$' + p.price}${p.price === 0 ? '' : '<span class="per">/mo</span>'}
      </div>
      <div class="muted small">${esc(p.name)}</div>
      <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      ${action}
    </div>`;
}

function hydrateSettings(s) {
  document.getElementById('tone').value = s.tone;
  document.getElementById('language').value = s.language;
  document.getElementById('maxLength').value = s.maxLength;
  document.getElementById('brandName').value = s.brandName;
  document.getElementById('keywords').value = (s.keywords || []).join(', ');
  for (const key of CHECKBOXES) document.getElementById(key).checked = Boolean(s[key]);
}

function readSettings() {
  const settings = {
    tone: document.getElementById('tone').value,
    language: document.getElementById('language').value.trim() || 'en',
    maxLength: Number(document.getElementById('maxLength').value) || 125,
    brandName: document.getElementById('brandName').value.trim(),
    keywords: document
      .getElementById('keywords')
      .value.split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 10),
  };
  for (const key of CHECKBOXES) settings[key] = document.getElementById(key).checked;
  return settings;
}

function flash(message) {
  const status = document.getElementById('settings-status');
  status.textContent = message;
  if (message) setTimeout(() => { status.textContent = ''; }, 4000);
}

function wire() {
  document.getElementById('settings').addEventListener('submit', async (event) => {
    event.preventDefault();
    flash('Saving…');
    try {
      const res = await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(readSettings()),
      });
      state.settings = res.settings;
      flash('Saved.');
    } catch (err) {
      flash(err.message);
    }
  });

  document.getElementById('rescan').addEventListener('click', async (event) => {
    event.target.disabled = true;
    try {
      const res = await api('/api/rescan', { method: 'POST' });
      flash(res.alreadyRunning ? 'A scan is already running.' : 'Scan queued.');
      await refresh();
    } catch (err) {
      flash(err.message);
      event.target.disabled = false;
    }
  });

  for (const btn of document.querySelectorAll('[data-plan]')) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const host = new URLSearchParams(location.search).get('host') || '';
        const res = await api('/api/billing/subscribe', {
          method: 'POST',
          body: JSON.stringify({ plan: btn.dataset.plan, host }),
        });
        // The charge is approved on Shopify's own page, which cannot be framed.
        open(res.confirmationUrl, '_top');
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  }

  const cancelBtn = document.querySelector('[data-cancel]');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      if (!confirm('Cancel your subscription and move to the free plan?')) return;
      cancelBtn.disabled = true;
      try {
        await api('/api/billing/cancel', { method: 'POST' });
        await refresh();
      } catch (err) {
        alert(err.message);
        cancelBtn.disabled = false;
      }
    });
  }
}

/** Shopify's CDN resizes on request; ask for a thumbnail, not the full shot. */
function thumbnailUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('width', '88');
    return parsed.toString();
  } catch {
    return url;
  }
}

function historyRow(item) {
  const thumb = item.imageUrl
    ? `<img src="${esc(thumbnailUrl(item.imageUrl))}" alt="" loading="lazy">`
    : '';
  const label =
    item.status === 'skipped'
      ? SKIP_LABELS[item.skipReason] || 'Skipped'
      : item.status;

  return `
    <tr>
      <td>${thumb}</td>
      <td>${esc(item.productTitle || '—')}</td>
      <td>
        ${item.altAfter ? `<div class="alt-after">${esc(item.altAfter)}</div>` : '<span class="muted">—</span>'}
        ${item.altBefore ? `<div class="alt-before">${esc(item.altBefore)}</div>` : ''}
        ${item.error ? `<div class="muted small">${esc(item.error)}</div>` : ''}
      </td>
      <td><span class="tag ${esc(item.status)}">${esc(label)}</span></td>
      <td>${item.status === 'applied' ? `<button class="link" data-revert="${item.id}">Undo</button>` : ''}</td>
    </tr>`;
}

async function loadHistory() {
  const el = document.getElementById('history');
  try {
    const { items } = await api('/api/history');
    if (!items.length) {
      el.innerHTML =
        '<p class="muted small">Nothing yet. Once the catalogue scan reaches your products, every change will be listed here.</p>';
      return;
    }

    el.innerHTML = `
      <table>
        <thead>
          <tr><th><span class="visually-hidden"></span></th><th>Product</th><th>Alt text</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>${items.map(historyRow).join('')}</tbody>
      </table>`;

    for (const btn of el.querySelectorAll('[data-revert]')) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Undoing…';
        try {
          await api(`/api/images/${btn.dataset.revert}/revert`, { method: 'POST' });
          await loadHistory();
        } catch (err) {
          btn.textContent = 'Failed';
          alert(err.message);
        }
      });
    }
  } catch (err) {
    el.innerHTML = `<p class="muted small">Could not load history: ${esc(err.message)}</p>`;
  }
}

async function refresh() {
  state = await api('/api/state');
  render();
}

(async function boot() {
  try {
    await refresh();
    // Keep the page live while the first sweep runs so the merchant sees it finish.
    setInterval(async () => {
      if (!state || state.backfill.state !== 'running') return;
      try {
        await refresh();
      } catch {
        /* a transient failure should not break the page */
      }
    }, 15000);
  } catch (err) {
    root.setAttribute('aria-busy', 'false');
    root.innerHTML = `<div class="notice error">Could not load the app: ${esc(err.message)}</div>`;
  }
})();
