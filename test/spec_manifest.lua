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

    T.test('every declared file exists', function()
      for _, path in ipairs(run.MANIFEST_ORDER) do
        local f = io.open(path, 'r')
        T.ok(f, path .. ' exists')
        if f then f:close() end
      end
    end)
  end)
end
