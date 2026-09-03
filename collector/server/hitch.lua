-- Main-thread stall detection.
--
-- This is the core signal, and on a FiveM server it is also the only one we can
-- gather honestly. There is no server native that hands you per-resource CPU
-- time, so anything claiming to break down server CPU by resource is guessing.
-- What we *can* measure exactly is our own lateness: a thread that asks to sleep
-- 50ms and wakes at 900ms proves the main thread was blocked for 850ms, because
-- FiveM runs resource threads cooperatively on that one thread.
--
-- Attribution then comes from correlation over time -- which is precisely why
-- history matters and why resmon, which only ever shows "now", cannot do it.
--
-- Distribution is kept as a fixed-bucket histogram rather than a sample list:
-- O(1) memory regardless of uptime. Quantiles are therefore bucket-accurate,
-- and reported as the bucket's upper bound, so p95 is an upper estimate.
Pulse = Pulse or {}

local BOUNDS = { 5, 10, 20, 35, 50, 75, 100, 150, 250, 400, 650, 1000, 2000 }
local MAX_EVENTS_PER_WINDOW = 50

local Hitch = {}
Hitch.__index = Hitch

function Hitch.new(intervalMs, thresholdMs)
  local self = setmetatable({
    intervalMs = intervalMs or 50,
    thresholdMs = thresholdMs or 100,
  }, Hitch)
  self:reset()
  return self
end

function Hitch:reset()
  self.counts = {}
  for i = 1, #BOUNDS + 1 do self.counts[i] = 0 end
  self.n, self.sum, self.max = 0, 0, 0
  self.hitchCount, self.hitchMs = 0, 0
  self.events, self.eventsDropped = {}, 0
end

function Hitch:observe(driftMs, nowMs)
  if driftMs < 0 then driftMs = 0 end

  local bucket = #BOUNDS + 1
  for i = 1, #BOUNDS do
    if driftMs <= BOUNDS[i] then bucket = i break end
  end
  self.counts[bucket] = self.counts[bucket] + 1

  self.n = self.n + 1
  self.sum = self.sum + driftMs
  if driftMs > self.max then self.max = driftMs end

  if driftMs >= self.thresholdMs then
    self.hitchCount = self.hitchCount + 1
    self.hitchMs = self.hitchMs + driftMs
    if #self.events < MAX_EVENTS_PER_WINDOW then
      self.events[#self.events + 1] = { at = nowMs, ms = math.floor(driftMs) }
    else
      self.eventsDropped = self.eventsDropped + 1
    end
  end
end

-- Upper bound of the bucket holding the q-th sample.
function Hitch:quantile(q)
  if self.n == 0 then return 0 end
  local target = math.ceil(self.n * q)
  local seen = 0
  for i = 1, #BOUNDS do
    seen = seen + self.counts[i]
    if seen >= target then return BOUNDS[i] end
  end
  return self.max
end

function Hitch:summary(nowMs, players)
  return {
    kind = 'tick',
    at = nowMs,
    players = players,
    samples = self.n,
    meanDriftMs = self.n > 0 and (self.sum / self.n) or 0,
    p50DriftMs = self:quantile(0.50),
    p95DriftMs = self:quantile(0.95),
    p99DriftMs = self:quantile(0.99),
    maxDriftMs = math.floor(self.max),
    -- Total time the main thread was unavailable during this window, which is
    -- the number an operator actually feels.
    stallMs = math.floor(self.hitchMs),
    hitches = self.hitchCount,
    events = self.events,
    eventsDropped = self.eventsDropped,
  }
end

Pulse.Hitch = Hitch
