-- Deterministic virtual-time scheduler.
--
-- FiveM runs resource threads cooperatively on a single main thread: a thread
-- yields with Wait(ms) and the runtime wakes it later. We model exactly that,
-- but drive the clock ourselves so a 24-hour server day replays in milliseconds
-- and always produces the same result.
--
-- The important part is stalls. When something blocks the FiveM main thread --
-- a synchronous DB query, a badly written loop -- every other thread wakes up
-- late. That late wakeup is the only signal a server-side collector can
-- actually observe, so the simulator has to reproduce it faithfully: a stall
-- pushes the clock forward *without* running anyone, and threads then measure
-- more elapsed time than they asked for.

local Scheduler = {}
Scheduler.__index = Scheduler

function Scheduler.new()
  return setmetatable({
    now = 0,        -- virtual milliseconds since server start
    threads = {},
    stalls = {},    -- pending main-thread blockages, sorted lazily by time
    stallIdx = 1,
    stallsDirty = false,
    deadCount = 0,
    nextId = 1,
  }, Scheduler)
end

function Scheduler:createThread(fn)
  local t = { id = self.nextId, co = coroutine.create(fn), wake = self.now, dead = false }
  self.nextId = self.nextId + 1
  self.threads[#self.threads + 1] = t
  return t.id
end

function Scheduler:setTimeout(ms, fn)
  return self:createThread(function()
    coroutine.yield(ms)
    fn()
  end)
end

-- Block the main thread for `durationMs` at virtual time `atMs`.
-- Sorting is deferred to the first run() so planning a day's worth of faults
-- stays linear instead of re-sorting on every insert.
function Scheduler:scheduleStall(atMs, durationMs)
  self.stalls[#self.stalls + 1] = { at = atMs, dur = durationMs }
  self.stallsDirty = true
end

function Scheduler:earliestWake()
  local earliest = nil
  for _, t in ipairs(self.threads) do
    if not t.dead and (earliest == nil or t.wake < earliest) then earliest = t.wake end
  end
  return earliest
end

-- Advance to `target`, applying any stall that comes due on the way. A stall
-- extends the target, so a stall can pull a later one into the same window --
-- the walk keeps going while that holds. Stalls are sorted and consumed with a
-- cursor, so this is amortised O(1) per tick rather than a scan of every fault
-- planned for the day.
function Scheduler:applyStalls(target)
  local stalls, i = self.stalls, self.stallIdx
  while i <= #stalls and stalls[i].at <= target do
    target = target + stalls[i].dur
    i = i + 1
  end
  self.stallIdx = i
  return target
end

function Scheduler:run(untilMs)
  if self.stallsDirty then
    table.sort(self.stalls, function(a, b) return a.at < b.at end)
    self.stallsDirty = false
  end
  self.stallIdx = self.stallIdx or 1

  local due = {}
  while true do
    local nextWake = self:earliestWake()
    if nextWake == nil then break end
    if nextWake > untilMs then
      self.now = untilMs
      break
    end

    self.now = math.max(self.now, self:applyStalls(nextWake))

    -- Snapshot: a resumed thread may spawn more threads, which must not run
    -- until the next tick. The table is reused across ticks -- at ~20 ticks per
    -- simulated second, allocating one per tick is most of the harness cost.
    local n = 0
    for _, t in ipairs(self.threads) do
      if not t.dead and t.wake <= self.now then
        n = n + 1
        due[n] = t
      end
    end

    for k = 1, n do
      local t = due[k]
      local ok, yielded = coroutine.resume(t.co)
      if not ok then
        t.dead = true
        self.deadCount = self.deadCount + 1
        self.lastError = yielded
        error(("simulated thread %d crashed: %s"):format(t.id, tostring(yielded)), 0)
      elseif coroutine.status(t.co) == 'dead' then
        t.dead = true
        self.deadCount = self.deadCount + 1
      else
        t.wake = self.now + (tonumber(yielded) or 0)
      end
    end

    -- Every HTTP call and every SetTimeout is a one-shot thread, so over a
    -- simulated day the list fills with corpses. Left alone they dominate the
    -- run: the wake scan is per tick, and there are twenty ticks a second.
    if self.deadCount > 64 then self:compact() end
  end
  return self.now
end

function Scheduler:compact()
  local live = {}
  for _, t in ipairs(self.threads) do
    if not t.dead then live[#live + 1] = t end
  end
  self.threads = live
  self.deadCount = 0
end

return Scheduler
