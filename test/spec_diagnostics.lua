return function(T, run)
  T.suite('diagnostics: telling the operator what to change', function()
    run.build()

    T.test('every failure names the thing to fix', function()
      local cases = {
        { 200, true,  'token' },
        { 204, true,  nil },
        { 401, false, 'pulse_token' },
        { 403, false, 'pulse_token' },
        { 404, false, 'pulse_endpoint' },
        { 429, true,  'backs off and retries' },
        { 500, false, 'logs' },
        { 0,   false, 'Could not reach' },
      }
      for _, case in ipairs(cases) do
        local ok, message = Pulse.diagnose(case[1])
        T.eq(ok, case[2], ('status %d verdict'):format(case[1]))
        if case[3] then
          T.ok(message:find(case[3], 1, true),
            ('status %d says what to change (got "%s")'):format(case[1], message))
        end
      end
    end)

    T.test('a missing token is caught before a request is made', function()
      local sched, world = run.build({ convars = { pulse_token = '' } })
      local lines = {}
      -- Measured across the call itself: advancing the clock afterwards would
      -- also run the ordinary flush loop, whose requests are not the test's.
      local before = world.http.attempts
      Pulse.selfTest(function(l) lines[#lines + 1] = l end)
      T.eq(world.http.attempts, before, 'the self test sent nothing')
      T.ok(table.concat(lines, '\n'):find('not set', 1, true), 'and it says why')
    end)

    T.test('a reachable backend reports PASS', function()
      local sched, world = run.build({ convars = { pulse_token = 'pls_test' } })
      local lines = {}
      Pulse.selfTest(function(l) lines[#lines + 1] = l end)
      sched:run(60000)
      local out = table.concat(lines, '\n')
      T.gt(world.http.attempts, 0, 'a request was made')
      T.ok(out:find('PASS', 1, true), 'reported as passing')
    end)

    T.test('an unreachable backend says so, rather than staying silent', function()
      local sched, world = run.build({ convars = { pulse_token = 'pls_test' } })
      world.http.failUntilMs = 10 * 3600 * 1000
      local lines = {}
      Pulse.selfTest(function(l) lines[#lines + 1] = l end)
      sched:run(60000)
      local out = table.concat(lines, '\n')
      T.ok(out:find('FAILED', 1, true), 'reported as failing')
      T.ok(out:find('Could not reach', 1, true), 'with the reachability diagnosis')
    end)

    T.test('a rejected token is distinguished from an unreachable backend', function()
      local sched, world = run.build({ convars = { pulse_token = 'pls_wrong' } })
      world.http.forceStatus = 401
      local lines = {}
      Pulse.selfTest(function(l) lines[#lines + 1] = l end)
      sched:run(60000)
      T.ok(table.concat(lines, '\n'):find('pulse_token', 1, true),
        'points at the token, not the network')
    end)

    T.test('the endpoint and token are echoed, with the token truncated', function()
      local sched, world = run.build({
        convars = { pulse_token = 'pls_abcdefghijklmnop', pulse_endpoint = 'http://box:8787/v1/ingest' },
      })
      local lines = {}
      Pulse.selfTest(function(l) lines[#lines + 1] = l end)
      sched:run(60000)
      local out = table.concat(lines, '\n')
      T.ok(out:find('http://box:8787/v1/ingest', 1, true), 'endpoint shown, so a typo is visible')
      T.ok(out:find('pls_abcd...', 1, true), 'token identifiable but not printed in full')
      T.ok(not out:find('ijklmnop', 1, true), 'the rest of the token stays out of the console')
    end)
  end)

  T.suite('diagnostics: the status command', function()
    T.test('"pulse" prints without a backend ever having answered', function()
      local sched, world = run.build()
      local lines = {}
      local realPrint = print
      _G.print = function(l) lines[#lines + 1] = tostring(l) end
      local found = world.runCommand('pulse', {})
      _G.print = realPrint
      T.ok(found, 'the command is registered')
      T.gt(#lines, 0, 'it says something')
      T.ok(table.concat(lines, '\n'):find('pulse test', 1, true),
        'and points at the next thing to try')
    end)

    T.test('"pulse test" routes to the self test', function()
      local sched, world = run.build({ convars = { pulse_token = 'pls_test' } })
      local lines = {}
      local realPrint = print
      _G.print = function(l) lines[#lines + 1] = tostring(l) end
      world.runCommand('pulse', { 'test' })
      sched:run(60000)
      _G.print = realPrint
      T.ok(table.concat(lines, '\n'):find('sending a test batch', 1, true), 'it ran the test')
    end)
  end)
end
