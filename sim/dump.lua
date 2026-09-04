-- Replay a span of server time and write everything the collector shipped to a
-- JSONL file, one payload per line. The backend test suite replays that file
-- through the real ingest path, so the two halves of the product are joined by
-- bytes the collector actually produced rather than by a fixture someone typed.
--
--   lua5.4 sim/dump.lua <hours> <outfile> [seed]

local hours = tonumber(arg[1] or '24')
local outfile = arg[2] or 'backend/test/fixtures/day.jsonl'
local seed = tonumber(arg[3] or '20260903')

local run = dofile('sim/run.lua')
local r = run.run(hours, { seed = seed })

os.execute('mkdir -p "' .. outfile:match('^(.*)/[^/]*$') .. '"')
local f = assert(io.open(outfile, 'w'))
for _, req in ipairs(r.world.http.delivered) do
  f:write(req.body, '\n')
end
f:close()

-- Ground truth alongside, so the backend can be asserted against what was
-- actually injected rather than against its own output.
local truth = { hours = hours, seed = seed, restarts = r.world.truth.restarts, stalls = {} }
for _, s in ipairs(r.world.truth.stalls) do
  truth.stalls[#truth.stalls + 1] = { at = s.at, dur = s.dur, cause = s.cause }
end
local tf = assert(io.open(outfile:gsub('%.jsonl$', '') .. '.truth.json', 'w'))
tf:write(json.encode(truth))
tf:close()

print(('wrote %d payloads (%dh, seed %d) to %s'):format(#r.world.http.delivered, hours, seed, outfile))
