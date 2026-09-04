-- Delivery to the backend.
--
-- Failure is the normal case, not the exception: the operator's panel will be
-- restarted, misconfigured, or simply offline. So delivery never blocks
-- collection, never retries in a tight loop, and never grows memory -- a failed
-- batch goes back on the bounded buffer and the oldest samples fall off the end.
Pulse = Pulse or {}

local Shipper = {}
Shipper.__index = Shipper

local BACKOFF_BASE_MS = 5000
local BACKOFF_MAX_MS = 300000

function Shipper.new(cfg, buffer)
  return setmetatable({
    cfg = cfg, buffer = buffer,
    inflight = false, failures = 0, nextAttemptMs = 0,
    batchesSent = 0, samplesSent = 0, lastStatus = nil,
  }, Shipper)
end

function Shipper:backoffMs()
  local ms = BACKOFF_BASE_MS * (2 ^ math.min(self.failures, 6))
  return math.min(ms, BACKOFF_MAX_MS)
end

function Shipper:flush(nowMs, agentInfo)
  if self.inflight or nowMs < self.nextAttemptMs then return false end
  local batch = self.buffer:drain(self.cfg.batchSize)
  if #batch == 0 then return false end

  self.inflight = true
  local payload = json.encode({
    server = { name = self.cfg.serverName },
    agent = agentInfo,
    samples = batch,
  })

  PerformHttpRequest(self.cfg.endpoint, function(status)
    self.inflight = false
    self.lastStatus = status
    -- 4xx means this payload will never be accepted; retrying it forever would
    -- block every later sample behind it, so drop it and keep collecting.
    if status >= 200 and status < 300 then
      self.failures = 0
      self.batchesSent = self.batchesSent + 1
      self.samplesSent = self.samplesSent + #batch
    elseif status >= 400 and status < 500 then
      self.failures = 0
    else
      self.failures = self.failures + 1
      self.buffer:requeue(batch)
      self.nextAttemptMs = GetGameTimer() + self:backoffMs()
    end
  end, 'POST', payload, {
    ['Content-Type'] = 'application/json',
    ['Authorization'] = 'Bearer ' .. (self.cfg.token or ''),
    ['X-Pulse-Agent'] = Pulse.VERSION,
  })
  return true
end

-- A single empty batch, sent now, purely to find out whether the endpoint and
-- the token are right. An operator whose telemetry is not arriving otherwise
-- has to guess between a wrong URL, a wrong token, a closed port and a backend
-- that is not running -- and every one of those looks identical from here.
function Shipper:ping(cb)
  local started = GetGameTimer()
  PerformHttpRequest(self.cfg.endpoint, function(status, body)
    cb(status, GetGameTimer() - started, body)
  end, 'POST', json.encode({
    server = { name = self.cfg.serverName },
    agent = { version = Pulse.VERSION, probe = true },
    samples = {},
  }), {
    ['Content-Type'] = 'application/json',
    ['Authorization'] = 'Bearer ' .. (self.cfg.token or ''),
    ['X-Pulse-Agent'] = Pulse.VERSION,
  })
end

Pulse.Shipper = Shipper
