return function(T, run)
  T.suite('manifest: harness and resource load the same files', function()
    T.test('fxmanifest server_scripts match the simulator load order', function()
      local f = assert(io.open('collector/fxmanifest.lua', 'r'))
      local text = f:read('a')
      f:close()

      local block = text:match('server_scripts%s*{(.-)}')
      T.ok(block, 'server_scripts block found')

      local declared = {}
      for path in block:gmatch("'([^']+)'") do
        declared[#declared + 1] = 'collector/' .. path
      end

      -- If these ever diverge, the suite is exercising a load order no live
      -- server will ever use, and a load-order bug ships silently.
      T.eq(#declared, #run.MANIFEST_ORDER, 'same number of files')
      for i, path in ipairs(run.MANIFEST_ORDER) do
        T.eq(declared[i], path, ('entry %d matches'):format(i))
      end
    end)

    T.test('a bundled settings.json configures the resource on its own', function()
      -- What a downloaded, pre-configured collector looks like: no convars at
      -- all, and it still knows where to report and with which token.
      run.build({ resourceFiles = { ['settings.json'] =
        '{"endpoint":"https://box:9000/v1/ingest","token":"pls_bundled","server_name":"downloaded-rp"}' } })
      T.eq(Pulse.Config.endpoint, 'https://box:9000/v1/ingest', 'endpoint came from the file')
      T.eq(Pulse.Config.token, 'pls_bundled', 'so did the token')
      T.eq(Pulse.Config.serverName, 'downloaded-rp', 'and the name')
    end)

    T.test('a convar still overrides what was shipped', function()
      run.build({
        convars = { pulse_endpoint = 'http://operators-choice/v1/ingest' },
        resourceFiles = { ['settings.json'] =
          '{"endpoint":"https://box:9000/v1/ingest","token":"pls_bundled"}' },
      })
      T.eq(Pulse.Config.endpoint, 'http://operators-choice/v1/ingest',
        'the operator wins over the download')
      T.eq(Pulse.Config.token, 'pls_bundled', 'while the rest of the file still applies')
    end)

    T.test('numeric settings survive the round trip', function()
      run.build({ resourceFiles = { ['settings.json'] = '{"tick_interval":25,"window":30000}' } })
      T.eq(Pulse.Config.tickIntervalMs, 25, 'read as a number')
      T.eq(Pulse.Config.windowMs, 30000, 'and so is the window')
    end)

    T.test('a broken settings.json does not stop the resource starting', function()
      run.build({ resourceFiles = { ['settings.json'] = '{ this is not json' } })
      T.eq(Pulse.Config.endpoint, 'http://127.0.0.1:8787/v1/ingest', 'falls back to the default')
      T.ok(Pulse.Config.windowMs > 0, 'and the rest of the config is intact')
    end)

    T.test('no settings.json at all is the normal case, not an error', function()
      run.build()
      T.eq(Pulse.Config.token, '', 'no token until one is configured')
      T.ok(Pulse.Config.tickIntervalMs > 0, 'defaults applied')
    end)

    T.test('every declared file exists', function()
      for _, path in ipairs(run.MANIFEST_ORDER) do
        local f = io.open(path, 'r')
        T.ok(f, path .. ' exists')
        if f then f:close() end
      end
    end)
  end)
end
