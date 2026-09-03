-- Assertions, kept deliberately small.
local T = { suites = {}, current = nil, passed = 0, failed = 0, failures = {} }

function T.suite(name, fn)
  T.current = name
  print(('\n%s'):format(name))
  fn()
end

function T.test(name, fn)
  local ok, err = pcall(fn)
  if ok then
    T.passed = T.passed + 1
    print(('  pass  %s'):format(name))
  else
    T.failed = T.failed + 1
    T.failures[#T.failures + 1] = ('%s / %s: %s'):format(T.current, name, tostring(err))
    print(('  FAIL  %s\n        %s'):format(name, tostring(err)))
  end
end

local function fail(msg) error(msg, 3) end

function T.ok(cond, msg) if not cond then fail(msg or 'expected truthy') end end
function T.eq(a, b, msg)
  if a ~= b then fail(('%s (got %s, want %s)'):format(msg or 'not equal', tostring(a), tostring(b))) end
end
function T.gt(a, b, msg)
  if not (a > b) then fail(('%s (got %s, want > %s)'):format(msg or 'not greater', tostring(a), tostring(b))) end
end
function T.gte(a, b, msg)
  if not (a >= b) then fail(('%s (got %s, want >= %s)'):format(msg or 'not >=', tostring(a), tostring(b))) end
end
function T.lte(a, b, msg)
  if not (a <= b) then fail(('%s (got %s, want <= %s)'):format(msg or 'not <=', tostring(a), tostring(b))) end
end
function T.within(value, lo, hi, msg)
  if value < lo or value > hi then
    fail(('%s (got %s, want %s..%s)'):format(msg or 'out of range', tostring(value), tostring(lo), tostring(hi)))
  end
end

function T.report()
  print(('\n%d passed, %d failed'):format(T.passed, T.failed))
  for _, f in ipairs(T.failures) do print('  ' .. f) end
  return T.failed == 0
end

return T
