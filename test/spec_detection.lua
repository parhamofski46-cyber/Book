return function(T, run)
  local HOUR = run.MS_PER_HOUR
  local UPDATE_AT = 12 * HOUR   -- when the workload quietly makes qb-inventory worse
  local SPAN_HOURS = 20

  local function sumIn(samples, field, fromMs, toMs)
    local total = 0
    for _, s in ipairs(samples) do
      if s.at >= fromMs and s.at < toMs then total = total + (s[field] or 0) end
    end
    return total
  end

  local degraded = run.run(SPAN_HOURS)
  local samples = run.delivered(degraded.world)

  T.suite('detection: does it find what actually broke', function()
    T.test('covers the whole span with one sample per window', function()
      local expected = SPAN_HOURS * 3600 * 1000 / Pulse.Config.windowMs
      -- The tail of the run is still buffered when the clock stops, so a small
      -- shortfall is correct rather than a gap in collection.
      T.within(#samples, expected * 0.97, expected, 'sample count matches the window rate')
    end)

    T.test('the regression after the update is visible in the data', function()
      local before = sumIn(samples, 'hitches', 0, UPDATE_AT) / 12
      local after = sumIn(samples, 'hitches', UPDATE_AT, SPAN_HOURS * HOUR) / 8
      T.gt(after, before * 2, ('hitch rate rose after the update (%.1f/h -> %.1f/h)'):format(before, after))
    end)

    T.test('the restart that caused it is on the record', function()
      -- Both sources are expected to fire: the resource event pins the exact
      -- moment, the poll reconciles independently. Each record says which it
      -- came from so the backend can collapse the pair.
      local matches = {}
      for _, s in ipairs(samples) do
        for _, c in ipairs(s.resourceChanges or {}) do
          if c.resource == 'qb-inventory' and c.at >= UPDATE_AT and c.at < UPDATE_AT + 5 * 60000 then
            matches[#matches + 1] = c
          end
        end
      end
      T.gt(#matches, 0, 'qb-inventory restart captured within minutes of the update')

      local bySource = {}
      for _, c in ipairs(matches) do bySource[c.source] = (bySource[c.source] or 0) + 1 end
      T.ok(bySource.event, 'the resource event path recorded it, giving exact timing')
      T.ok(bySource.poll, 'the reconciling poll saw it too, so neither path is load-bearing alone')
    end)

    T.test('recovers most of the stall time that was really injected', function()
      -- The probe can only place a stall to within one sampling interval, so
      -- reported stall time is a lower bound: it undercounts by up to
      -- tickIntervalMs per stall and can miss one that lands just over the
      -- threshold. This asserts the bound holds and stays tight.
      local injected = 0
      for _, s in ipairs(degraded.world.truth.stalls) do
        if s.dur >= Pulse.Config.hitchThresholdMs then injected = injected + s.dur end
      end
      local detected = sumIn(samples, 'stallMs', 0, SPAN_HOURS * HOUR)
      T.gt(injected, 0, 'the workload did inject qualifying stalls')
      T.within(detected / injected, 0.70, 1.05,
        ('detected %dms of %dms injected'):format(detected, injected))
    end)

    T.test('stays inside its own CPU budget over a full day', function()
      local ratio = degraded.pulse.Budget.ratio(degraded.sched.now)
      T.lte(ratio, Pulse.Config.cpuBudgetRatio, ('cpu ratio %.6f within budget'):format(ratio))
      T.eq(degraded.pulse.Budget.degraded, false, 'never had to degrade itself')
    end)

    T.test('does not invent problems on a healthy server', function()
      local clean = run.run(SPAN_HOURS, { degrade = false, seed = 4242 })
      local cleanSamples = run.delivered(clean.world)
      local cleanRate = sumIn(cleanSamples, 'hitches', UPDATE_AT, SPAN_HOURS * HOUR) / 8
      local badRate = sumIn(samples, 'hitches', UPDATE_AT, SPAN_HOURS * HOUR) / 8
      T.gt(badRate, cleanRate * 2,
        ('healthy server reads quieter (%.1f/h vs %.1f/h)'):format(cleanRate, badRate))
    end)
  end)

  T.suite('wire format', function()
    local _, payloads = run.delivered(degraded.world)

    T.test('payload carries what the backend needs to route it', function()
      local p = payloads[1]
      T.ok(p.server and p.server.name, 'server identified')
      T.ok(p.agent and p.agent.version, 'agent version present')
      T.ok(p.agent.cpuRatio ~= nil, 'agent reports its own cost')
      T.ok(p.agent.buffered ~= nil, 'agent reports queue depth')
    end)

    T.test('every sample is a typed, timestamped tick', function()
      for _, s in ipairs(payloads[1].samples) do
        T.eq(s.kind, 'tick', 'sample is typed')
        T.ok(s.at and s.at > 0, 'timestamped')
        T.ok(s.samples and s.samples > 0, 'window has probe samples')
        T.ok(s.players ~= nil, 'population recorded alongside')
        -- Without a wall clock the backend cannot build a timeline that
        -- survives a server restart, nor place samples that were buffered
        -- through an outage.
        T.ok(s.wall and s.wall > 1600000000, 'carries wall-clock seconds')
      end
    end)
  end)
end
