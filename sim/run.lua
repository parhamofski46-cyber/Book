-- Harness: assembles a simulated server, loads the collector into it unchanged,
-- and replays a span of server time.
--
-- The collector files are loaded in the exact order fxmanifest.lua declares, so
-- a load-order bug shows up here rather than on someone's live server.

local ROOT = (os.getenv('PULSE_ROOT') or '.'):gsub('/$', '')

local MANIFEST_ORDER = {
  'collector/config.lua',
  'collector/server/budget.lua',
  'collector/server/buffer.lua',
  'collector/server/hitch.lua',
  'collector/server/inventory.lua',
  'collector/server/shipper.lua',
  'collector/server/main.lua',
}

local M = {}

M.MANIFEST_ORDER = MANIFEST_ORDER
M.MS_PER_HOUR = 3600 * 1000

function M.build(opts)
  opts = opts or {}
  local Scheduler = dofile(ROOT .. '/sim/scheduler.lua')
  local Natives   = dofile(ROOT .. '/sim/natives.lua')
  local Workload  = dofile(ROOT .. '/sim/workload.lua')

  local sched = Scheduler.new()
  local world = Workload.new(sched, opts)
  world.convars = opts.convars or {}
  world.resourceFiles = opts.resourceFiles or {}
  Natives.install(sched, world)

  -- The collector keeps its state in a global, as a FiveM resource must.
  -- Clear it so repeated builds in one test process stay independent.
  _G.Pulse = nil
  for _, file in ipairs(MANIFEST_ORDER) do
    dofile(ROOT .. '/' .. file)
  end

  return sched, world, _G.Pulse
end

-- Build, plan a workload, and replay `hours` of server time.
function M.run(hours, opts)
  opts = opts or {}
  local sched, world, pulse = M.build(opts)
  world:plan(hours, opts.degrade)
  sched:run(hours * M.MS_PER_HOUR)
  return { sched = sched, world = world, pulse = pulse }
end

-- Everything the collector actually put on the wire, decoded.
function M.delivered(world)
  local samples, payloads = {}, {}
  for _, req in ipairs(world.http.delivered) do
    local body = json.decode(req.body)
    payloads[#payloads + 1] = body
    for _, s in ipairs(body.samples or {}) do samples[#samples + 1] = s end
  end
  return samples, payloads
end

return M
