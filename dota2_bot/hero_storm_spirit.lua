-- ورودی بازی برای storm_spirit
-- این فایل را در پوشه‌ی bots بگذارید؛ بازی خودش آن را برای این هیرو صدا می‌زند.
local Core  = require( GetScriptDirectory() .. "/mid_ai_core" )
local Brain = require( GetScriptDirectory() .. "/heroes/storm_spirit" )

function Think()
  Core.Think( GetBot(), Brain )
end
