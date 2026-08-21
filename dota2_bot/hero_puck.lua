-- ورودی بازی برای puck
-- این فایل را در پوشه‌ی bots بگذارید؛ بازی خودش آن را برای این هیرو صدا می‌زند.
local Core  = require( GetScriptDirectory() .. "/mid_ai_core" )
local Brain = require( GetScriptDirectory() .. "/heroes/puck" )

function Think()
  Core.Think( GetBot(), Brain )
end
