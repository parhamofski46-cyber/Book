-- Live mode: the simulated FiveM server, but its HTTP goes out for real.
--
-- Everything else in the test suite stops at the wire. The collector's payloads
-- are replayed into the backend as bytes, which proves the format but not the
-- transport: a wrong header, a body the server will not parse, a URL joined
-- with one slash too many -- none of those would ever show up.
--
-- So this swaps PerformHttpRequest for curl. Slow, and not something to run in
-- a loop, but it is the only check that exercises Lua, HTTP and Node together.
--
--   lua5.4 sim/live.lua <endpoint> <token> <minutes>

local endpoint = assert(arg[1], 'usage: live.lua <endpoint> <token> <minutes>')
local token = assert(arg[2], 'a collector token is required')
local minutes = tonumber(arg[3] or '30')

-- Captured before run.build, which shims os.time onto the virtual clock.
--
-- The recorded fixtures use a fixed epoch so they stay byte-stable, but a live
-- backend rejects anything more than a day from its own clock -- correctly, since
-- a server with a badly wrong clock would corrupt every timeline it touched. So
-- live mode runs on real time, ending about now.
local realNow = os.time()

local run = dofile('sim/run.lua')
local sched, world, pulse = run.build({
  baseWallS = realNow - (minutes * 60),
  convars = { pulse_endpoint = endpoint, pulse_token = token },
})

local bodyFile = os.tmpname()
local replyFile = os.tmpname()
local sent, failed, stored, skipped = 0, 0, 0, 0
local statuses = {}

-- Replace the in-memory transport with a real one. The body goes via a file so
-- nothing from the payload is ever interpolated into a shell command.
_G.PerformHttpRequest = function(url, cb, method, data, headers)
  local f = assert(io.open(bodyFile, 'w'))
  f:write(data or '')
  f:close()

  local parts = { ('curl -s -o %q -w "%%{http_code}"'):format(replyFile), '-X', method or 'POST' }
  for k, v in pairs(headers or {}) do
    parts[#parts + 1] = ("-H %q"):format(k .. ': ' .. v)
  end
  parts[#parts + 1] = ('--data-binary @%q'):format(bodyFile)
  parts[#parts + 1] = ('%q'):format(url)

  local pipe = assert(io.popen(table.concat(parts, ' ')))
  local status = tonumber(pipe:read('a')) or 0
  pipe:close()

  local reply = ''
  local rf = io.open(replyFile, 'r')
  if rf then reply = rf:read('a') or '' rf:close() end

  -- A 200 is not success on its own: ingest answers 200 while skipping every
  -- sample in a batch it could not use. Counting only the status is how a
  -- silently rejected payload passes for a working pipeline.
  stored = stored + (tonumber(reply:match('"stored":(%d+)')) or 0)
  skipped = skipped + (tonumber(reply:match('"skipped":(%d+)')) or 0)

  statuses[status] = (statuses[status] or 0) + 1
  if status >= 200 and status < 300 then sent = sent + 1 else failed = failed + 1 end
  if cb then cb(status, reply, {}) end
end

world:plan(minutes / 60, false)
sched:run(minutes * 60 * 1000)
os.remove(bodyFile)
os.remove(replyFile)

local codes = {}
for code, n in pairs(statuses) do codes[#codes + 1] = ('%d x%d'):format(code, n) end
table.sort(codes)

print(('live: %d requests delivered, %d failed  [%s]'):format(sent, failed, table.concat(codes, ', ')))
print(('      %d windows accepted, %d skipped by the backend'):format(stored, skipped))
print(('agent cpu %.5f%%, buffered %d, dropped %d')
  :format(pulse.Budget.ratio(sched.now) * 100, pulse.state.buffer:size(), pulse.state.buffer.dropped))

if failed > 0 or sent == 0 then os.exit(1) end
if stored == 0 then
  print('FAILED: every request was accepted but no window was stored.')
  os.exit(1)
end
if skipped > 0 then
  print(('FAILED: the backend discarded %d windows.'):format(skipped))
  os.exit(1)
end
os.exit(0)
