-- Configuration.
--
-- Three sources, in order of precedence:
--
--   1. server convars      -- the operator's explicit choice, and the only one
--                             that survives being re-downloaded
--   2. settings.json       -- shipped inside the resource by the backend, so a
--                             download arrives already pointed at the right
--                             endpoint with the right token
--   3. the defaults below
--
-- The middle one is what makes installing this a single line in server.cfg
-- instead of three convars copied by hand. A convar still wins, so an operator
-- who wants to override the bundled settings can, without editing files that a
-- future download would overwrite.
Pulse = Pulse or {}

local bundled = {}
if type(LoadResourceFile) == 'function' and type(GetCurrentResourceName) == 'function' then
  local raw = LoadResourceFile(GetCurrentResourceName(), 'settings.json')
  if type(raw) == 'string' and raw ~= '' then
    -- A settings file someone hand-edited into invalid JSON must not stop the
    -- resource from starting; the defaults still work.
    local ok, parsed = pcall(json.decode, raw)
    if ok and type(parsed) == 'table' then
      bundled = parsed
    else
      print('[pulse] settings.json could not be parsed, ignoring it')
    end
  end
end

Pulse.bundledSettings = bundled

local function convar(key, default)
  if type(GetConvar) ~= 'function' then return default end
  local v = GetConvar(key, '')
  return (v ~= nil and v ~= '') and v or default
end

-- key is the convar name; settings.json uses the same name without the prefix.
local function setting(key, default)
  local fromConvar = convar(key, nil)
  if fromConvar ~= nil then return fromConvar end
  local bundledValue = bundled[key:gsub('^pulse_', '')]
  if bundledValue ~= nil and bundledValue ~= '' then return bundledValue end
  return default
end

local function settingInt(key, default)
  return math.tointeger(tonumber(setting(key, nil)) or default) or default
end

Pulse.Config = {
  endpoint    = setting('pulse_endpoint', 'http://127.0.0.1:8787/v1/ingest'),
  token       = setting('pulse_token', ''),
  serverName  = setting('pulse_server_name', 'unnamed-server'),

  -- How often the drift probe wakes. 50ms is frequent enough to catch a
  -- single-frame hitch without being a cost in itself.
  tickIntervalMs   = settingInt('pulse_tick_interval', 50),
  -- Drift above this is recorded as a discrete hitch event. Below it, drift
  -- still lands in the histogram.
  hitchThresholdMs = settingInt('pulse_hitch_threshold', 100),
  -- Walking 200 resources is cheap but not free; 10s is plenty to catch a
  -- restart, and resource-state events give us the exact moment anyway.
  inventoryIntervalMs = settingInt('pulse_inventory_interval', 10000),
  -- One rolled-up sample per window is what reaches the backend.
  windowMs   = settingInt('pulse_window', 15000),
  flushMs    = settingInt('pulse_flush_interval', 30000),
  batchSize  = settingInt('pulse_batch_size', 40),
  bufferSize = settingInt('pulse_buffer_size', 2000),

  -- Hard ceiling on our own cost, as a fraction of wall time. If we exceed it
  -- we degrade ourselves rather than become the problem we were installed to
  -- find. 0.0005 = 0.05% of one core.
  cpuBudgetRatio = tonumber(setting('pulse_cpu_budget', '0.0005')),
}
