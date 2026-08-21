--[[ ==========================================================================
  STORM SPIRIT  —  مغز اختصاصی میدلین
  ---------------------------------------------------------------------------
  اصول بازی حرفه‌ای استورم که در این فایل پیاده شده:
    * Overload: بعد از هر اسکیل، ضربه‌ی بعدی دمیج جادویی + اسلو می‌دهد
      => الگوی هرس: Static Remnant روی حریف + ضربه (Overload)
    * مدیریت مانا: همیشه به اندازه‌ی یک Ball Lightning فرار مانا نگه می‌داریم
    * Ball Lightning: محاسبه‌ی دقیق هزینه‌ی مانا بر اساس فاصله
    * فارم امن با Static Remnant و کیل‌کمبوی Zip -> Remnant -> Vortex -> Attack
  ========================================================================== ]]

local Core = require(GetScriptDirectory() .. "/mid_ai_core")
local call, gcall = Core.call, Core.gcall
local dtime, unitDist, towards = Core.dtime, Core.unitDist, Core.towards
local pct = Core.pct

local B = {}
B.name = "npc_dota_hero_storm_spirit"

-- ترتیب لِوِل‌آپ حرفه‌ای -------------------------------------------------
B.levelOrder = {
  "storm_spirit_static_remnant",   -- 1
  "storm_spirit_overload",         -- 2
  "storm_spirit_static_remnant",   -- 3
  "storm_spirit_overload",         -- 4
  "storm_spirit_static_remnant",   -- 5
  "storm_spirit_ball_lightning",   -- 6
  "storm_spirit_static_remnant",   -- 7
  "storm_spirit_overload",         -- 8
  "storm_spirit_overload",         -- 9
  "TALENT",                        -- 10
  "storm_spirit_electric_vortex",  -- 11
  "storm_spirit_ball_lightning",   -- 12
  "storm_spirit_electric_vortex",  -- 13
  "storm_spirit_electric_vortex",  -- 14
  "TALENT",                        -- 15
  "storm_spirit_electric_vortex",  -- 16
  "storm_spirit_ball_lightning",   -- 18
  "TALENT", "TALENT",
}

B.items = {
  "item_magic_stick", "item_bottle", "item_boots", "item_null_talisman",
  "item_magic_wand", "item_power_treads", "item_kaya", "item_bloodstone",
  "item_black_king_bar", "item_kaya_and_sange", "item_shivas_guard", "item_sheepstick",
}

-- ابزار ------------------------------------------------------------------
local function ab(bot, n) return call(bot, "GetAbilityByName", n) end

local function ready(a)
  if a == nil then return false end
  if (call(a, "GetLevel") or 0) <= 0 then return false end
  if call(a, "IsFullyCastable") ~= true then return false end
  if (call(a, "GetCooldownTimeRemaining") or 99) > 0 then return false end
  return true
end

-- هزینه‌ی دقیق Ball Lightning برای پیمودن یک فاصله
local function zipCost(bot, blAb, distance)
  if blAb == nil then return 99999 end
  local maxMana = call(bot, "GetMaxMana") or 1000
  local initBase = call(blAb, "GetSpecialValueInt", "ball_lightning_initial_mana_base") or 30
  local initPct  = call(blAb, "GetSpecialValueInt", "ball_lightning_initial_mana_percentage") or 8
  local moveBase = call(blAb, "GetSpecialValueInt", "ball_lightning_move_cost_base") or 12
  local movePct  = call(blAb, "GetSpecialValueFloat", "ball_lightning_move_cost_percent") or 0.7
  local units = math.max(distance, 0) / 100
  return initBase + maxMana * (initPct / 100) + units * (moveBase + maxMana * (movePct / 100))
end

-- مانایی که همیشه برای فرار نگه می‌داریم (زیپ ۱۲۰۰ واحدی)
local function escapeReserve(bot)
  return zipCost(bot, ab(bot, "storm_spirit_ball_lightning"), 1200)
end
B.ManaReserve = escapeReserve

local function manaAfter(bot, cost)
  return (call(bot, "GetMana") or 0) - (cost or 0)
end

local function hasOverload(bot)
  return call(bot, "HasModifier", "modifier_storm_spirit_overload") == true
end

-- Static Remnant: شعاع انفجار
local function remnantRadius(bot)
  local a = ab(bot, "storm_spirit_static_remnant")
  local r = call(a, "GetSpecialValueInt", "static_remnant_radius")
  if r == nil or r <= 0 then return 260 end
  return r
end

-- ===========================================================================
-- هرس در لاین: Remnant روی حریف + ضربه‌ی Overload
-- ===========================================================================
function B.OnLaneHarass(bot, enemy, ctx)
  local d = unitDist(bot, enemy)
  local sr = ab(bot, "storm_spirit_static_remnant")

  -- اگر Overload فعال است، فقط بزن (دمیج اضافه)
  if hasOverload(bot) then
    Core.attackUnit(bot, enemy)
    return true
  end

  if ready(sr) and d <= remnantRadius(bot) - 20 then
    local cost = call(sr, "GetManaCost") or 0
    if manaAfter(bot, cost) >= escapeReserve(bot) * 0.8 then
      call(bot, "Action_UseAbility", sr)
      return true
    end
  end
  return false
end

-- ===========================================================================
-- کمک به لست‌هیت/دنای با Static Remnant
-- ===========================================================================
function B.OnFarmAssist(bot, creep, isDeny)
  local sr = ab(bot, "storm_spirit_static_remnant")
  if not ready(sr) then return false end
  local d = unitDist(bot, creep)
  if d > remnantRadius(bot) - 30 then return false end

  local dmg = call(sr, "GetAbilityDamage") or 0
  local real = call(creep, "GetActualIncomingDamage", dmg, DAMAGE_TYPE_MAGICAL) or dmg * 0.75
  local hp = call(creep, "GetHealth") or 0
  if real < hp then return false end

  local cost = call(sr, "GetManaCost") or 0
  if manaAfter(bot, cost) < escapeReserve(bot) then return false end
  call(bot, "Action_UseAbility", sr)
  return true
end

-- ===========================================================================
-- کمبوی نبرد
-- ===========================================================================
function B.OnCombat(bot, target, ctx)
  local d = unitDist(bot, target)
  local bl = ab(bot, "storm_spirit_ball_lightning")
  local sr = ab(bot, "storm_spirit_static_remnant")
  local ev = ab(bot, "storm_spirit_electric_vortex")
  local mana = call(bot, "GetMana") or 0
  local killable = ctx ~= nil and ctx.kill == true
  local tLoc = call(target, "GetLocation")
  if tLoc == nil then return false end

  -- آیتم‌های تهاجمی اول (اورکید/شیپ/اتوس)
  if d <= 900 and Core.useOffensiveItems(bot, target) then return true end

  -- ۱) رسیدن به هدف با Ball Lightning
  if d > 350 and d < 1800 and ready(bl) then
    local need = zipCost(bot, bl, d + 120)
    local keep = escapeReserve(bot) * 0.55
    if killable and (mana - need) >= keep then
      local dest = towards(call(bot, "GetLocation"), tLoc, d - 120)
      call(bot, "Action_UseAbilityOnLocation", bl, dest)
      return true
    end
  end

  -- ۲) قفل کردن هدف با Electric Vortex
  if ready(ev) and d <= (call(ev, "GetCastRange") or 300) then
    if call(target, "IsMagicImmune") ~= true then
      local cost = call(ev, "GetManaCost") or 0
      if killable or (mana - cost) >= escapeReserve(bot) then
        call(bot, "Action_UseAbilityOnEntity", ev, target)
        return true
      end
    end
  end

  -- ۳) Static Remnant برای دمیج + فعال کردن Overload
  if ready(sr) and d <= remnantRadius(bot) - 20 and not hasOverload(bot) then
    local cost = call(sr, "GetManaCost") or 0
    if killable or (mana - cost) >= escapeReserve(bot) then
      call(bot, "Action_UseAbility", sr)
      return true
    end
  end

  -- ۴) ضربه (با Overload اگر فعال باشد)
  if d <= (call(bot, "GetAttackRange") or 480) + 150 then
    Core.attackUnit(bot, target)
    return true
  end
  return false
end

-- ===========================================================================
-- فرار: Ball Lightning به سمت خانه
-- ===========================================================================
function B.OnEscape(bot, ctx)
  local bl = ab(bot, "storm_spirit_ball_lightning")
  if not ready(bl) then return false end
  local myLoc = call(bot, "GetLocation")
  local home = Core.homeLocation()
  if myLoc == nil or home == nil then return false end

  local hpP = pct(call(bot, "GetHealth") or 1, call(bot, "GetMaxHealth") or 1)
  local mana = call(bot, "GetMana") or 0

  -- طول پرش را با مانای موجود تنظیم کن
  local wanted = 1400
  if hpP < 0.25 then wanted = 2200 end
  local step = wanted
  while step > 300 and zipCost(bot, bl, step) > mana do step = step - 150 end
  if step <= 300 then return false end

  local dest = towards(myLoc, home, step)
  if gcall(IsLocationPassable, dest) == false then dest = towards(myLoc, home, step * 0.6) end
  call(bot, "Action_UseAbilityOnLocation", bl, dest)
  return true
end

return B
