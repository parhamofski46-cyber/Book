return function(T, run)
  T.suite('buffer: bounded, never grows', function()
    run.build()  -- installs the environment and loads collector modules
    local Buffer = Pulse.Buffer

    T.test('drops oldest once full and counts the loss', function()
      local b = Buffer.new(3)
      for i = 1, 5 do b:push(i) end
      T.eq(b:size(), 3, 'size capped')
      T.eq(b.dropped, 2, 'drops counted')
      local out = b:drain(10)
      T.eq(out[1], 3, 'oldest survivor is 3')
      T.eq(out[3], 5, 'newest is 5')
    end)

    T.test('drain takes at most the requested count, oldest first', function()
      local b = Buffer.new(10)
      for i = 1, 6 do b:push(i) end
      local out = b:drain(2)
      T.eq(#out, 2, 'batch size honoured')
      T.eq(out[1], 1, 'FIFO')
      T.eq(b:size(), 4, 'remainder left in place')
    end)

    T.test('requeue restores order at the front', function()
      local b = Buffer.new(10)
      for i = 1, 4 do b:push(i) end
      local batch = b:drain(2)
      b:requeue(batch)
      T.eq(b:size(), 4, 'nothing lost')
      local out = b:drain(4)
      T.eq(out[1], 1, 'requeued batch is first again')
      T.eq(out[4], 4, 'tail intact')
    end)

    T.test('requeue past capacity sheds the newest, not memory', function()
      local b = Buffer.new(4)
      for i = 1, 4 do b:push(i) end
      b:requeue({ -1, -2 })
      T.eq(b:size(), 4, 'still capped after requeue')
      T.eq(b.dropped, 2, 'overflow counted')
      local out = b:drain(4)
      T.eq(out[1], -1, 'retried batch kept')
    end)
  end)
end
