--[[ ==========================================================================
  PUCK  —  مغز اختصاصی میدلین
  ---------------------------------------------------------------------------
  اصول بازی حرفه‌ای پاک که پیاده شده:
    * Phase Shift به‌عنوان ابزار «دژ»: دوج کردن پرتابه‌ها، استان‌ها، ضربه‌ی تاور
      و صبر کردن تا خنک شدن کول‌داون‌ها (تشخیص خودکار پرتابه‌ی در حال پرواز)
    * Illusory Orb + Ethereal Jaunt: هم فرار، هم شروع کمبو، هم لست‌هیت از دور
    * Waning Rift برای سایلنس کردن تعقیب‌کننده یا قفل کمبو
    * Dream Coil فقط وقتی حریف قابل نگه‌داشتن و کشتن است
  ========================================================================== ]]

local Core = require(GetScriptDirectory() .. "/mid_ai_core")
local call, gcall = Core.call, Core.gcall
local dtime, unitDist, towards, dist2D = Core.dtime, Core.unitDist, Core.towards, Core.dist2D
local pct = Core.pct

local B = {}
B.name = "npc_dota_hero_puck"

B.levelOrder = {
  "puck_illusory_orb",  -- 1
  "puck_phase_shift",   -- 2
  "puck_illusory_orb",  -- 3
  "puck_waning_rift",   -- 4
  "puck_illusory_orb",  -- 5
  "puck_dream_coil",    -- 6
  "puck_illusory_orb",  -- 7
  "puck_waning_rift",   -- 8
  "puck_waning_rift",   -- 9
  "TALENT",             -- 10
  "puck_waning_rift",   -- 11
  "puck_dream_coil",    -- 12
  "puck_phase_shift",   -- 13
  "puck_phase_shift",   -- 14
  "TALENT",             -- 15
  "puck_phase_shift",   -- 16
  "puck_dream_coil",    -- 18
  "TALENT", "TALENT",
}

B.items = {
  "item_magic_stick", "item_bottle", "item_boots", "item_null_talisman",
  "item_magic_wand", "item_power_treads", "item_blink", "item_ultimate_scepter",
  "item_aghanims_shard", "item_octarine_core", "item_shivas_guard", "item_sheepstick",
}

local orbCastAt, orbDest, orbIntent = -100, nil, nil

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

local function orbSpeed(bot)
  local a = ab(bot, "puck_illusory_orb")
  local s = call(a, "GetSpecialValueInt", "orb_speed")
  if s == nil or s <= 0 then return 700 end
  return s
end

-- ===========================================================================
-- تشخیص خطر لحظه‌ای برای Phase Shift
-- ===========================================================================
local function incomingProjectileThreat(bot)
  local list = call(bot, "GetIncomingTrackingProjectiles")
  if list == nil then return false end
  local myLoc = call(bot, "GetLocation")
  if myLoc == nil then return false end
  for _, p in pairs(list) do
    if type(p) == "table" and p.location ~= nil then
      local speed = p.move_speed or p.speed or 900
      local eta = dist2D(p.location, myLoc) / math.max(speed, 100)
      local dodgeable = (p.is_dodgeable ~= false)
      if dodgeable and eta < 0.5 then
        if p.is_attack ~= true then return true end       -- اسکیل => حتما دوج
        local hp = call(bot, "GetHealth") or 1
        local maxHp = call(bot, "GetMaxHealth") or 1
        if pct(hp, maxHp) < 0.5 then return true end      -- ضربه در وضعیت کم‌جان
      end
    end
  end
  return false
end

local function towerShootingMe(bot)
  local towers = call(bot, "GetNearbyTowers", 900, true) or {}
  for _, t in pairs(towers) do
    if call(t, "GetAttackTarget") == bot then return true end
  end
  return false
end

local function tryPhaseShift(bot)
  local ps = ab(bot, "puck_phase_shift")
  if not ready(ps) then return false end
  if call(bot, "IsChanneling") == true then return false end
  local hp = call(bot, "GetHealth") or 1
  local maxHp = call(bot, "GetMaxHealth") or 1
  local hpP = pct(hp, maxHp)

  local danger = incomingProjectileThreat(bot)
  if not danger and towerShootingMe(bot) and hpP < 0.75 then danger = true end
  if not danger and hpP < 0.3 and #Core.visibleEnemies(bot, 600) >= 1
     and Core.threatLevel(bot, 1.5) > hp * 0.8 then
    danger = true
  end
  if not danger then return false end
  call(bot, "Action_UseAbility", ps)
  return true
end

-- ===========================================================================
-- Illusory Orb + Ethereal Jaunt
-- ===========================================================================
local function castOrb(bot, dest, intent)
  local orb = ab(bot, "puck_illusory_orb")
  if not ready(orb) or dest == nil then return false end
  call(bot, "Action_UseAbilityOnLocation", orb, dest)
  orbCastAt, orbDest, orbIntent = dtime(), dest, intent
  return true
end

local function tryJaunt(bot, minTravel)
  local j = ab(bot, "puck_ethereal_jaunt")
  if j == nil then return false end
  if (call(j, "GetLevel") or 0) <= 0 then
    -- Jaunt همیشه همراه Orb است؛ اگر لِوِل نداشت هم تلاش می‌کنیم
    if call(j, "IsFullyCastable") ~= true then return false end
  end
  if call(j, "IsHidden") == true then return false end
  if call(j, "IsFullyCastable") ~= true then return false end
  local traveled = (dtime() - orbCastAt) * orbSpeed(bot)
  if traveled < (minTravel or 500) then return false end
  call(bot, "Action_UseAbility", j)
  orbIntent = nil
  return true
end

-- ===========================================================================
-- هرس در لاین
-- ===========================================================================
function B.OnLaneHarass(bot, enemy, ctx)
  if tryPhaseShift(bot) then return true end

  local orb = ab(bot, "puck_illusory_orb")
  local rift = ab(bot, "puck_waning_rift")
  local d = unitDist(bot, enemy)
  local eLoc = call(enemy, "GetLocation")
  if eLoc == nil then return false end

  -- Orb از فاصله‌ی امن (هم دمیج، هم امکان فرار)
  if ready(orb) and manaOk(bot, orb, 0.3) and d > 350 and d < 1300 then
    local myLoc = call(bot, "GetLocation")
    local dest = towards(myLoc, eLoc, math.min(d + 250, 1400))
    return castOrb(bot, dest, "harass")
  end

  -- Rift وقتی حریف چسبیده است
  if ready(rift) and manaOk(bot, rift, 0.35) then
    local r = call(rift, "GetSpecialValueInt", "radius") or 400
    if d <= r - 30 and call(enemy, "IsMagicImmune") ~= true then
      local behavior = call(rift, "GetBehavior") or 0
      if Core.hasBehavior(behavior, ABILITY_BEHAVIOR_POINT or 0) then
        call(bot, "Action_UseAbilityOnLocation", rift, eLoc)
      else
        call(bot, "Action_UseAbility", rift)
      end
      return true
    end
  end
  return false
end

-- ===========================================================================
-- کمک به لست‌هیت با Illusory Orb (کریپ‌های مسیر را می‌زند)
-- ===========================================================================
function B.OnFarmAssist(bot, creep, isDeny)
  local orb = ab(bot, "puck_illusory_orb")
  if not ready(orb) then return false end
  if not manaOk(bot, orb, 0.45) then return false end

  local dmg = call(orb, "GetAbilityDamage") or 0
  local real = call(creep, "GetActualIncomingDamage", dmg, DAMAGE_TYPE_MAGICAL) or dmg * 0.75
  local hp = call(creep, "GetHealth") or 0
  if real < hp then return false end

  local myLoc = call(bot, "GetLocation")
  local cLoc = call(creep, "GetLocation")
  if myLoc == nil or cLoc == nil then return false end
  local d = dist2D(myLoc, cLoc)
  if d > 1200 then return false end
  return castOrb(bot, towards(myLoc, cLoc, math.min(d + 200, 1400)), "farm")
end

-- ===========================================================================
-- کمبوی نبرد:  Orb -> Jaunt -> Rift -> Dream Coil
-- ===========================================================================
function B.OnCombat(bot, target, ctx)
  if tryPhaseShift(bot) then return true end

  local d = unitDist(bot, target)
  local tLoc = call(target, "GetLocation")
  if tLoc == nil then return false end
  local orb  = ab(bot, "puck_illusory_orb")
  local rift = ab(bot, "puck_waning_rift")
  local coil = ab(bot, "puck_dream_coil")
  local killable = ctx ~= nil and ctx.kill == true

  if d <= 900 and Core.useOffensiveItems(bot, target) then return true end

  -- اگر اُرب در پرواز است و به هدف رسیده، جانت کن
  if orbIntent == "engage" and tryJaunt(bot, math.max(d - 250, 300)) then return true end

  -- Dream Coil برای نگه داشتن (تیم‌فایت یا کیل تضمینی)
  if ready(coil) and manaOk(bot, coil, 0.05) then
    local range = call(coil, "GetCastRange") or 750
    local groupped = #Core.visibleEnemies(bot, 700) >= 2
    if d <= range and (groupped or killable) then
      call(bot, "Action_UseAbilityOnLocation", coil, Core.predictLoc(target, 0.3))
      return true
    end
  end

  -- ورود با Orb
  if d > 600 and d < 1300 and ready(orb) and manaOk(bot, orb, 0.1) and killable then
    local myLoc = call(bot, "GetLocation")
    if castOrb(bot, towards(myLoc, tLoc, d), "engage") then return true end
  end

  -- Rift نزدیک
  if ready(rift) and manaOk(bot, rift, 0.05) then
    local r = call(rift, "GetSpecialValueInt", "radius") or 400
    if d <= r - 30 and call(target, "IsMagicImmune") ~= true then
      local behavior = call(rift, "GetBehavior") or 0
      if Core.hasBehavior(behavior, ABILITY_BEHAVIOR_POINT or 0) then
        call(bot, "Action_UseAbilityOnLocation", rift, tLoc)
      else
        call(bot, "Action_UseAbility", rift)
      end
      return true
    end
  end

  if d <= (call(bot, "GetAttackRange") or 400) + 200 then
    Core.attackUnit(bot, target)
    return true
  end
  return false
end

-- ===========================================================================
-- فرار: Phase Shift -> Orb به سمت خانه -> Jaunt -> Rift برای سایلنس
-- ===========================================================================
function B.OnEscape(bot, ctx)
  local myLoc = call(bot, "GetLocation")
  local home = Core.homeLocation()
  if myLoc == nil or home == nil then return false end

  -- اگر اُرب در پرواز است، بپر
  if orbIntent == "escape" and tryJaunt(bot, 700) then return true end

  local orb = ab(bot, "puck_illusory_orb")
  if ready(orb) then
    local dest = towards(myLoc, home, 1400)
    if gcall(IsLocationPassable, dest) == false then dest = towards(myLoc, home, 900) end
    if castOrb(bot, dest, "escape") then return true end
  end

  -- سایلنس کردن تعقیب‌کننده
  local rift = ab(bot, "puck_waning_rift")
  if ready(rift) then
    local r = call(rift, "GetSpecialValueInt", "radius") or 400
    local chaser = nil
    for _, e in pairs(Core.visibleEnemies(bot, r)) do chaser = e end
    if chaser ~= nil then
      local behavior = call(rift, "GetBehavior") or 0
      if Core.hasBehavior(behavior, ABILITY_BEHAVIOR_POINT or 0) then
        call(bot, "Action_UseAbilityOnLocation", rift, call(chaser, "GetLocation"))
      else
        call(bot, "Action_UseAbility", rift)
      end
      return true
    end
  end

  if tryPhaseShift(bot) then return true end
  return false
end

-- Phase Shift دفاعی، حتی خارج از حالت فرار
function B.OnTick(bot)
  if call(bot, "IsAlive") ~= true then return end
  if orbIntent ~= nil and (dtime() - orbCastAt) > 3.0 then orbIntent = nil end
end

return B
