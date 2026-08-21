--[[ ==========================================================================
  EARTH SPIRIT  —  مغز اختصاصی میدلین
  ---------------------------------------------------------------------------
  اصول بازی حرفه‌ای ارث‌اسپریت که پیاده شده:
    * مدیریت شارژ سنگ‌ها (Stone Caller): همیشه سنگ آماده برای کمبو و فرار
    * هرس از فاصله‌ی امن: سنگ زیر پا + Boulder Smash به سمت حریف (استان)
    * کمبوی قفل: Stone -> Smash -> Rolling Boulder -> Magnetize -> Grip
    * Geomagnetic Grip برای سایلنس کردن کستر حریف
    * Rolling Boulder به‌عنوان ابزار فرار سریع
  ========================================================================== ]]

local Core = require(GetScriptDirectory() .. "/mid_ai_core")
local call, gcall = Core.call, Core.gcall
local dtime, unitDist, towards, dist2D = Core.dtime, Core.unitDist, Core.towards, Core.dist2D
local pct = Core.pct

local B = {}
B.name = "npc_dota_hero_earth_spirit"

B.levelOrder = {
  "earth_spirit_boulder_smash",     -- 1
  "earth_spirit_rolling_boulder",   -- 2
  "earth_spirit_boulder_smash",     -- 3
  "earth_spirit_geomagnetic_grip",  -- 4
  "earth_spirit_boulder_smash",     -- 5
  "earth_spirit_magnetize",         -- 6
  "earth_spirit_boulder_smash",     -- 7
  "earth_spirit_rolling_boulder",   -- 8
  "earth_spirit_rolling_boulder",   -- 9
  "TALENT",                         -- 10
  "earth_spirit_rolling_boulder",   -- 11
  "earth_spirit_magnetize",         -- 12
  "earth_spirit_geomagnetic_grip",  -- 13
  "earth_spirit_geomagnetic_grip",  -- 14
  "TALENT",                         -- 15
  "earth_spirit_geomagnetic_grip",  -- 16
  "earth_spirit_magnetize",         -- 18
  "TALENT", "TALENT",
}

B.items = {
  "item_magic_stick", "item_bottle", "item_boots", "item_bracer",
  "item_magic_wand", "item_phase_boots", "item_ultimate_scepter", "item_aghanims_shard",
  "item_black_king_bar", "item_shivas_guard", "item_octarine_core", "item_heart",
}

local lastStone, lastSmash = -100, -100

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
  return ((call(bot, "GetMana") or 0) - cost) >= maxMana * (reservePct or 0)
end

-- سنگ‌های خودمان
local function stones(bot)
  local out = {}
  local list = gcall(GetUnitList, UNIT_LIST_ALLIED_CREEPS) or {}
  for _, u in pairs(list) do
    local n = call(u, "GetUnitName") or ""
    if string.find(n, "stone", 1, true) ~= nil and call(u, "IsAlive") == true then
      out[#out + 1] = u
    end
  end
  return out
end

local function nearestStone(bot, maxDist)
  local best, bestD = nil, maxDist or 300
  for _, s in pairs(stones(bot)) do
    local d = unitDist(bot, s)
    if d <= bestD then best, bestD = s, d end
  end
  return best, bestD
end

local function stoneCharges(bot)
  local sc = ab(bot, "earth_spirit_stone_caller")
  if sc == nil then return 0 end
  return call(sc, "GetCurrentCharges") or 0
end

-- گذاشتن سنگ (زیر پا یا نقطه‌ی مشخص)
local function placeStone(bot, loc)
  local sc = ab(bot, "earth_spirit_stone_caller")
  if sc == nil then return false end
  if stoneCharges(bot) <= 0 then return false end
  if call(sc, "IsFullyCastable") ~= true then return false end
  if (dtime() - lastStone) < 0.6 then return false end
  if loc == nil then loc = call(bot, "GetLocation") end
  if loc == nil then return false end
  call(bot, "Action_UseAbilityOnLocation", sc, loc)
  lastStone = dtime()
  return true
end

-- شوت کردن سنگ به سمت یک نقطه (استان + دمیج)
local function smashToward(bot, loc, keepReserve)
  local sm = ab(bot, "earth_spirit_boulder_smash")
  if not ready(sm) or loc == nil then return false end
  if not manaOk(bot, sm, keepReserve or 0) then return false end
  if (dtime() - lastSmash) < 0.5 then return false end

  -- برای شوت باید یک سنگ/واحد نزدیک ما باشد
  local grabRange = call(sm, "GetSpecialValueInt", "grab_radius") or 200
  local s = nearestStone(bot, grabRange)
  if s == nil then
    if not placeStone(bot, call(bot, "GetLocation")) then return false end
    return true -- سنگ گذاشتیم؛ فریم بعد شوت می‌کنیم
  end
  call(bot, "Action_UseAbilityOnLocation", sm, loc)
  lastSmash = dtime()
  return true
end

-- ===========================================================================
-- هرس در لاین: سنگ زیر پا + شوت به سمت حریف (بدون ورود به برد کریپ‌ها)
-- ===========================================================================
function B.OnLaneHarass(bot, enemy, ctx)
  local eLoc = call(enemy, "GetLocation")
  if eLoc == nil then return false end
  local d = unitDist(bot, enemy)
  local sm = ab(bot, "earth_spirit_boulder_smash")
  local smashRange = 1300
  if sm ~= nil then
    smashRange = call(sm, "GetSpecialValueInt", "smash_distance") or 1300
  end

  if d <= smashRange and d > 150 then
    local target = Core.predictLoc(enemy, 0.35)
    if smashToward(bot, target, 0.25) then return true end
  end

  -- Grip برای سایلنس کردن حریفی که می‌خواهد کست کند
  local grip = ab(bot, "earth_spirit_geomagnetic_grip")
  if ready(grip) and manaOk(bot, grip, 0.35) and call(enemy, "IsCastingAbility") == true then
    local s = nearestStone(bot, call(grip, "GetCastRange") or 1000)
    if s ~= nil then
      call(bot, "Action_UseAbilityOnEntity", grip, s)
      return true
    end
  end
  return false
end

-- ===========================================================================
-- کمک به لست‌هیت با Boulder Smash
-- ===========================================================================
function B.OnFarmAssist(bot, creep, isDeny)
  local sm = ab(bot, "earth_spirit_boulder_smash")
  if not ready(sm) then return false end
  if not manaOk(bot, sm, 0.45) then return false end
  local dmg = call(sm, "GetAbilityDamage") or 0
  if dmg <= 0 then return false end
  local real = call(creep, "GetActualIncomingDamage", dmg, DAMAGE_TYPE_MAGICAL) or dmg * 0.75
  if real < (call(creep, "GetHealth") or 0) then return false end
  local cLoc = call(creep, "GetLocation")
  if cLoc == nil then return false end
  if unitDist(bot, creep) > 900 then return false end
  return smashToward(bot, cLoc, 0.45)
end

-- ===========================================================================
-- کمبوی نبرد:  Stone -> Smash -> Roll -> Magnetize -> Grip
-- ===========================================================================
function B.OnCombat(bot, target, ctx)
  local tLoc = call(target, "GetLocation")
  if tLoc == nil then return false end
  local d = unitDist(bot, target)
  local killable = ctx ~= nil and ctx.kill == true
  local immune = call(target, "IsMagicImmune") == true

  if d <= 900 and Core.useOffensiveItems(bot, target) then return true end

  local mag  = ab(bot, "earth_spirit_magnetize")
  local roll = ab(bot, "earth_spirit_rolling_boulder")
  local grip = ab(bot, "earth_spirit_geomagnetic_grip")

  -- ۱) استان اولیه از فاصله
  if d > 300 and not immune then
    if smashToward(bot, Core.predictLoc(target, 0.4), 0.0) then return true end
  end

  -- ۲) رسیدن به هدف با Rolling Boulder (اگر سنگ در مسیر باشد، استان می‌دهد)
  if ready(roll) and d > 400 and d < 1400 and manaOk(bot, roll, 0.0) and killable then
    call(bot, "Action_UseAbilityOnLocation", roll, Core.predictLoc(target, 0.5))
    return true
  end

  -- ۳) Magnetize روی گروه دشمن
  if ready(mag) and manaOk(bot, mag, 0.0) and not immune then
    local radius = call(mag, "GetSpecialValueInt", "radius") or 375
    if d <= radius then
      local behavior = call(mag, "GetBehavior") or 0
      if Core.hasBehavior(behavior, ABILITY_BEHAVIOR_POINT or 0) then
        call(bot, "Action_UseAbilityOnLocation", mag, tLoc)
      else
        call(bot, "Action_UseAbility", mag)
      end
      return true
    end
  end

  -- ۴) پخش کردن Magnetize و استان مجدد با سنگ
  if call(target, "HasModifier", "modifier_earth_spirit_magnetize") == true then
    if smashToward(bot, tLoc, 0.0) then return true end
  end

  -- ۵) Grip برای کشیدن سنگ (سایلنس) روی هدف
  if ready(grip) and manaOk(bot, grip, 0.1) and not immune then
    local s = nearestStone(bot, call(grip, "GetCastRange") or 1000)
    if s ~= nil and unitDist(target, s) < 900 then
      call(bot, "Action_UseAbilityOnEntity", grip, s)
      return true
    end
  end

  if d <= (call(bot, "GetAttackRange") or 150) + 200 then
    Core.attackUnit(bot, target)
    return true
  end
  return false
end

-- ===========================================================================
-- فرار: Rolling Boulder به سمت خانه
-- ===========================================================================
function B.OnEscape(bot, ctx)
  local myLoc = call(bot, "GetLocation")
  local home = Core.homeLocation()
  if myLoc == nil or home == nil then return false end

  local roll = ab(bot, "earth_spirit_rolling_boulder")
  if ready(roll) and manaOk(bot, roll, 0.0) then
    local dest = towards(myLoc, home, 1200)
    if gcall(IsLocationPassable, dest) == false then dest = towards(myLoc, home, 700) end
    call(bot, "Action_UseAbilityOnLocation", roll, dest)
    return true
  end

  -- سنگ برای استان کردن تعقیب‌کننده
  local chaser = nil
  for _, e in pairs(Core.visibleEnemies(bot, 700)) do chaser = e end
  if chaser ~= nil then
    if smashToward(bot, call(chaser, "GetLocation"), 0.0) then return true end
  end
  return false
end

-- ===========================================================================
-- نگهداری شارژ سنگ‌ها
-- ===========================================================================
function B.OnTick(bot)
  if call(bot, "IsAlive") ~= true then return end
  if #Core.visibleEnemies(bot, 1200) > 0 then return end
  if stoneCharges(bot) >= 4 and #stones(bot) == 0 then
    -- یک سنگ ذخیره کنار خودمان برای واکنش سریع
    placeStone(bot, call(bot, "GetLocation"))
  end
end

return B
