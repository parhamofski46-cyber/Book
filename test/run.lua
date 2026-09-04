-- Test entry point. Run from the repository root:  lua5.4 test/run.lua
local T = dofile('test/harness.lua')
local run = dofile('sim/run.lua')

for _, spec in ipairs({ 'spec_manifest', 'spec_buffer', 'spec_hitch', 'spec_shipper', 'spec_diagnostics', 'spec_detection' }) do
  dofile('test/' .. spec .. '.lua')(T, run)
end

os.exit(T.report() and 0 or 1)
