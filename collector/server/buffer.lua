-- Bounded ring buffer.
--
-- The backend can be down, slow, or unreachable for hours. A monitoring agent
-- that queues without a ceiling eventually takes the server down with it, so
-- this buffer has a fixed capacity and drops the oldest sample when full.
-- Losing old samples is acceptable; growing without bound is not. Drops are
-- counted and reported so the gap is visible rather than silent.
Pulse = Pulse or {}

local Buffer = {}
Buffer.__index = Buffer

function Buffer.new(capacity)
  return setmetatable({ items = {}, first = 1, last = 0, capacity = capacity or 2000, dropped = 0 }, Buffer)
end

function Buffer:size() return self.last - self.first + 1 end

function Buffer:push(item)
  if self:size() >= self.capacity then
    self.items[self.first] = nil
    self.first = self.first + 1
    self.dropped = self.dropped + 1
  end
  self.last = self.last + 1
  self.items[self.last] = item
end

function Buffer:drain(max)
  local out = {}
  while #out < max and self:size() > 0 do
    out[#out + 1] = self.items[self.first]
    self.items[self.first] = nil
    self.first = self.first + 1
  end
  return out
end

-- Put a failed batch back at the front so ordering survives a retry.
function Buffer:requeue(batch)
  for i = #batch, 1, -1 do
    self.first = self.first - 1
    self.items[self.first] = batch[i]
  end
  while self:size() > self.capacity do
    self.items[self.last] = nil
    self.last = self.last - 1
    self.dropped = self.dropped + 1
  end
end

Pulse.Buffer = Buffer
