return function(T, run)
  T.suite('hitch: drift accounting', function()
    run.build()
    local Hitch = Pulse.Hitch

    T.test('drift below threshold is measured but not an event', function()
      local h = Hitch.new(50, 100)
      for _ = 1, 100 do h:observe(3, 0) end
      local s = h:summary(0, 10)
      T.eq(s.samples, 100, 'all samples counted')
      T.eq(s.hitches, 0, 'no hitch events')
      T.lte(s.p95DriftMs, 5, 'p95 in the lowest bucket')
    end)

    T.test('a stall is recorded with its magnitude', function()
      local h = Hitch.new(50, 100)
      for _ = 1, 99 do h:observe(2, 0) end
      h:observe(850, 12345)
      local s = h:summary(0, 10)
      T.eq(s.hitches, 1, 'one hitch')
      T.eq(s.maxDriftMs, 850, 'magnitude preserved')
      T.eq(s.stallMs, 850, 'stall time attributed')
      T.eq(s.events[1].at, 12345, 'timestamped')
    end)

    T.test('quantiles track the distribution', function()
      local h = Hitch.new(50, 100)
      for _ = 1, 90 do h:observe(1, 0) end
      for _ = 1, 10 do h:observe(300, 0) end
      local s = h:summary(0, 10)
      T.lte(s.p50DriftMs, 5, 'median stays low')
      T.gte(s.p95DriftMs, 250, 'p95 reaches the slow tail')
    end)

    T.test('event list is bounded, overflow counted', function()
      local h = Hitch.new(50, 100)
      for i = 1, 200 do h:observe(500, i) end
      local s = h:summary(0, 10)
      T.eq(s.hitches, 200, 'every hitch counted')
      T.lte(#s.events, 50, 'event detail capped')
      T.eq(s.eventsDropped, 150, 'truncation is reported, not silent')
    end)

    T.test('negative drift cannot arrive from a clock going backwards', function()
      local h = Hitch.new(50, 100)
      h:observe(-40, 0)
      T.eq(h:summary(0, 0).maxDriftMs, 0, 'clamped to zero')
    end)

    T.test('reset clears the window', function()
      local h = Hitch.new(50, 100)
      h:observe(500, 1)
      h:reset()
      local s = h:summary(0, 0)
      T.eq(s.samples, 0, 'counters cleared')
      T.eq(s.hitches, 0, 'events cleared')
    end)
  end)
end
