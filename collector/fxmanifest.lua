fx_version 'cerulean'
game 'gta5'

name 'pulse_collector'
description 'Continuous performance telemetry for FiveM servers: main-thread stall detection with history.'
version '0.1.0'
license 'MIT'

-- Load order matters: config first, then leaf modules, then main, which wires
-- them together and starts the loops. test/spec_manifest.lua asserts this list
-- stays in step with the simulator's load order.
server_scripts {
  'config.lua',
  'server/budget.lua',
  'server/buffer.lua',
  'server/hitch.lua',
  'server/inventory.lua',
  'server/shipper.lua',
  'server/main.lua',
}
