-- A synthetic busy roleplay server.
--
-- The model exists to answer one question: if we ship this collector to a real
-- server, does it find what is actually wrong? So the workload injects faults
-- with known cause and timing, keeps that ground truth, and the test suite
-- asserts the collector recovers it. Anything the collector reports that the
-- workload did not inject is a false positive.
--
-- Everything is driven by a seeded LCG rather than math.random so a failing
-- test reproduces exactly.

local Workload = {}
Workload.__index = Workload

local MS_PER_HOUR = 3600 * 1000

local function lcg(seed)
  local s = seed % 2147483648
  return function()
    s = (1103515245 * s + 12345) % 2147483648
    return s / 2147483648
  end
end

-- A believable resource list for an ESX/QBCore-era server: the framework and
-- infrastructure resources every server runs, then filler to reach the ~200
-- that large servers actually load.
local function buildResources()
  local core = {
    'es_extended', 'qb-core', 'oxmysql', 'ox_lib', 'ox_inventory', 'ox_target',
    'ox_doorlock', 'pma-voice', 'spawnmanager', 'mapmanager', 'chat', 'hardcap',
    'sessionmanager', 'baseevents', 'rconlog', 'monitor', 'screenshot-basic',
    'qb-inventory', 'qb-phone', 'qb-garages', 'qb-banking', 'qb-houses',
    'qb-policejob', 'qb-ambulancejob', 'qb-mechanicjob', 'qb-taxijob',
    'qb-weapons', 'qb-clothing', 'qb-hud', 'qb-radialmenu', 'qb-multicharacter',
    'qb-spawn', 'qb-apartments', 'qb-shops', 'qb-vehicleshop', 'qb-fuel',
    'qb-drugs', 'qb-crafting', 'qb-management', 'qb-scoreboard',
  }
  local resources = {}
  for _, name in ipairs(core) do
    resources[#resources + 1] = { name = name, state = 'started' }
  end
  -- Filler: MLOs, vehicle packs and small scripts, which is what actually makes
  -- up the bulk of a 200-resource server.
  local kinds = { 'mlo', 'vehpack', 'script', 'prop', 'clothing' }
  local i = 1
  while #resources < 200 do
    local kind = kinds[(i % #kinds) + 1]
    resources[#resources + 1] = { name = ('%s_%03d'):format(kind, i), state = 'started' }
    i = i + 1
  end
  return resources
end

function Workload.new(sched, opts)
  opts = opts or {}
  local self = setmetatable({
    sched = sched,
    rand = lcg(opts.seed or 20260903),
    resources = buildResources(),
    -- Fixed epoch (2026-09-01T00:00:00Z) so dumped fixtures are byte-stable.
    baseWallS = opts.baseWallS or 1788220800,
    degradeAtHour = opts.degradeAtHour,
    minPlayers = opts.minPlayers or 18,
    maxPlayers = opts.maxPlayers or 190,
    http = { delivered = {}, attempts = 0, failUntilMs = 0, latencyMs = 40 },
    -- Ground truth the tests assert against.
    truth = { stalls = {}, restarts = {} },
  }, Workload)
  return self
end

-- Population follows a daily curve: trough around 09:00, peak around 21:00.
function Workload:playerCount(nowMs)
  local hour = (nowMs / MS_PER_HOUR) % 24
  local phase = (hour - 9) / 24 * 2 * math.pi
  local swing = (1 - math.cos(phase)) / 2
  return math.floor(self.minPlayers + (self.maxPlayers - self.minPlayers) * swing)
end

function Workload:injectStall(atMs, durationMs, cause)
  self.sched:scheduleStall(atMs, durationMs)
  self.truth.stalls[#self.truth.stalls + 1] =
    { at = atMs, dur = durationMs, cause = cause }
end

function Workload:restartResource(atMs, name, reason)
  local sched = self.sched
  sched:setTimeout(atMs - sched.now, function()
    for _, r in ipairs(self.resources) do
      if r.name == name then r.state = 'stopped' end
    end
    if self.triggerEvent then self.triggerEvent('onResourceStop', name) end
    sched:setTimeout(1500, function()
      for _, r in ipairs(self.resources) do
        if r.name == name then r.state = 'started' end
      end
      if self.triggerEvent then self.triggerEvent('onResourceStart', name) end
    end)
  end)
  self.truth.restarts[#self.truth.restarts + 1] = { at = atMs, name = name, reason = reason }
end

-- Lay out a full day: background noise proportional to population, a scheduled
-- restart cycle, and one resource that is quietly made worse by an update --
-- the case the product is meant to catch.
function Workload:plan(hours, degrade)
  degrade = degrade == nil and true or degrade
  local totalMs = hours * MS_PER_HOUR

  -- Baseline noise. A busy server hitches occasionally; frequency and size
  -- both scale with how many players are connected.
  local t = 0
  while t < totalMs do
    t = t + 20000 + math.floor(self.rand() * 100000)
    if t >= totalMs then break end
    local load = self:playerCount(t) / self.maxPlayers
    if self.rand() < 0.25 + 0.45 * load then
      self:injectStall(t, math.floor(60 + self.rand() * 140 * (0.5 + load)), 'baseline')
    end
  end

  -- Routine nightly restart of a couple of resources.
  for day = 0, math.max(0, math.ceil(hours / 24) - 1) do
    local base = day * 24 * MS_PER_HOUR
    self:restartResource(base + 6 * MS_PER_HOUR, 'qb-garages', 'scheduled')
    self:restartResource(base + 6 * MS_PER_HOUR + 60000, 'qb-houses', 'scheduled')
  end

  -- The scenario that sells the product: an operator updates qb-inventory at
  -- midday and from then on it stalls the main thread every ~45s. Nothing in
  -- the server console says so; resmon only shows "now".
  --
  -- On runs long enough to hold more than a day, the update lands on the
  -- second day, leaving clean history before it -- which is what a
  -- day-over-day comparison needs, and what a real server would have.
  local updateHour = self.degradeAtHour or (hours >= 48 and 36 or 12)
  if degrade and hours > updateHour + 1 then
    local updateAt = updateHour * MS_PER_HOUR
    self:restartResource(updateAt, 'qb-inventory', 'update')
    local s = updateAt + 60000
    while s < totalMs do
      self:injectStall(s, math.floor(180 + self.rand() * 220), 'qb-inventory')
      s = s + 40000 + math.floor(self.rand() * 15000)
    end
  end

  return self
end

return Workload
