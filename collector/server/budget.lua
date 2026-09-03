-- Self-instrumentation.
--
-- A performance monitor that costs performance is worse than no monitor: the
-- operator cannot tell our overhead from the fault we are supposed to find.
-- So we measure ourselves with the same seriousness, publish the number, and
-- back off automatically if we ever exceed the budget.
--
-- os.clock() is process CPU time with sub-millisecond resolution, which is what
-- we need here. GetGameTimer() is wall time and is used for everything else.
Pulse = Pulse or {}

local Budget = { cpuSeconds = 0, samples = 0, degraded = false, degradeCount = 0 }

-- Fast path for hot loops: record an already-measured cost without the
-- closure allocation that measure() would need per iteration.
function Budget.add(seconds)
  Budget.cpuSeconds = Budget.cpuSeconds + seconds
  Budget.samples = Budget.samples + 1
end

function Budget.measure(fn, ...)
  local t0 = os.clock()
  local a, b = fn(...)
  Budget.cpuSeconds = Budget.cpuSeconds + (os.clock() - t0)
  Budget.samples = Budget.samples + 1
  return a, b
end

-- Ratio of CPU we consumed against wall time elapsed since server start.
function Budget.ratio(nowMs)
  if nowMs <= 0 then return 0 end
  return Budget.cpuSeconds / (nowMs / 1000)
end

-- Called once per window. Returns a multiplier the caller applies to its own
-- sampling interval: 1 while we are within budget, >1 once we are not.
function Budget.review(nowMs, limitRatio)
  local ratio = Budget.ratio(nowMs)
  if ratio > limitRatio then
    Budget.degraded = true
    Budget.degradeCount = Budget.degradeCount + 1
    return 2
  end
  Budget.degraded = false
  return 1
end

function Budget.reset()
  Budget.cpuSeconds, Budget.samples = 0, 0
  Budget.degraded, Budget.degradeCount = false, 0
end

Pulse.Budget = Budget
