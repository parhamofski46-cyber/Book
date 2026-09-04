-- Wiring and the sampling loops.
Pulse = Pulse or {}
Pulse.VERSION = '0.1.0'

local cfg = Pulse.Config
local buffer = Pulse.Buffer.new(cfg.bufferSize)
local hitch = Pulse.Hitch.new(cfg.tickIntervalMs, cfg.hitchThresholdMs)
local inventory = Pulse.Inventory.new()
local shipper = Pulse.Shipper.new(cfg, buffer)
local Budget = Pulse.Budget

-- Raised by Budget.review when we cost more than we are allowed to.
local intervalMultiplier = 1

Pulse.state = {
  buffer = buffer, hitch = hitch, inventory = inventory, shipper = shipper,
  startedAt = 0, windows = 0,
}

local function agentInfo(nowMs)
  return {
    version = Pulse.VERSION,
    uptimeMs = nowMs - Pulse.state.startedAt,
    cpuRatio = Budget.ratio(nowMs),
    degraded = Budget.degraded,
    buffered = buffer:size(),
    droppedSamples = buffer.dropped,
  }
end

-- Probe. Asks to sleep for a known interval and reports how much longer it
-- actually took; that excess is main-thread time no resource could use.
local function probeLoop()
  while true do
    local expected = cfg.tickIntervalMs * intervalMultiplier
    local t0 = GetGameTimer()
    Wait(expected)
    local now = GetGameTimer()

    local c0 = os.clock()
    hitch:observe((now - t0) - expected, now)
    Budget.add(os.clock() - c0)
  end
end

-- Rolls the window up into one sample and hands it to the buffer.
local function windowLoop()
  while true do
    Wait(cfg.windowMs)
    local now = GetGameTimer()
    local c0 = os.clock()

    local sample = hitch:summary(now, GetNumPlayerIndices())
    -- GetGameTimer() restarts from zero with the server, so it cannot carry a
    -- history. Stamp wall-clock seconds as well: the backend needs a monotonic
    -- axis that survives restarts, and samples buffered through an outage must
    -- land at the time they were taken, not the time they were finally sent.
    sample.wall = os.time()
    sample.resources = inventory:count()
    local changes = inventory:drainChanges()
    if #changes > 0 then sample.resourceChanges = changes end
    buffer:push(sample)
    hitch:reset()

    Pulse.state.windows = Pulse.state.windows + 1
    intervalMultiplier = Budget.review(now, cfg.cpuBudgetRatio)
    Budget.add(os.clock() - c0)
  end
end

local function inventoryLoop()
  while true do
    local c0 = os.clock()
    inventory:poll(GetGameTimer())
    Budget.add(os.clock() - c0)
    Wait(cfg.inventoryIntervalMs)
  end
end

local function flushLoop()
  while true do
    Wait(cfg.flushMs)
    local now = GetGameTimer()
    local c0 = os.clock()
    shipper:flush(now, agentInfo(now))
    Budget.add(os.clock() - c0)
  end
end

function Pulse.status()
  local now = GetGameTimer()
  return {
    version = Pulse.VERSION,
    uptimeMs = now - Pulse.state.startedAt,
    windows = Pulse.state.windows,
    buffered = buffer:size(),
    dropped = buffer.dropped,
    batchesSent = shipper.batchesSent,
    samplesSent = shipper.samplesSent,
    lastStatus = shipper.lastStatus,
    failures = shipper.failures,
    cpuRatio = Budget.ratio(now),
    degraded = Budget.degraded,
  }
end

function Pulse.start()
  Pulse.state.startedAt = GetGameTimer()
  inventory:poll(Pulse.state.startedAt)

  AddEventHandler('onResourceStart', function(name)
    if name ~= GetCurrentResourceName() then inventory:onEvent('started', name, GetGameTimer()) end
  end)
  AddEventHandler('onResourceStop', function(name)
    if name ~= GetCurrentResourceName() then inventory:onEvent('stopped', name, GetGameTimer()) end
  end)

  CreateThread(probeLoop)
  CreateThread(windowLoop)
  CreateThread(inventoryLoop)
  CreateThread(flushLoop)

  RegisterCommand('pulse', function()
    local s = Pulse.status()
    print(('[pulse] v%s  windows=%d  buffered=%d  dropped=%d  sent=%d  cpu=%.4f%%%s')
      :format(s.version, s.windows, s.buffered, s.dropped, s.samplesSent,
              s.cpuRatio * 100, s.degraded and '  DEGRADED' or ''))
  end, true)
end

Pulse.start()
