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

-- Turns an HTTP result into the one sentence that tells the operator what to
-- change. Kept separate from the command so the test suite can check every
-- branch without a network.
function Pulse.diagnose(status)
  if status >= 200 and status < 300 then
    return true, 'OK. The backend accepted this server\'s token.'
  elseif status == 401 or status == 403 then
    return false, 'The backend rejected the token. Check pulse_token matches the one you were given.'
  elseif status == 404 then
    return false, 'Reached a server, but not the ingest endpoint. pulse_endpoint should end with /v1/ingest.'
  elseif status == 429 then
    return true, 'Rate limited, which means the backend is up and the token works. Nothing to fix.'
  elseif status >= 500 then
    return false, 'The backend is reachable but returned an error. Check its logs.'
  elseif status == 0 then
    return false, 'Could not reach the backend at all. Check the URL and port, that the backend is running, and that this machine can reach it.'
  end
  return false, ('Unexpected response (%d).'):format(status)
end

function Pulse.selfTest(print_)
  print_ = print_ or print
  print_(('[pulse] endpoint : %s'):format(cfg.endpoint))
  print_(('[pulse] token    : %s'):format(
    cfg.token == '' and '(not set)' or (cfg.token:sub(1, 8) .. '...')))

  if cfg.token == '' then
    print_('[pulse] FAILED: pulse_token is not set. Run add-server.js on the backend to get one.')
    return
  end

  print_('[pulse] sending a test batch...')
  shipper:ping(function(status, ms)
    local ok, message = Pulse.diagnose(status)
    print_(('[pulse] %s (HTTP %d, %dms)'):format(ok and 'PASS' or 'FAILED', status, ms))
    print_('[pulse] ' .. message)
  end)
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

  RegisterCommand('pulse', function(_, args)
    if args[1] == 'test' then return Pulse.selfTest() end

    local s = Pulse.status()
    print(('[pulse] v%s  cpu %.4f%% of one core%s')
      :format(s.version, s.cpuRatio * 100, s.degraded and '  DEGRADED' or ''))
    print(('[pulse] %d windows recorded, %d sent, %d queued, %d dropped')
      :format(s.windows, s.samplesSent, s.buffered, s.dropped))
    if s.lastStatus == nil then
      print('[pulse] nothing sent yet. Run "pulse test" to check the connection.')
    elseif s.failures > 0 then
      local _, why = Pulse.diagnose(s.lastStatus)
      print(('[pulse] last send failed (HTTP %d): %s'):format(s.lastStatus, why))
    else
      print(('[pulse] last send OK (HTTP %d)'):format(s.lastStatus))
    end
  end, true)
end

Pulse.start()
