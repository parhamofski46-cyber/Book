-- FiveM server-native shims backed by the virtual scheduler.
--
-- These are installed as globals before the collector is loaded, so the
-- collector runs here completely unmodified -- the same files that ship as a
-- FiveM resource. Nothing in collector/ may know the simulator exists.
--
-- Only natives the collector is allowed to depend on are implemented. That is
-- deliberate: if a native is missing here, it is a signal that the collector
-- reached for something we have not committed to supporting.

local Natives = {}

function Natives.install(sched, world)
  local G = _G

  -- FiveM exposes a `json` global and convar access; both are part of the
  -- environment the collector runs in, so they belong here.
  G.json = dofile('sim/json.lua')
  G.GetConvar = function(key, default)
    local v = (world.convars or {})[key]
    return v ~= nil and tostring(v) or default
  end

  local function wait(ms) coroutine.yield(ms or 0) end

  G.CreateThread = function(fn) return sched:createThread(fn) end
  G.Wait = wait
  G.SetTimeout = function(ms, fn) return sched:setTimeout(ms, fn) end
  G.Citizen = { CreateThread = G.CreateThread, Wait = wait, SetTimeout = G.SetTimeout }

  -- Milliseconds since server start. Wall time, not CPU time -- this is what
  -- makes stall detection possible.
  G.GetGameTimer = function() return sched.now end

  -- os.time() must advance with virtual time, not the host's clock. The
  -- collector stamps every sample with it, and the backend builds its entire
  -- timeline on those stamps: left unshimmed, a simulated day arrives as
  -- thousands of samples all claiming the same second.
  -- os.clock() is deliberately NOT shimmed -- the collector's self-measurement
  -- has to remain real CPU time.
  os.time = function() return world.baseWallS + (sched.now // 1000) end

  G.GetCurrentResourceName = function() return 'pulse_collector' end
  G.GetNumResources = function() return #world.resources end

  -- FiveM indexes resources from zero.
  G.GetResourceByFindIndex = function(i)
    local r = world.resources[i + 1]
    return r and r.name or nil
  end

  G.GetResourceState = function(name)
    for _, r in ipairs(world.resources) do
      if r.name == name then return r.state end
    end
    return 'missing'
  end

  G.GetResourceMetadata = function(name, key)
    for _, r in ipairs(world.resources) do
      if r.name == name then return r.metadata and r.metadata[key] or nil end
    end
    return nil
  end

  G.GetNumPlayerIndices = function() return world:playerCount(sched.now) end
  G.GetPlayers = function()
    local out = {}
    for i = 1, world:playerCount(sched.now) do out[i] = tostring(i) end
    return out
  end

  G.PerformHttpRequest = function(url, cb, method, data, headers)
    local http = world.http
    http.attempts = http.attempts + 1
    local status = http.forceStatus
    if not status then
      status = (sched.now < http.failUntilMs) and 0 or 200
    end
    sched:setTimeout(http.latencyMs, function()
      if status < 200 or status >= 300 then
        if cb then cb(status, '', {}) end
      else
        http.delivered[#http.delivered + 1] =
          { at = sched.now, url = url, method = method, body = data, headers = headers }
        if cb then cb(status, '{"ok":true}', {}) end
      end
    end)
  end

  local handlers = {}
  G.AddEventHandler = function(name, fn)
    handlers[name] = handlers[name] or {}
    table.insert(handlers[name], fn)
    return { name = name }
  end
  G.RegisterNetEvent = function() end
  G.TriggerEvent = function(name, ...)
    for _, fn in ipairs(handlers[name] or {}) do fn(...) end
  end
  world.triggerEvent = G.TriggerEvent

  local commands = {}
  G.RegisterCommand = function(name, fn) commands[name] = fn end
  world.runCommand = function(name, args)
    local fn = commands[name]
    if fn then fn(0, args or {}, name) end
    return fn ~= nil
  end
end

return Natives
