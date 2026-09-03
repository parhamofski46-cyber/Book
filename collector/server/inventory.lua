-- Resource inventory and state changes.
--
-- Correlating a stall with what changed just before it is the whole product, so
-- we need an exact record of restarts. Two sources, because neither alone is
-- reliable: resource events give precise timing but are missed if we start
-- after them, and a periodic walk catches anything the events missed.
Pulse = Pulse or {}

local Inventory = {}
Inventory.__index = Inventory

function Inventory.new()
  return setmetatable({ known = nil, changes = {}, maxChanges = 200 }, Inventory)
end

function Inventory:snapshot()
  local states, count = {}, GetNumResources()
  for i = 0, count - 1 do
    local name = GetResourceByFindIndex(i)
    if name then states[name] = GetResourceState(name) end
  end
  return states
end

function Inventory:record(change)
  if #self.changes >= self.maxChanges then table.remove(self.changes, 1) end
  self.changes[#self.changes + 1] = change
end

-- Emitted by the FiveM resource lifecycle events; authoritative on timing.
function Inventory:onEvent(kind, name, nowMs)
  self:record({ at = nowMs, resource = name, change = kind, source = 'event' })
end

-- Periodic reconciliation; catches whatever the events did not.
function Inventory:poll(nowMs)
  local current = self:snapshot()
  if self.known then
    for name, state in pairs(current) do
      local was = self.known[name]
      if was == nil then
        self:record({ at = nowMs, resource = name, change = 'added', source = 'poll' })
      elseif was ~= state then
        self:record({ at = nowMs, resource = name, change = state, from = was, source = 'poll' })
      end
    end
    for name in pairs(self.known) do
      if current[name] == nil then
        self:record({ at = nowMs, resource = name, change = 'removed', source = 'poll' })
      end
    end
  end
  self.known = current
  return current
end

function Inventory:count()
  local n = 0
  for _ in pairs(self.known or {}) do n = n + 1 end
  return n
end

function Inventory:drainChanges()
  local out = self.changes
  self.changes = {}
  return out
end

Pulse.Inventory = Inventory
