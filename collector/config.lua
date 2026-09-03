-- Configuration. Every value is overridable with a server convar so operators
-- can tune without editing files (and without their edits being lost on update).
Pulse = Pulse or {}

local function convar(key, default)
  if type(GetConvar) ~= 'function' then return default end
  local v = GetConvar(key, '')
  return (v ~= nil and v ~= '') and v or default
end

local function convarInt(key, default)
  return math.tointeger(tonumber(convar(key, nil)) or default) or default
end

Pulse.Config = {
  endpoint    = convar('pulse_endpoint', 'http://127.0.0.1:8787/v1/ingest'),
  token       = convar('pulse_token', ''),
  serverName  = convar('pulse_server_name', 'unnamed-server'),

  -- How often the drift probe wakes. 50ms is frequent enough to catch a
  -- single-frame hitch without being a cost in itself.
  tickIntervalMs   = convarInt('pulse_tick_interval', 50),
  -- Drift above this is recorded as a discrete hitch event. Below it, drift
  -- still lands in the histogram.
  hitchThresholdMs = convarInt('pulse_hitch_threshold', 100),
  -- Walking 200 resources is cheap but not free; 10s is plenty to catch a
  -- restart, and resource-state events give us the exact moment anyway.
  inventoryIntervalMs = convarInt('pulse_inventory_interval', 10000),
  -- One rolled-up sample per window is what reaches the backend.
  windowMs   = convarInt('pulse_window', 15000),
  flushMs    = convarInt('pulse_flush_interval', 30000),
  batchSize  = convarInt('pulse_batch_size', 40),
  bufferSize = convarInt('pulse_buffer_size', 2000),

  -- Hard ceiling on our own cost, as a fraction of wall time. If we exceed it
  -- we degrade ourselves rather than become the problem we were installed to
  -- find. 0.0005 = 0.05% of one core.
  cpuBudgetRatio = tonumber(convar('pulse_cpu_budget', '0.0005')),
}
