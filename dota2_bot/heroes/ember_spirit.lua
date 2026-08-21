--[[ ==========================================================================
  EMBER SPIRIT  —  مغز اختصاصی میدلین
  ---------------------------------------------------------------------------
  اصول بازی حرفه‌ای امبر که پیاده شده:
    * Sleight of Fist بهترین ابزار «هرس بدون ریسک» و گرفتن چند لست‌هیت هم‌زمان
      (در طول اجرا امبر غیرقابل هدف است)
    * Flame Guard قبل از هر ترید (سپر جادویی + دمیج سوزاننده)
    * Searing Chains برای قفل کردن هدف و بعد Sleight of Fist
    * Fire Remnant: همیشه یک رمننت «عقب» برای فرار و یکی «جلو» برای تعقیب
  ========================================================================== ]]

local Core = require(GetScriptDirectory() .. "/mid_ai_core")
local call, gcall = Core.call, Core.gcall
local dtime, unitDist, towards, dist2D = Core.dtime, Core.unitDist, Core.towards, Core.dist2D
local pct = Core.pct

local B = {}
B.name = "npc_dota_hero_ember_spirit"

B.levelOrder = {
  "ember_spirit_sleight_of_fist",  -- 1
  "ember_spirit_flame_guard",      -- 2
  "ember_spirit_sleight_of_fist",  -- 3
  "ember_spirit_searing_chains",   -- 4
  "ember_spirit_sleight_of_fist",  -- 5
  "ember_spirit_fire_remnant",     -- 6
  "ember_spirit_sleight_of_fist",  -- 7
  "ember_spirit_flame_guard",      -- 8
  "ember_spirit_flame_guard",      -- 9
  "TALENT",                        -- 10
  "ember_spirit_flame_guard",      -- 11
  "ember_spirit_fire_remnant",     -- 12
  "ember_spirit_searing_chains",   -- 13
  "ember_spirit_searing_chains",   -- 14
  "TALENT",                        -- 15
  "ember_spirit_searing_chains",   -- 16
  "ember_spirit_fire_remnant",     -- 18
  "TALENT", "TALENT",
}

B.items = {
  "item_magic_stick", "item_bottle", "item_boots", "item_wraith_band",
  "item_magic_wand", "item_phase_boots", "item_maelstrom", "item_kaya_and_sange",
  "item_black_king_bar", "item_gungir", "item_refresher", "item_greater_crit",
}

local REMNANT_NAME = "npc_dota_ember_spirit_remnant"
local lastRemnantPlace = -100

local function ab(bot, n) return call(bot, "GetAbilityByName", n) end

local function ready(a)
  if a == nil then return false end
  if (call(a, "GetLevel") or 0) <= 0 then return false end
  if call(a, "IsFullyCastable") ~= true then return false end
  if (call(a, "GetCooldownTimeRemaining") or 99) > 0 then return false end
  return true
end

local function manaOk(bot, a, reservePct)
  if a == nil then return false end
  local cost = call(a, "GetManaCost") or 0
  local maxMana = call(bot, "GetMaxMana") or 1
  return ((call(bot, "GetMana") or 0) - cost) >= maxMana * (reservePct or 0.0)
end

-- پیدا کردن رمننت‌های خودمان
local function remnants(bot)
  local out = {}
  local list = gcall(GetUnitList, UNIT_LIST_ALLIED_CREEPS) or {}
  for _, u in pairs(list) do
    local n = call(u, "GetUnitName") or ""
    if string.find(n, "remnant", 1, true) ~= nil and call(u, "IsAlive") == true then
      out[#out + 1] = u
    end
  end
  return out
end

-- فعال‌سازی رمننت (تعقیب یا فرار)
local function activateRemnant(bot, preferLoc, maxRange)
  local act = ab(bot, "ember_spirit_activate_fire_remnant")
  if not ready(act) then return false end
  local best, bestD = nil, 99999
  for _, r in pairs(remnants(bot)) do
    local rl = call(r, "GetLocation")
    if rl ~= nil and unitDist(bot, r) <= (maxRange or 1800) then
      local d = dist2D(rl, preferLoc)
      if d < bestD then best, bestD = r, d end
    end
  end
  if best == nil then return false end
  call(bot, "Action_UseAbilityOnEntity", act, best)
  return true
end

local function placeRemnant(bot, loc)
  local fr = ab(bot, "ember_spirit_fire_remnant")
  if not ready(fr) then return false end
  if (dtime() - lastRemnantPlace) < 1.2 then return false end
  if loc == nil then return false end
  call(bot, "Action_UseAbilityOnLocation", fr, loc)
  lastRemnantPlace = dtime()
  return true
end

local function flameGuardActive(bot)
  return call(bot, "HasModifier", "modifier_ember_spirit_flame_guard") == true
end

local function sofRadius(bot)
  local a = ab(bot, "ember_spirit_sleight_of_fist")
  local r = call(a, "GetSpecialValueInt", "radius")
  if r == nil or r <= 0 then return 400 end
  return r
end

-- ===========================================================================
-- هرس در لاین (بدون خوردن ارگ کریپ و بدون ریسک)
-- ===========================================================================
function B.OnLaneHarass(bot, enemy, ctx)
  local sof = ab(bot, "ember_spirit_sleight_of_fist")
  local fg  = ab(bot, "ember_spirit_flame_guard")
  local d = unitDist(bot, enemy)

  -- سپر قبل از ترید
  if ready(fg) and not flameGuardActive(bot) and d < 500 and manaOk(bot, fg, 0.25) then
    call(bot, "Action_UseAbility", fg)
    return true
  end

  if ready(sof) and manaOk(bot, sof, 0.15) then
    local range = call(sof, "GetCastRange") or 700
    if d <= range then
      local loc = call(enemy, "GetLocation")
      if loc ~= nil then
        call(bot, "Action_UseAbilityOnLocation", sof, loc)
        return true
      end
    end
  end
  return false
end

-- ===========================================================================
-- Sleight of Fist برای گرفتن لست‌هیت‌هایی که با ضربه از دست می‌روند
-- ===========================================================================
function B.OnFarmAssist(bot, creep, isDeny)
  local sof = ab(bot, "ember_spirit_sleight_of_fist")
  if not ready(sof) then return false end
  if not manaOk(bot, sof, 0.35) then return false end
  if isDeny then return false end -- Sleight of Fist روی کریپ خودی کار نمی‌کند

  local range = call(sof, "GetCastRange") or 700
  local d = unitDist(bot, creep)
  if d > range then return false end

  -- Sleight of Fist دمیج ضربه‌ی معمولی می‌زند => همان محاسبه‌ی لست‌هیت
  local lo = select(1, Core.damageWindow(bot, creep))
  local hp = call(creep, "GetHealth") or 0
  if hp > lo then return false end

  local loc = call(creep, "GetLocation")
  if loc == nil then return false end
  call(bot, "Action_UseAbilityOnLocation", sof, loc)
  return true
end

-- ===========================================================================
-- کمبوی نبرد:  Remnant -> Flame Guard -> Searing Chains -> Sleight of Fist
-- ===========================================================================
function B.OnCombat(bot, target, ctx)
  local d = unitDist(bot, target)
  local tLoc = call(target, "GetLocation")
  if tLoc == nil then return false end

  local fg    = ab(bot, "ember_spirit_flame_guard")
  local chain = ab(bot, "ember_spirit_searing_chains")
  local sof   = ab(bot, "ember_spirit_sleight_of_fist")

  if d <= 900 and Core.useOffensiveItems(bot, target) then return true end

  -- سپر
  if ready(fg) and not flameGuardActive(bot) and d < 700 and manaOk(bot, fg, 0.1) then
    call(bot, "Action_UseAbility", fg)
    return true
  end

  -- نزدیک شدن با رمننت (تعقیب)
  if d > 600 and d < 1700 then
    if activateRemnant(bot, tLoc, 1800) then return true end
    if ctx ~= nil and ctx.kill and placeRemnant(bot, tLoc) then return true end
  end

  -- قفل کردن هدف
  local chainRadius = call(chain, "GetSpecialValueInt", "radius") or 400
  if ready(chain) and d <= chainRadius - 20 and call(target, "IsMagicImmune") ~= true then
    call(bot, "Action_UseAbility", chain)
    return true
  end

  -- دمیج اصلی
  if ready(sof) and d <= (call(sof, "GetCastRange") or 700) then
    call(bot, "Action_UseAbilityOnLocation", sof, tLoc)
    return true
  end

  if d <= (call(bot, "GetAttackRange") or 150) + 200 then
    Core.attackUnit(bot, target)
    return true
  end
  return false
end

-- ===========================================================================
-- فرار: رمننتِ عقب را فعال کن، وگرنه یکی به سمت خانه بگذار
-- ===========================================================================
function B.OnEscape(bot, ctx)
  local home = Core.homeLocation()
  local myLoc = call(bot, "GetLocation")
  if home == nil or myLoc == nil then return false end

  if activateRemnant(bot, home, 1800) then return true end

  local fg = ab(bot, "ember_spirit_flame_guard")
  if ready(fg) and not flameGuardActive(bot) and manaOk(bot, fg, 0.0) then
    call(bot, "Action_UseAbility", fg)
    return true
  end

  local dest = towards(myLoc, home, 1100)
  if gcall(IsLocationPassable, dest) == false then dest = towards(myLoc, home, 700) end
  if placeRemnant(bot, dest) then return true end
  return false
end

-- ===========================================================================
-- نگهداری: همیشه یک رمننت پشت سر داشته باش (بیمه‌ی جان)
-- ===========================================================================
function B.OnTick(bot)
  if call(bot, "IsAlive") ~= true then return end
  local fr = ab(bot, "ember_spirit_fire_remnant")
  if not ready(fr) then return end
  local charges = call(fr, "GetCurrentCharges") or 0
  if charges < 2 then return end
  if #remnants(bot) > 0 then return end
  if #Core.visibleEnemies(bot, 900) > 0 then return end

  local myLoc = call(bot, "GetLocation")
  local home = Core.homeLocation()
  if myLoc == nil or home == nil then return end
  if dist2D(myLoc, home) < 900 then return end
  placeRemnant(bot, towards(myLoc, home, 900))
end

return B
