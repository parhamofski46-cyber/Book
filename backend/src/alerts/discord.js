// Discord delivery.
//
// Server owners and their staff live in Discord; an alert that lands anywhere
// else lands nowhere. Uses the built-in fetch, so there is still nothing to
// install.

const COLOURS = { critical: 0xd1493f, warning: 0xd9822b, info: 0x4a7fb5 };

export function formatAlert(server, alert, { publicUrl } = {}) {
  const fields = [];
  if (alert.health) {
    fields.push(
      { name: 'Blocked', value: `${alert.health.blockedPct}%`, inline: true },
      { name: 'p95 drift', value: `${alert.health.p95DriftMs}ms`, inline: true },
      { name: 'Hitches/h', value: `${alert.health.hitchesPerHour}`, inline: true },
    );
  }
  if (alert.changedS) {
    fields.push({ name: 'Changed at', value: `<t:${alert.changedS}:f>`, inline: false });
  }

  return {
    username: 'Pulse',
    embeds: [{
      title: alert.title,
      description: alert.detail,
      color: COLOURS[alert.severity] ?? COLOURS.info,
      fields,
      footer: { text: server.name },
      timestamp: new Date().toISOString(),
      ...(publicUrl ? { url: `${publicUrl}/s/${server.id}` } : {}),
    }],
  };
}

/**
 * Post one alert. Returns whether Discord accepted it; a failure is logged and
 * swallowed, because a webhook being wrong must never break ingest.
 */
export async function deliverAlert(webhookUrl, body, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  if (!webhookUrl) return { delivered: false, reason: 'no webhook configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { delivered: res.ok, status: res.status };
  } catch (err) {
    return { delivered: false, reason: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deliver and record. The alert is recorded either way, so a failed delivery
 * counts against the cooldown instead of retrying in a loop -- but the
 * regression is only marked notified once it actually reached someone.
 * Otherwise a server registered without a webhook silently consumes every
 * finding it ever makes, and adding a webhook later surfaces none of them.
 */
export async function dispatchAlerts(store, server, alerts, { now, publicUrl, fetchImpl } = {}) {
  const results = [];
  for (const alert of alerts) {
    const body = formatAlert(server, alert, { publicUrl });
    const result = await deliverAlert(server.discord_webhook, body, { fetchImpl });
    store.recordAlert(server.id, alert.kind, alert.key, now, result.delivered,
      JSON.stringify({ title: alert.title, detail: alert.detail, ...result }));
    if (alert.regressionId && result.delivered) store.markRegressionNotified(alert.regressionId, now);
    results.push({ ...alert, ...result });
  }
  return results;
}
