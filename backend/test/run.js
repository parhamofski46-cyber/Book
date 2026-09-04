// Backend test entry point:  node --no-warnings test/run.js
import { report } from './harness.js';

const specs = ['spec_store.js', 'spec_ingest.js', 'spec_analysis.js', 'spec_alerts.js', 'spec_auth.js', 'spec_onboarding.js', 'spec_e2e.js'];

for (const spec of specs) {
  const mod = await import(`./${spec}`);
  await mod.default();
  // A spec may export extra suites alongside its default.
  for (const [name, fn] of Object.entries(mod)) {
    if (name !== 'default' && typeof fn === 'function') await fn();
  }
}

process.exit(report() ? 0 : 1);
