return function(T, run)
  local HOUR = run.MS_PER_HOUR

  T.suite('shipper: survives a backend that is down', function()
    T.test('an unreachable backend costs samples, never memory', function()
      local sched, world, pulse = run.build({
        convars = { pulse_flush_interval = '5000', pulse_buffer_size = '120' },
      })
      world.http.failUntilMs = 3 * HOUR
      sched:run(2 * HOUR)

      local st = pulse.state
      T.eq(#world.http.delivered, 0, 'nothing delivered while down')
      T.gt(world.http.attempts, 0, 'it did keep trying')
      T.lte(st.buffer:size(), 120, 'buffer stayed within its capacity')
      T.gt(st.buffer.dropped, 0, 'overflow was shed and counted')
      T.gt(st.shipper.failures, 0, 'failures recorded')
    end)

    T.test('backoff widens instead of hammering the endpoint', function()
      local sched, world, pulse = run.build({ convars = { pulse_flush_interval = '5000' } })
      world.http.failUntilMs = 6 * HOUR
      sched:run(4 * HOUR)
      -- Four hours at a five-second flush would be ~2880 attempts without
      -- backoff; the cap is five minutes, so a couple of dozen is the ceiling.
      T.lte(world.http.attempts, 60, 'attempt count stays bounded')
      T.gt(pulse.state.shipper:backoffMs(), 60000, 'backoff grew past a minute')
    end)

    T.test('recovers and drains once the backend returns', function()
      local sched, world, pulse = run.build({ convars = { pulse_flush_interval = '5000' } })
      world.http.failUntilMs = 1 * HOUR
      sched:run(1 * HOUR)
      T.eq(#world.http.delivered, 0, 'still down')

      sched:run(3 * HOUR)
      T.gt(#world.http.delivered, 0, 'delivery resumed')
      T.eq(pulse.state.shipper.failures, 0, 'failure streak cleared')
      T.gt(pulse.state.shipper.samplesSent, 0, 'samples got through')
    end)

    T.test('being told to slow down is temporary, not fatal', function()
      -- A 429 used to take the 4xx path: the batch was thrown away, the failure
      -- streak reset, and the console reported the last send as fine.
      local sched, world, pulse = run.build({ convars = { pulse_flush_interval = '5000' } })
      world.http.forceStatus = 429
      sched:run(2 * HOUR)
      T.gt(pulse.state.shipper.failures, 0, 'counted as a failure')
      T.gt(pulse.state.shipper:backoffMs(), 5000, 'and backed off')
      T.eq(pulse.state.buffer.dropped, 0, 'nothing thrown away for a temporary refusal')
      T.gt(pulse.state.buffer:size(), 0, 'the windows are still queued')
    end)

    T.test('a permanently rejected batch is counted as lost, not lost silently', function()
      local sched, world, pulse = run.build({
        convars = { pulse_flush_interval = '5000', pulse_buffer_size = '5000' } })
      world.http.forceStatus = 400
      sched:run(2 * HOUR)
      T.gt(pulse.state.buffer.dropped, 0, 'the loss is visible in the dropped counter')
    end)

    T.test('a rejected payload is dropped, not retried forever', function()
      local sched, world, pulse = run.build({ convars = { pulse_flush_interval = '5000' } })
      world.http.forceStatus = 401
      sched:run(2 * HOUR)
      -- A bad token must not wedge the queue behind an unacceptable batch.
      T.eq(pulse.state.shipper.failures, 0, '4xx is not treated as retryable')
      T.eq(pulse.state.shipper.lastStatus, 401, 'status surfaced for the operator')
      T.lte(pulse.state.buffer:size(), Pulse.Config.bufferSize, 'queue still bounded')
    end)
  end)
end
