-- Headline numbers from a simulated day. Run: lua5.4 test/report.lua
local run = dofile('sim/run.lua')
local HOUR = run.MS_PER_HOUR
local t0 = os.clock()
local r = run.run(24)
local wall = os.clock() - t0
local samples = run.delivered(r.world)

local function sumIn(field, from, to)
  local n = 0
  for _, s in ipairs(samples) do
    if s.at >= from and s.at < to then n = n + (s[field] or 0) end
  end
  return n
end

local injected = 0
for _, s in ipairs(r.world.truth.stalls) do
  if s.dur >= Pulse.Config.hitchThresholdMs then injected = injected + s.dur end
end
local detected = sumIn('stallMs', 0, 24 * HOUR)

print(('simulated 24h of a %d-resource server in %.1fs of wall clock')
  :format(#r.world.resources, wall))
print(('  probe samples taken     %d'):format(24 * 3600 * 1000 // Pulse.Config.tickIntervalMs))
print(('  windows shipped         %d'):format(#samples))
print(('  faults injected         %d stalls, %dms total above threshold'):format(#r.world.truth.stalls, injected))
print(('  stall time recovered    %dms  (%.0f%% of injected)'):format(detected, detected / injected * 100))
print(('  hitch rate before 12:00 %.1f/h'):format(sumIn('hitches', 0, 12 * HOUR) / 12))
print(('  hitch rate after  12:00 %.1f/h'):format(sumIn('hitches', 12 * HOUR, 24 * HOUR) / 12))
print(('  collector cpu cost      %.5f%% of one core (budget %.3f%%)')
  :format(r.pulse.Budget.ratio(r.sched.now) * 100, Pulse.Config.cpuBudgetRatio * 100))
print(('  samples lost to backpressure  %d'):format(r.pulse.state.buffer.dropped))
