--[[ ==========================================================================
  MID AI CORE  —  Dota 2 Bot Scripting API (Lua)   |   نسخه‌ی حرفه‌ای میدلین
  ---------------------------------------------------------------------------
  هسته‌ی مشترک هوش مصنوعی میدلین برای:
      Ember Spirit · Puck · Earth Spirit · Storm Spirit

  امکانات هسته:
    * موتور لست‌هیت/دنای با دقت فریم (پیش‌بینی HP، windup، سرعت پرتابه،
      دمیج ورودی کریپ‌ها و پرتابه‌های در حال پرواز، آرمور و رول دمیج)
    * کنترل ارگ کریپ‌ها و تعادل لاین (lane equilibrium) مثل بازیکن حرفه‌ای
    * تریدینگ و هرس با محاسبه‌ی سود/زیان، آگاهی از دمیج تاور و دایو امن
    * کنترل رون، مدیریت باتل، خرید پویا، لِوِل‌آپ خودکار + تلنت
    * گنگ / پوش / دیفنس با TP / تیم‌فایت / انتخاب هدف بهینه
    * منوی تنظیمات زنده (mid_ai_settings.lua) + قابلیت اعمال با یک کلید

  ---------------------------------------------------------------------------
  ساختار فایل‌ها (همه در پوشه‌ی bots):
      mid_ai_core.lua            <- همین فایل (هسته)
      mid_ai_settings.lua        <- منوی تنظیمات (قابل تغییر حین بازی)
      heroes/ember_spirit.lua    <- مغز اختصاصی هیرو
      heroes/puck.lua
      heroes/earth_spirit.lua
      heroes/storm_spirit.lua
      hero_ember_spirit.lua      <- فایل‌های ورودی بازی (wrapper)
      hero_puck.lua
      hero_earth_spirit.lua
      hero_storm_spirit.lua
  ========================================================================== ]]

local Core = {}

-- ===========================================================================
-- 0) SETTINGS  —  منوی تنظیمات زنده
-- ---------------------------------------------------------------------------
-- سه منبع تنظیمات، به ترتیب اولویت:
--   1) کانسول‌ور (اگر در محیط اجرا در دسترس باشد)  مثال: mid_ai_master
--   2) فایل mid_ai_settings.lua  (با کلیدِ بایندشده به dota_bot_reload_scripts
--      حین بازی اعمال می‌شود  =>  bind "F5" "dota_bot_reload_scripts")
--   3) مقادیر پیش‌فرض زیر
-- ===========================================================================
local DEFAULTS = {
  -- Master ---------------------------------------------------------------
  MASTER              = true,   -- کل اسکریپت روشن/خاموش
  MID_ONLY            = false,  -- فقط وقتی لاین بات، مید است فعال شود
  DEBUG               = false,
  DEBUG_DRAW          = false,

  -- Modules (هر بخش را جدا می‌توان خاموش کرد) ----------------------------
  ENABLE_LASTHIT      = true,
  ENABLE_DENY         = true,
  ENABLE_HARASS       = true,
  ENABLE_ABILITIES    = true,
  ENABLE_ITEMS        = true,
  ENABLE_AUTO_BUY     = true,
  ENABLE_AUTO_LEVEL   = true,
  ENABLE_RUNES        = true,
  ENABLE_GANK         = true,
  ENABLE_PUSH         = true,
  ENABLE_TP_DEFEND    = true,
  ENABLE_ROSHAN       = true,
  ENABLE_COURIER      = true,
  ENABLE_ESCAPE       = true,

  -- Laning ---------------------------------------------------------------
  LASTHIT_LEAD        = 0.10,
  LASTHIT_SAFETY      = 0.94,  -- ضریب اطمینان روی دمیج (رول پایین دمیج)
  DENY_HP_PCT         = 0.50,
  HARASS_HP_MIN       = 0.55,
  HARASS_MANA_MIN     = 0.35,
  HARASS_AGGRESSION   = 1.0,   -- 0 = پسیو ، 2 = خیلی تهاجمی
  RETREAT_HP_PCT      = 0.34,
  DANGER_HP_PCT       = 0.22,
  TOWER_DIVE_HP_PCT   = 0.72,
  LANE_EQ_TOLERANCE   = 260,
  CREEP_AGGRO_RANGE   = 500,
  ORB_WALK            = true,  -- کنسل کردن backswing و ریپوزیشن بین حملات

  -- Runes ----------------------------------------------------------------
  RUNE_PREP_TIME      = 11.0,
  RUNE_MAX_TRAVEL     = 2600,

  -- Combat ---------------------------------------------------------------
  MANA_RESERVE_ESCAPE = 0.18,
  TEAMFIGHT_RADIUS    = 1400,
  CHASE_MAX_DISTANCE  = 1600,
  KILL_CONFIDENCE     = 1.05,  -- ضریب اطمینان برای شروع کمبو کیل

  -- Mid game -------------------------------------------------------------
  GANK_MIN_LEVEL      = 6,
  DEFEND_TP_TIME      = 4.0,
  ROSHAN_MIN_TIME     = 15 * 60,
  ROSHAN_MIN_ALLIES   = 3,
}

-- نگاشت تنظیم -> نام کانسول‌ور (در صورت وجود Convars در محیط)
local CVAR_MAP = {
  MASTER = "mid_ai_master", ENABLE_LASTHIT = "mid_ai_lasthit",
  ENABLE_DENY = "mid_ai_deny", ENABLE_HARASS = "mid_ai_harass",
  ENABLE_ABILITIES = "mid_ai_abilities", ENABLE_ITEMS = "mid_ai_items",
  ENABLE_RUNES = "mid_ai_runes", ENABLE_GANK = "mid_ai_gank",
  ENABLE_PUSH = "mid_ai_push", DEBUG = "mid_ai_debug",
  HARASS_AGGRESSION = "mid_ai_aggression",
}

local CFG = {}
for k, v in pairs(DEFAULTS) do CFG[k] = v end
Core.CFG = CFG

local _settingsCheck = -100

local function readCvar(name)
  local ok, v = pcall(function()
    if Convars == nil then return nil end
    local s = Convars:GetStr(name)
    if s == nil or s == "" then return nil end
    return s
  end)
  if not ok then return nil end
  return v
end

local function coerce(defaultValue, str)
  if type(defaultValue) == "boolean" then
    return not (str == "0" or str == "false" or str == "off")
  end
  local n = tonumber(str)
  if n ~= nil then return n end
  return defaultValue
end

-- بارگذاری/بازخوانی تنظیمات (هر ثانیه یک‌بار، ارزان)
local function refreshSettings()
  local now = 0
  local ok, t = pcall(DotaTime)
  if ok and t ~= nil then now = t end
  if (now - _settingsCheck) < 1.0 then return end
  _settingsCheck = now

  -- 1) فایل تنظیمات
  pcall(function()
    local path = GetScriptDirectory() .. "/mid_ai_settings"
    if package ~= nil and package.loaded ~= nil then package.loaded[path] = nil end
    local user = require(path)
    if type(user) == "table" then
      for k, v in pairs(user) do
        if DEFAULTS[k] ~= nil then CFG[k] = v end
      end
    end
  end)

  -- 2) کانسول‌ورها (اگر در دسترس بودند، اولویت بالاتر دارند)
  for key, cvar in pairs(CVAR_MAP) do
    local s = readCvar(cvar)
    if s ~= nil then CFG[key] = coerce(DEFAULTS[key], s) end
  end
end
Core.RefreshSettings = refreshSettings

-- ===========================================================================
-- 2) SAFE API WRAPPERS  —  لایه‌ی امن برای فراخوانی API
--    (اگر نسخه‌ی بازی متدی را نداشت، اسکریپت کرش نمی‌کند)
-- ===========================================================================
local function call(obj, method, a, b, c, d)
  if obj == nil then return nil end
  local f = obj[method]
  if f == nil then return nil end
  local ok, r = pcall(f, obj, a, b, c, d)
  if ok then return r end
  return nil
end

local function gcall(fn, a, b, c, d)
  if fn == nil then return nil end
  local ok, r = pcall(fn, a, b, c, d)
  if ok then return r end
  return nil
end

local function log(...)
  if not CFG.DEBUG then return end
  local parts = {}
  for i = 1, select('#', ...) do parts[#parts + 1] = tostring((select(i, ...))) end
  print("[MID-AI] " .. table.concat(parts, " "))
end

-- ===========================================================================
-- 3) MATH / VECTOR HELPERS
-- ===========================================================================
local function clamp(v, lo, hi) if v < lo then return lo elseif v > hi then return hi else return v end end
local function pct(a, b) if b == nil or b <= 0 then return 0 end return a / b end

local function dist2D(a, b)
  if a == nil or b == nil then return 99999 end
  local dx, dy = a.x - b.x, a.y - b.y
  return math.sqrt(dx * dx + dy * dy)
end

local function unitDist(a, b)
  if a == nil or b == nil then return 99999 end
  local d = gcall(GetUnitToUnitDistance, a, b)
  if d ~= nil then return d end
  return dist2D(call(a, "GetLocation"), call(b, "GetLocation"))
end

local function locDist(unit, loc)
  if unit == nil or loc == nil then return 99999 end
  local d = gcall(GetUnitToLocationDistance, unit, loc)
  if d ~= nil then return d end
  return dist2D(call(unit, "GetLocation"), loc)
end

-- نقطه‌ای در امتداد بردار a->b به فاصله‌ی مشخص
local function towards(a, b, distance)
  if a == nil or b == nil then return a end
  local dx, dy = b.x - a.x, b.y - a.y
  local len = math.sqrt(dx * dx + dy * dy)
  if len < 1 then return a end
  return Vector(a.x + dx / len * distance, a.y + dy / len * distance, a.z or 0)
end

local function midpoint(a, b)
  if a == nil then return b end
  if b == nil then return a end
  return Vector((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, 0)
end

-- ===========================================================================
-- 4) PER-FRAME CACHE  —  کش هر فریم (برای پرهیز از محاسبات تکراری)
-- ===========================================================================
local Cache = { t = -1, data = {} }
local function cached(key, fn)
  local now = gcall(DotaTime) or 0
  if Cache.t ~= now then Cache.t = now; Cache.data = {} end
  local v = Cache.data[key]
  if v == nil then
    v = fn()
    if v == nil then v = false end
    Cache.data[key] = v
  end
  if v == false then return nil end
  return v
end

-- ===========================================================================
-- 5) STATE  —  حافظه‌ی بین فریم‌ها
-- ===========================================================================
local S = {
  initialized      = false,
  lastAttackIssued = -1,
  lastAttackTarget = nil,
  lastAbilityCast  = -1,
  lastPurchaseTry  = -1,
  lastCourierUse   = -1,
  lastLevelUp      = -1,
  runeTarget       = nil,
  runeUntil        = -1,
  gankTarget       = nil,
  gankUntil        = -1,
  defendUntil      = -1,
  defendLoc        = nil,
  buildProfile     = nil,
  itemQueue        = nil,
  itemQueueTime    = -1,
  laneFrac         = 0.5,
  homeLoc          = nil,
  enemyMidName     = nil,
  brain            = nil,
  attackIssuedAt   = -1,
  attackWindupEnd  = -1,
  holdFireUntil    = -1,
  aggroPullUntil   = -1,
  lastTpUse        = -1,
  lastRuneCheck    = -1,
}

-- ===========================================================================
-- 6) PERCEPTION  —  ادراک محیط
-- ===========================================================================
local function myTeam() return gcall(GetTeam) or TEAM_RADIANT end
local function enemyTeam()
  if myTeam() == TEAM_RADIANT then return TEAM_DIRE end
  return TEAM_RADIANT
end
local function dtime() return gcall(DotaTime) or 0 end
local function gameStarted() return dtime() > 0 end

local function enemyHeroes()
  return cached("enemyHeroes", function()
    return gcall(GetUnitList, UNIT_LIST_ENEMY_HEROES) or {}
  end)
end

local function allyHeroes()
  return cached("allyHeroes", function()
    return gcall(GetUnitList, UNIT_LIST_ALLIED_HEROES) or {}
  end)
end

-- دشمنان قابل مشاهده در شعاع مشخص
local function visibleEnemies(bot, radius)
  local out = {}
  for _, e in pairs(enemyHeroes()) do
    if e ~= nil and call(e, "IsNull") ~= true and call(e, "IsAlive") == true
       and call(e, "CanBeSeen") == true and unitDist(bot, e) <= radius then
      out[#out + 1] = e
    end
  end
  return out
end

local function nearbyAllies(bot, radius)
  local out = {}
  for _, a in pairs(allyHeroes()) do
    if a ~= nil and a ~= bot and call(a, "IsNull") ~= true and call(a, "IsAlive") == true
       and unitDist(bot, a) <= radius then
      out[#out + 1] = a
    end
  end
  return out
end

-- دشمنانی که "گم" هستند (دیده نمی‌شوند) => خطر گنک
local function missingEnemyCount()
  local n = 0
  for _, e in pairs(enemyHeroes()) do
    if call(e, "IsAlive") == true and call(e, "CanBeSeen") ~= true then n = n + 1 end
  end
  return n
end

local function isMidLane(bot)
  local lane = call(bot, "GetAssignedLane")
  return lane == nil or lane == LANE_MID
end

-- خانه‌ی ما (نقطه‌ی امن پشت تاور خودی در میدلین)
local function homeLocation()
  if S.homeLoc ~= nil then return S.homeLoc end
  local frac = 0.30
  if myTeam() == TEAM_DIRE then frac = 0.70 end
  S.homeLoc = gcall(GetLocationAlongLane, LANE_MID, frac)
  return S.homeLoc
end

local function laneLoc(frac)
  frac = clamp(frac, 0.0, 1.0)
  local l = gcall(GetLocationAlongLane, LANE_MID, frac)
  if l ~= nil then return l end
  return homeLocation()
end

-- تبدیل جهت لاین: 0 = سمت رادیانت ، 1 = سمت دایر
local function forwardSign()
  if myTeam() == TEAM_RADIANT then return 1 end
  return -1
end

local function ownTowerMid1() return gcall(GetTower, myTeam(), TOWER_MID_1) end
local function enemyTowerMid1() return gcall(GetTower, enemyTeam(), TOWER_MID_1) end

-- ===========================================================================
-- 7) COMBAT MATH  —  ریاضیات نبرد (پایه‌ی لست‌هیت دقیق)
-- ===========================================================================

-- زمان windup حمله با در نظر گرفتن اتک‌اسپید
local function attackWindup(bot)
  local ap = call(bot, "GetAttackPoint") or 0.3
  local asp = call(bot, "GetAttackSpeed")
  if asp == nil or asp <= 0 then
    local bat = call(bot, "GetSecondsPerAttack") or 1.7
    asp = 1.7 / math.max(bat, 0.05)
  end
  return ap / math.max(asp, 0.1)
end

-- زمان کل تا اصابت ضربه به هدف (windup + سفر پرتابه)
local function timeToImpact(bot, target)
  local t = attackWindup(bot)
  local speed = call(bot, "GetAttackProjectileSpeed")
  if speed ~= nil and speed > 0 and speed < 9000 then
    local d = math.max(unitDist(bot, target) - 30, 0)
    t = t + d / speed
  end
  return t
end

-- آیا حمله آماده است؟ (فاصله‌ی زمانی تا شلیک بعدی)
local function attackReadyIn(bot)
  local last = call(bot, "GetLastAttackTime")
  local spa = call(bot, "GetSecondsPerAttack") or 1.7
  if last == nil then return 0 end
  local elapsed = dtime() - last
  local remain = spa - elapsed
  if remain < 0 then return 0 end
  return remain
end

-- دمیج واقعی حمله‌ی ما روی یک هدف (با احتساب آرمور)
local function myAttackDamage(bot, target)
  local raw = call(bot, "GetAttackDamage") or 50
  local real = call(target, "GetActualIncomingDamage", raw, DAMAGE_TYPE_PHYSICAL)
  if real == nil then real = raw * 0.75 end
  return real
end

-- مجموع دمیجِ پرتابه‌های در حال پروازِ رسیده تا زمان t
local function incomingProjectileDamage(target, t)
  local list = call(target, "GetIncomingTrackingProjectiles")
  if list == nil then return 0 end
  local total = 0
  local tLoc = call(target, "GetLocation")
  for _, p in pairs(list) do
    if type(p) == "table" then
      local speed = p.move_speed or p.speed or 900
      local eta = 0
      if p.location ~= nil and tLoc ~= nil and speed > 0 then
        eta = dist2D(p.location, tLoc) / speed
      end
      if eta <= t + 0.05 then
        local dmg = p.damage
        if dmg == nil and p.is_attack and p.caster ~= nil then
          local raw = call(p.caster, "GetAttackDamage") or 20
          dmg = call(target, "GetActualIncomingDamage", raw, DAMAGE_TYPE_PHYSICAL) or raw * 0.7
        end
        total = total + (dmg or 0)
      end
    end
  end
  return total
end

-- تخمین DPS واردشونده روی یک کریپ از سمت کریپ‌های ملی (بدون احتساب پرتابه‌ها)
local function meleeDpsOn(bot, target, ally)
  local dps = 0
  local list = call(bot, "GetNearbyLaneCreeps", 900, not ally)
  if list == nil then return 0 end
  for _, c in pairs(list) do
    if c ~= nil and call(c, "IsAlive") == true and call(c, "GetAttackTarget") == target then
      local speed = call(c, "GetAttackProjectileSpeed") or 0
      if speed == nil or speed <= 0 or speed >= 9000 then -- ملی: دمیجش رهگیری نمی‌شود
        local raw = call(c, "GetAttackDamage") or 20
        local real = call(target, "GetActualIncomingDamage", raw, DAMAGE_TYPE_PHYSICAL) or raw
        local spa = call(c, "GetSecondsPerAttack") or 1.0
        dps = dps + real / math.max(spa, 0.2)
      end
    end
  end
  return dps
end

-- HP پیش‌بینی‌شده‌ی هدف در لحظه‌ی اصابت ضربه‌ی ما
local function predictedHealth(bot, target, t)
  local hp = call(target, "GetHealth") or 0
  local regen = call(target, "GetHealthRegen") or 0
  hp = hp + regen * t
  hp = hp - incomingProjectileDamage(target, t)
  hp = hp - meleeDpsOn(bot, target, false) * t          -- کریپ‌های دشمن
  hp = hp - meleeDpsOn(bot, target, true) * t           -- کریپ‌های خودی
  return hp
end

-- آیا با حمله‌ی الان، هدف را می‌کشیم؟ (لست‌هیت / دنای)
local function canSecure(bot, target)
  if target == nil or call(target, "IsAlive") ~= true then return false end
  local range = (call(bot, "GetAttackRange") or 600)
  if unitDist(bot, target) > range then return false end
  local t = timeToImpact(bot, target) + attackReadyIn(bot)
  local hp = predictedHealth(bot, target, t)
  local dmg = myAttackDamage(bot, target)
  return hp > 0 and hp <= dmg
end

-- آیا هدف تا زمان مشخصی بدون دخالت ما می‌میرد؟
local function willDieSoon(bot, target, t)
  return predictedHealth(bot, target, t) <= 0
end

-- HP موثر در برابر دمیج فیزیکی/جادویی
local function effectiveHP(unit)
  local hp = call(unit, "GetHealth") or 1
  local phys = call(unit, "GetActualIncomingDamage", 100, DAMAGE_TYPE_PHYSICAL) or 75
  local magi = call(unit, "GetActualIncomingDamage", 100, DAMAGE_TYPE_MAGICAL) or 75
  local mult = math.max((phys + magi) * 0.5, 1) / 100
  return hp / mult
end

-- تخمین دمیجی که یک دشمن ظرف چند ثانیه می‌تواند به ما بزند
local function threatFrom(enemy, bot, window)
  local d = call(enemy, "GetEstimatedDamageToTarget", true, bot, window, DAMAGE_TYPE_ALL)
  if d ~= nil then return d end
  local atk = call(enemy, "GetAttackDamage") or 50
  local spa = call(enemy, "GetSecondsPerAttack") or 1.7
  return atk * (window / math.max(spa, 0.5))
end

-- سطح تهدید کلی روی ما (شامل تاور)
local function threatLevel(bot, window)
  window = window or 3.0
  return cached("threat" .. tostring(window), function()
    local total = 0
    for _, e in pairs(visibleEnemies(bot, 1600)) do
      local d = unitDist(bot, e)
      local reach = math.max(call(e, "GetAttackRange") or 600, 700)
      local w = 1.0
      if d > reach then w = clamp(1.2 - (d - reach) / 900, 0.1, 1.0) end
      total = total + threatFrom(e, bot, window) * w
    end
    local towers = call(bot, "GetNearbyTowers", 900, true) or {}
    for _, t in pairs(towers) do
      if call(t, "IsAlive") == true and unitDist(bot, t) <= (call(t, "GetAttackRange") or 700) + 60 then
        total = total + 110 * window * 0.7
      end
    end
    return total
  end)
end

-- ===========================================================================
-- 8) ACTION HELPERS  —  صدور دستور بدون کنسل کردن انیمیشن
-- ===========================================================================
local function attackUnit(bot, target)
  if target == nil then return false end
  local cur = call(bot, "GetAttackTarget")
  if cur == target and (dtime() - S.lastAttackIssued) < 0.6 then return true end
  call(bot, "Action_AttackUnit", target, true)
  S.lastAttackIssued = dtime()
  S.lastAttackTarget = target
  return true
end

local function moveTo(bot, loc)
  if loc == nil then return false end
  call(bot, "Action_MoveToLocation", loc)
  return true
end

local function attackMove(bot, loc)
  if loc == nil then return false end
  call(bot, "Action_AttackMove", loc)
  return true
end

local function isBusy(bot)
  if call(bot, "IsCastingAbility") == true then return true end
  if call(bot, "IsUsingAbility") == true then return true end
  if call(bot, "IsChanneling") == true then return true end
  return false
end

local function isDisabled(bot)
  if call(bot, "IsStunned") == true then return true end
  if call(bot, "IsHexed") == true then return true end
  if call(bot, "IsNightmared") == true then return true end
  return false
end

-- ===========================================================================
-- 9) INVENTORY  —  مدیریت آیتم‌ها
-- ===========================================================================
local INV_SLOTS, STASH_SLOTS = 8, 14

local function getItem(bot, name)
  for i = 0, INV_SLOTS do
    local it = call(bot, "GetItemInSlot", i)
    if it ~= nil and call(it, "GetName") == name then return it, i end
  end
  return nil, -1
end

local function hasItem(bot, name) return (getItem(bot, name)) ~= nil end

local function itemUsable(bot, name)
  local it = getItem(bot, name)
  if it == nil then return nil end
  if call(it, "IsFullyCastable") ~= true then return nil end
  if (call(it, "GetCooldownTimeRemaining") or 0) > 0 then return nil end
  return it
end

local function ownedItemNames(bot)
  local names = {}
  for i = 0, STASH_SLOTS do
    local it = call(bot, "GetItemInSlot", i)
    if it ~= nil then
      local n = call(it, "GetName")
      if n then names[#names + 1] = n end
    end
  end
  return names
end

local function countOwned(bot, name)
  local n = 0
  for _, v in pairs(ownedItemNames(bot)) do if v == name then n = n + 1 end end
  return n
end

-- ===========================================================================
-- 10) HERO CLASSIFICATION  —  شناسایی نوع هیرو
-- ===========================================================================
local function heroName(bot) return call(bot, "GetUnitName") or "" end
local function isRanged(bot) return (call(bot, "GetAttackRange") or 150) > 350 end
local function primaryAttr(bot)
  local a = call(bot, "GetPrimaryAttribute")
  if a == nil then return ATTRIBUTE_INTELLECT end
  return a
end
local function isCaster(bot) return primaryAttr(bot) == ATTRIBUTE_INTELLECT end

-- هیروهای نامرئی‌شونده => نیاز به سنتری/داست
local INVIS_HEROES = {
  npc_dota_hero_riki = true, npc_dota_hero_clinkz = true, npc_dota_hero_bounty_hunter = true,
  npc_dota_hero_invoker = false, npc_dota_hero_slark = true, npc_dota_hero_nyx_assassin = true,
  npc_dota_hero_weaver = true, npc_dota_hero_templar_assassin = true, npc_dota_hero_sand_king = true,
  npc_dota_hero_mirana = true, npc_dota_hero_phantom_lancer = false, npc_dota_hero_broodmother = true,
}

-- هیروهای پر-برست جادویی => نیاز به مقاومت جادویی
local MAGIC_BURST_HEROES = {
  npc_dota_hero_lina = true, npc_dota_hero_lion = true, npc_dota_hero_zuus = true,
  npc_dota_hero_leshrac = true, npc_dota_hero_skywrath_mage = true, npc_dota_hero_queenofpain = true,
  npc_dota_hero_tinker = true, npc_dota_hero_pugna = true, npc_dota_hero_necrolyte = true,
  npc_dota_hero_death_prophet = true, npc_dota_hero_storm_spirit = true, npc_dota_hero_shadow_shaman = true,
  npc_dota_hero_witch_doctor = true, npc_dota_hero_krobelus = true, npc_dota_hero_puck = true,
}

-- هیروهای دارای دیسیبل سنگین => نیاز به BKB
local HARD_DISABLE_HEROES = {
  npc_dota_hero_lion = true, npc_dota_hero_shadow_shaman = true, npc_dota_hero_bane = true,
  npc_dota_hero_sand_king = true, npc_dota_hero_enigma = true, npc_dota_hero_faceless_void = true,
  npc_dota_hero_magnataur = true, npc_dota_hero_tidehunter = true, npc_dota_hero_earthshaker = true,
  npc_dota_hero_axe = true, npc_dota_hero_legion_commander = true, npc_dota_hero_lina = true,
  npc_dota_hero_disruptor = true, npc_dota_hero_jakiro = true, npc_dota_hero_shadow_demon = true,
  npc_dota_hero_winter_wyvern = true, npc_dota_hero_dark_willow = true, npc_dota_hero_silencer = true,
}

local function enemyProfile()
  return cached("enemyProfile", function()
    local p = { invis = false, magic = 0, disable = 0, physicalCarry = 0, count = 0 }
    for _, e in pairs(enemyHeroes()) do
      local n = call(e, "GetUnitName")
      if n then
        p.count = p.count + 1
        if INVIS_HEROES[n] then p.invis = true end
        if MAGIC_BURST_HEROES[n] then p.magic = p.magic + 1 end
        if HARD_DISABLE_HEROES[n] then p.disable = p.disable + 1 end
        local attr = call(e, "GetPrimaryAttribute")
        if attr == ATTRIBUTE_AGILITY then p.physicalCarry = p.physicalCarry + 1 end
      end
    end
    return p
  end)
end

-- ===========================================================================
-- 11) ITEM BUILDS  —  بیلد آیتم
-- ===========================================================================
local BUILD_START = {
  "item_tango", "item_faerie_fire", "item_branches", "item_branches", "item_circlet",
}

local BUILD_GENERIC_INT = {
  "item_magic_stick", "item_bottle", "item_boots", "item_null_talisman", "item_magic_wand",
  "item_power_treads", "item_blink", "item_black_king_bar", "item_ultimate_scepter",
  "item_aghanims_shard", "item_octarine_core", "item_sheepstick", "item_shivas_guard",
  "item_refresher",
}

local BUILD_GENERIC_AGI = {
  "item_magic_stick", "item_bottle", "item_boots", "item_wraith_band", "item_magic_wand",
  "item_power_treads", "item_dragon_lance", "item_black_king_bar", "item_desolator",
  "item_aghanims_shard", "item_silver_edge", "item_satanic", "item_greater_crit", "item_butterfly",
}

local BUILD_GENERIC_STR = {
  "item_magic_stick", "item_bottle", "item_boots", "item_bracer", "item_magic_wand",
  "item_power_treads", "item_blink", "item_black_king_bar", "item_ultimate_scepter",
  "item_aghanims_shard", "item_shivas_guard", "item_heart", "item_octarine_core",
}

-- بیلد اختصاصی میدلینرهای رایج (بر پایه‌ی بیلدهای رایج حرفه‌ای)
local HERO_BUILDS = {
  npc_dota_hero_nevermore = { "item_magic_stick", "item_bottle", "item_boots", "item_wraith_band",
    "item_magic_wand", "item_power_treads", "item_invis_sword", "item_black_king_bar",
    "item_desolator", "item_silver_edge", "item_satanic", "item_greater_crit" },
  npc_dota_hero_lina = { "item_magic_stick", "item_bottle", "item_boots", "item_null_talisman",
    "item_magic_wand", "item_power_treads", "item_aether_lens", "item_black_king_bar",
    "item_ultimate_scepter", "item_aghanims_shard", "item_octarine_core", "item_sheepstick" },
  npc_dota_hero_queenofpain = { "item_magic_stick", "item_bottle", "item_boots", "item_null_talisman",
    "item_magic_wand", "item_power_treads", "item_kaya", "item_black_king_bar",
    "item_aghanims_shard", "item_shivas_guard", "item_octarine_core", "item_sheepstick" },
  npc_dota_hero_storm_spirit = { "item_magic_stick", "item_bottle", "item_boots", "item_null_talisman",
    "item_magic_wand", "item_power_treads", "item_kaya", "item_bloodstone",
    "item_black_king_bar", "item_kaya_and_sange", "item_shivas_guard", "item_sheepstick" },
  npc_dota_hero_zuus = { "item_magic_stick", "item_bottle", "item_boots", "item_null_talisman",
    "item_magic_wand", "item_arcane_boots", "item_aether_lens", "item_ultimate_scepter",
    "item_aghanims_shard", "item_octarine_core", "item_refresher", "item_sheepstick" },
  npc_dota_hero_templar_assassin = { "item_magic_stick", "item_bottle", "item_boots", "item_wraith_band",
    "item_magic_wand", "item_power_treads", "item_dragon_lance", "item_desolator",
    "item_black_king_bar", "item_hurricane_pike", "item_greater_crit", "item_butterfly" },
  npc_dota_hero_puck = { "item_magic_stick", "item_bottle", "item_boots", "item_null_talisman",
    "item_magic_wand", "item_power_treads", "item_blink", "item_ultimate_scepter",
    "item_aghanims_shard", "item_octarine_core", "item_shivas_guard", "item_sheepstick" },
  npc_dota_hero_invoker = { "item_magic_stick", "item_bottle", "item_boots", "item_null_talisman",
    "item_magic_wand", "item_hand_of_midas", "item_travel_boots", "item_ultimate_scepter",
    "item_black_king_bar", "item_aghanims_shard", "item_octarine_core", "item_refresher" },
  npc_dota_hero_tinker = { "item_magic_stick", "item_bottle", "item_boots", "item_null_talisman",
    "item_soul_ring", "item_arcane_boots", "item_blink", "item_shivas_guard",
    "item_ultimate_scepter", "item_aghanims_shard", "item_sheepstick", "item_octarine_core" },
  npc_dota_hero_ember_spirit = { "item_magic_stick", "item_bottle", "item_boots", "item_wraith_band",
    "item_magic_wand", "item_phase_boots", "item_maelstrom", "item_kaya_and_sange",
    "item_black_king_bar", "item_gungir", "item_refresher", "item_greater_crit" },
  npc_dota_hero_earth_spirit = { "item_magic_stick", "item_bottle", "item_boots", "item_bracer",
    "item_magic_wand", "item_phase_boots", "item_ultimate_scepter", "item_aghanims_shard",
    "item_black_king_bar", "item_shivas_guard", "item_octarine_core", "item_heart" },
  npc_dota_hero_void_spirit = { "item_magic_stick", "item_bottle", "item_boots", "item_null_talisman",
    "item_magic_wand", "item_power_treads", "item_kaya", "item_black_king_bar",
    "item_ultimate_scepter", "item_aghanims_shard", "item_shivas_guard", "item_octarine_core" },
  npc_dota_hero_leshrac = { "item_magic_stick", "item_bottle", "item_boots", "item_null_talisman",
    "item_magic_wand", "item_arcane_boots", "item_kaya", "item_black_king_bar",
    "item_bloodstone", "item_shivas_guard", "item_aghanims_shard", "item_octarine_core" },
  npc_dota_hero_death_prophet = { "item_magic_stick", "item_bottle", "item_boots", "item_null_talisman",
    "item_magic_wand", "item_power_treads", "item_kaya", "item_black_king_bar",
    "item_shivas_guard", "item_ultimate_scepter", "item_octarine_core", "item_heart" },
  npc_dota_hero_razor = { "item_magic_stick", "item_bottle", "item_boots", "item_wraith_band",
    "item_magic_wand", "item_power_treads", "item_kaya", "item_black_king_bar",
    "item_aghanims_shard", "item_shivas_guard", "item_refresher", "item_satanic" },
  npc_dota_hero_viper = { "item_magic_stick", "item_bottle", "item_boots", "item_wraith_band",
    "item_magic_wand", "item_power_treads", "item_dragon_lance", "item_black_king_bar",
    "item_hurricane_pike", "item_aghanims_shard", "item_ultimate_scepter", "item_butterfly" },
  npc_dota_hero_sniper = { "item_magic_stick", "item_bottle", "item_boots", "item_wraith_band",
    "item_magic_wand", "item_power_treads", "item_dragon_lance", "item_maelstrom",
    "item_black_king_bar", "item_hurricane_pike", "item_greater_crit", "item_satanic" },
  npc_dota_hero_pudge = { "item_magic_stick", "item_bottle", "item_boots", "item_bracer",
    "item_magic_wand", "item_phase_boots", "item_blink", "item_black_king_bar",
    "item_ultimate_scepter", "item_aghanims_shard", "item_shivas_guard", "item_heart" },
  npc_dota_hero_earth_spirit = { "earth_spirit_boulder_smash", "earth_spirit_rolling_boulder",
    "earth_spirit_geomagnetic_grip", "earth_spirit_magnetize" },
  npc_dota_hero_kunkka = { "item_magic_stick", "item_bottle", "item_boots", "item_bracer",
    "item_magic_wand", "item_power_treads", "item_armlet", "item_black_king_bar",
    "item_ultimate_scepter", "item_aghanims_shard", "item_shivas_guard", "item_greater_crit" },
}

-- ساخت لیست خرید نهایی با توجه به شرایط بازی
local function buildItemList(bot)
  local now = dtime()
  if S.itemQueue ~= nil and (now - S.itemQueueTime) < 8.0 then return S.itemQueue end

  local list = {}
  for _, v in ipairs(BUILD_START) do list[#list + 1] = v end

  local core = nil
  if S.brain ~= nil and S.brain.items ~= nil then core = S.brain.items end
  if core == nil then core = HERO_BUILDS[heroName(bot)] end
  if core == nil then
    local a = primaryAttr(bot)
    if a == ATTRIBUTE_AGILITY then core = BUILD_GENERIC_AGI
    elseif a == ATTRIBUTE_STRENGTH then core = BUILD_GENERIC_STR
    else core = BUILD_GENERIC_INT end
  end
  for _, v in ipairs(core) do list[#list + 1] = v end

  -- تنظیمات موقعیتی --------------------------------------------------------
  local ep = enemyProfile()
  local extra = {}
  if ep.invis then
    extra[#extra + 1] = "item_ward_sentry"
    extra[#extra + 1] = "item_dust"
  end
  if ep.magic >= 3 then extra[#extra + 1] = "item_hood_of_defiance" end
  if ep.disable >= 2 and not hasItem(bot, "item_black_king_bar") then
    extra[#extra + 1] = "item_black_king_bar"
  end
  if ep.physicalCarry >= 2 and now > 20 * 60 then extra[#extra + 1] = "item_crimson_guard" end

  -- آیتم‌های موقعیتی را بعد از سه آیتم اول هسته درج می‌کنیم
  local out, inserted = {}, false
  for i, v in ipairs(list) do
    out[#out + 1] = v
    if not inserted and i >= 9 then
      for _, x in ipairs(extra) do out[#out + 1] = x end
      inserted = true
    end
  end
  if not inserted then for _, x in ipairs(extra) do out[#out + 1] = x end end

  S.itemQueue = out
  S.itemQueueTime = now
  return out
end

-- آیتم بعدی که باید بخریم
local function nextItemToBuy(bot)
  local want = buildItemList(bot)
  local owned = {}
  for _, n in pairs(ownedItemNames(bot)) do owned[n] = (owned[n] or 0) + 1 end
  for _, name in ipairs(want) do
    if (owned[name] or 0) > 0 then
      owned[name] = owned[name] - 1
    else
      return name
    end
  end
  return nil
end

-- خرید مصرفی‌های ضروری (TP همیشه، رجن در صورت نیاز)
local function buyConsumables(bot)
  local gold = call(bot, "GetGold") or 0
  if dtime() > 60 and countOwned(bot, "item_tpscroll") < 1 and gold >= 100 then
    call(bot, "ActionImmediate_PurchaseItem", "item_tpscroll")
    return true
  end
  local hp = pct(call(bot, "GetHealth") or 1, call(bot, "GetMaxHealth") or 1)
  if hp < 0.5 and gold >= 300 and countOwned(bot, "item_flask") < 1
     and not hasItem(bot, "item_bottle") then
    call(bot, "ActionImmediate_PurchaseItem", "item_flask")
    return true
  end
  return false
end

-- روتین خرید
local function handlePurchasing(bot)
  if not CFG.ENABLE_AUTO_BUY then return end
  local now = dtime()
  if (now - S.lastPurchaseTry) < 0.35 then return end
  S.lastPurchaseTry = now

  if buyConsumables(bot) then return end

  local name = nextItemToBuy(bot)
  if name == nil then return end

  local cost = gcall(GetItemCost, name) or 0
  call(bot, "SetNextItemPurchaseValue", cost)
  if (call(bot, "GetGold") or 0) < cost then return end

  local res = call(bot, "ActionImmediate_PurchaseItem", name)
  if res == PURCHASE_ITEM_SUCCESS then
    log("bought", name)
  elseif res == PURCHASE_ITEM_NOT_AT_SECRET_SHOP then
    local cour = gcall(GetCourier, 0)
    if cour ~= nil then call(bot, "ActionImmediate_Courier", cour, COURIER_ACTION_SECRET_SHOP) end
  elseif res == PURCHASE_ITEM_OUT_OF_STOCK then
    S.itemQueue = nil -- در فریم بعد آیتم دیگری انتخاب شود
  end
end

-- مدیریت کوریر (بردن آیتم‌های استش)
local function handleCourier(bot)
  if not CFG.ENABLE_COURIER then return end
  local now = dtime()
  if (now - S.lastCourierUse) < 3.0 then return end
  local stash = call(bot, "GetStashValue") or 0
  if stash <= 0 then return end
  local cour = gcall(GetCourier, 0)
  if cour == nil then return end
  local st = gcall(GetCourierState, cour)
  if st == COURIER_STATE_IDLE or st == COURIER_STATE_AT_BASE or st == nil then
    call(bot, "ActionImmediate_Courier", cour, COURIER_ACTION_TAKE_STASH_AND_TRANSFER_ITEMS)
    S.lastCourierUse = now
  end
end

-- ===========================================================================
-- 12) ABILITY LEVELING  —  ارتقای مهارت‌ها
-- ===========================================================================
local ABILITY_PRIORITY = {
  npc_dota_hero_lina = { "lina_dragon_slave", "lina_light_strike_array", "lina_fiery_soul", "lina_laguna_blade" },
  npc_dota_hero_nevermore = { "nevermore_shadowraze1", "nevermore_necromastery", "nevermore_dark_lord", "nevermore_requiem" },
  npc_dota_hero_queenofpain = { "queenofpain_scream_of_pain", "queenofpain_shadow_strike", "queenofpain_blink", "queenofpain_sonic_wave" },
  npc_dota_hero_storm_spirit = { "storm_spirit_static_remnant", "storm_spirit_overload", "storm_spirit_electric_vortex", "storm_spirit_ball_lightning" },
  npc_dota_hero_zuus = { "zuus_arc_lightning", "zuus_lightning_bolt", "zuus_static_field", "zuus_thundergods_wrath" },
  npc_dota_hero_puck = { "puck_illusory_orb", "puck_waning_rift", "puck_phase_shift", "puck_dream_coil" },
  npc_dota_hero_templar_assassin = { "templar_assassin_psi_blades", "templar_assassin_refraction", "templar_assassin_meld", "templar_assassin_psionic_trap" },
  npc_dota_hero_leshrac = { "leshrac_lightning_storm", "leshrac_split_earth", "leshrac_diabolic_edict", "leshrac_pulse_nova" },
  npc_dota_hero_death_prophet = { "death_prophet_carrion_swarm", "death_prophet_silence", "death_prophet_spirit_siphon", "death_prophet_exorcism" },
  npc_dota_hero_viper = { "viper_poison_attack", "viper_corrosive_skin", "viper_nethertoxin", "viper_viper_strike" },
  npc_dota_hero_razor = { "razor_static_link", "razor_plasma_field", "razor_unstable_current", "razor_eye_of_the_storm" },
  npc_dota_hero_sniper = { "sniper_shrapnel", "sniper_headshot", "sniper_take_aim", "sniper_assassinate" },
  npc_dota_hero_pudge = { "pudge_meat_hook", "pudge_rot", "pudge_flesh_heap", "pudge_dismember" },
  npc_dota_hero_ember_spirit = { "ember_spirit_sleight_of_fist", "ember_spirit_flame_guard", "ember_spirit_searing_chains", "ember_spirit_fire_remnant" },
  npc_dota_hero_void_spirit = { "void_spirit_aether_remnant", "void_spirit_resonant_pulse", "void_spirit_dissimilate", "void_spirit_astral_step" },
  npc_dota_hero_tinker = { "tinker_laser", "tinker_heat_seeking_missile", "tinker_defense_matrix", "tinker_rearm" },
  npc_dota_hero_earth_spirit = { "earth_spirit_boulder_smash", "earth_spirit_rolling_boulder",
    "earth_spirit_geomagnetic_grip", "earth_spirit_magnetize" },
  npc_dota_hero_kunkka = { "kunkka_tidebringer", "kunkka_torrent", "kunkka_x_marks_the_spot", "kunkka_ghostship" },
}

-- تلنت‌های ترجیحی بر اساس نقش
local TALENT_KEYWORDS_CORE  = { "damage", "attack_speed", "crit", "lifesteal", "movement_speed", "attack_range" }
local TALENT_KEYWORDS_CASTER = { "cooldown", "mana", "spell_amp", "cast_range", "damage" }

local function isTalent(name) return name ~= nil and string.sub(name, 1, 14) == "special_bonus_" end

local function canUpgrade(ab)
  if ab == nil then return false end
  local r = call(ab, "CanAbilityBeUpgraded")
  if r == nil then return false end
  if ABILITY_CAN_BE_UPGRADED ~= nil then return r == ABILITY_CAN_BE_UPGRADED end
  return r == true
end

local function allAbilities(bot)
  local out = {}
  for i = 0, 23 do
    local a = call(bot, "GetAbilityInSlot", i)
    if a ~= nil then out[#out + 1] = a end
  end
  return out
end

local function pickTalent(bot)
  local words = TALENT_KEYWORDS_CORE
  if isCaster(bot) then words = TALENT_KEYWORDS_CASTER end
  local fallback = nil
  for _, a in pairs(allAbilities(bot)) do
    local n = call(a, "GetName")
    if isTalent(n) and canUpgrade(a) then
      if fallback == nil then fallback = n end
      for _, w in ipairs(words) do
        if string.find(n, w, 1, true) ~= nil then return n end
      end
    end
  end
  return fallback
end

local function handleLeveling(bot, brain)
  if not CFG.ENABLE_AUTO_LEVEL then return end
  local points = call(bot, "GetAbilityPoints") or 0
  if points <= 0 then return end
  if (dtime() - S.lastLevelUp) < 0.3 then return end

  local lvl = call(bot, "GetLevel") or 1

  -- ۱) ترتیب دقیق لِوِل‌آپ اختصاصی هیرو (حرفه‌ای‌ترین حالت)
  if brain ~= nil and brain.levelOrder ~= nil then
    for i = 1, #brain.levelOrder do
      local n = brain.levelOrder[i]
      if n == "TALENT" then
        local t = pickTalent(bot)
        if t ~= nil then
          call(bot, "ActionImmediate_LevelAbility", t)
          S.lastLevelUp = dtime()
          return
        end
      else
        local ab = call(bot, "GetAbilityByName", n)
        if ab ~= nil and canUpgrade(ab) then
          call(bot, "ActionImmediate_LevelAbility", n)
          S.lastLevelUp = dtime()
          return
        end
      end
    end
  end

  -- ۲) تلنت‌ها در لِوِل ۱۰ / ۱۵ / ۲۰ / ۲۵
  if lvl == 10 or lvl == 15 or lvl == 20 or lvl == 25 then
    local t = pickTalent(bot)
    if t ~= nil then
      call(bot, "ActionImmediate_LevelAbility", t)
      S.lastLevelUp = dtime()
      return
    end
  end

  local prio = ABILITY_PRIORITY[heroName(bot)]

  -- اولویت مطلق: آلتیمیت هرگاه ممکن باشد
  if prio ~= nil then
    local ult = call(bot, "GetAbilityByName", prio[4])
    if ult ~= nil and canUpgrade(ult) then
      call(bot, "ActionImmediate_LevelAbility", prio[4])
      S.lastLevelUp = dtime()
      return
    end
    for i = 1, 3 do
      local ab = call(bot, "GetAbilityByName", prio[i])
      if ab ~= nil and canUpgrade(ab) then
        call(bot, "ActionImmediate_LevelAbility", prio[i])
        S.lastLevelUp = dtime()
        return
      end
    end
  end

  -- حالت عمومی: بیشترین دمیج اول، آلتیمیت در اولویت
  local best, bestScore = nil, -1
  for _, a in pairs(allAbilities(bot)) do
    local n = call(a, "GetName")
    if n ~= nil and not isTalent(n) and canUpgrade(a) then
      local score = (call(a, "GetAbilityDamage") or 0)
      if call(a, "IsPassive") == true then score = score + 20 end
      if (call(a, "GetLevel") or 0) == 0 then score = score + 200 end -- اول یک لِوِل از هر کدام
      if score > bestScore then best, bestScore = n, score end
    end
  end
  if best ~= nil then
    call(bot, "ActionImmediate_LevelAbility", best)
    S.lastLevelUp = dtime()
  end
end

-- ===========================================================================
-- 13) REGEN & CONSUMABLES  —  مصرفی‌ها
-- ===========================================================================
local function useRegen(bot)
  local hpP = pct(call(bot, "GetHealth") or 1, call(bot, "GetMaxHealth") or 1)
  local mpP = pct(call(bot, "GetMana") or 1, call(bot, "GetMaxMana") or 1)
  local inFight = call(bot, "WasRecentlyDamagedByAnyHero", 3.0) == true

  -- Bottle: بهترین منبع رجن در میدلین
  if (hpP < 0.72 or mpP < 0.62) and not inFight then
    local b = itemUsable(bot, "item_bottle")
    if b ~= nil and (call(b, "GetCurrentCharges") or 0) > 0 then
      call(bot, "Action_UseAbility", b); return true
    end
  end
  -- Faerie Fire در وضعیت بحرانی
  if hpP < 0.2 then
    local f = itemUsable(bot, "item_faerie_fire")
    if f ~= nil then call(bot, "Action_UseAbility", f); return true end
  end
  -- Tango روی درخت
  if hpP < 0.6 and not inFight and call(bot, "HasModifier", "modifier_tango_heal") ~= true then
    local t = itemUsable(bot, "item_tango")
    if t ~= nil then
      local trees = call(bot, "GetNearbyTrees", 600)
      if trees ~= nil and trees[1] ~= nil then
        call(bot, "Action_UseAbilityOnTree", t, trees[1]); return true
      end
    end
  end
  -- Salve
  if hpP < 0.45 and not inFight and call(bot, "HasModifier", "modifier_flask_healing") ~= true then
    local s = itemUsable(bot, "item_flask")
    if s ~= nil then call(bot, "Action_UseAbilityOnEntity", s, bot); return true end
  end
  -- Clarity
  if mpP < 0.35 and not inFight and call(bot, "HasModifier", "modifier_clarity_potion") ~= true then
    local c = itemUsable(bot, "item_clarity")
    if c ~= nil then call(bot, "Action_UseAbilityOnEntity", c, bot); return true end
  end
  -- Magic Wand در نبرد
  if hpP < 0.4 then
    local w = itemUsable(bot, "item_magic_wand") or itemUsable(bot, "item_magic_stick")
    if w ~= nil and (call(w, "GetCurrentCharges") or 0) >= 6 then
      call(bot, "Action_UseAbility", w); return true
    end
  end
  return false
end

-- ===========================================================================
-- 14) ABILITY USAGE ENGINE  —  موتور استفاده از اسکیل‌ها
-- ===========================================================================
local function hasBehavior(behavior, flag)
  if behavior == nil or flag == nil or flag == 0 then return false end
  return math.floor(behavior / flag) % 2 == 1
end

-- اسکیل‌هایی که نباید به‌صورت خودکار زده شوند (کنترل دستی/خاص)
local ABILITY_BLACKLIST = {
  invoker_invoke = true, invoker_quas = true, invoker_wex = true, invoker_exort = true,
  pudge_rot = true, techies_land_mines = true, morphling_morph_agi = true,
  morphling_morph_str = true, lone_druid_true_form = true, troll_warlord_berserkers_rage = true,
  dragon_knight_elder_dragon_form = true, terrorblade_metamorphosis = true,
  wisp_tether = true, meepo_divided_we_stand = true, arc_warden_tempest_double = true,
}

local function castableAbilities(bot, keepMana)
  local out = {}
  local mana = call(bot, "GetMana") or 0
  local maxMana = call(bot, "GetMaxMana") or 1
  local reserve = 0
  if keepMana then reserve = maxMana * CFG.MANA_RESERVE_ESCAPE end

  for i = 0, 5 do
    local a = call(bot, "GetAbilityInSlot", i)
    if a ~= nil then
      local n = call(a, "GetName")
      if n ~= nil and not isTalent(n) and not ABILITY_BLACKLIST[n]
         and call(a, "IsHidden") ~= true and call(a, "IsPassive") ~= true
         and (call(a, "GetLevel") or 0) > 0
         and call(a, "IsFullyCastable") == true
         and (call(a, "GetCooldownTimeRemaining") or 99) <= 0 then
        local cost = call(a, "GetManaCost") or 0
        local behavior = call(a, "GetBehavior") or 0
        local toggle = hasBehavior(behavior, ABILITY_BEHAVIOR_TOGGLE or 0)
        local channel = hasBehavior(behavior, ABILITY_BEHAVIOR_CHANNELLED or 0)
        if (mana - cost) >= reserve and not toggle and not channel then
          out[#out + 1] = { ab = a, name = n, behavior = behavior,
                            range = call(a, "GetCastRange") or 600,
                            dmg = call(a, "GetAbilityDamage") or 0 }
        end
      end
    end
  end
  -- اول اسکیل‌های پر دمیج
  table.sort(out, function(x, y) return x.dmg > y.dmg end)
  return out
end

-- مکان پیش‌بینی‌شده‌ی هدف (برای اسکیل‌های نقطه‌ای)
local function predictLoc(target, delay)
  local l = call(target, "GetExtrapolatedLocation", delay)
  if l ~= nil then return l end
  return call(target, "GetLocation")
end

-- تلاش برای زدن یک اسکیل روی هدف
local function castOn(bot, entry, target)
  local ab, behavior = entry.ab, entry.behavior
  local range = entry.range
  if range == nil or range <= 0 then range = 700 end
  local d = unitDist(bot, target)

  if hasBehavior(behavior, ABILITY_BEHAVIOR_UNIT_TARGET or 0) then
    if d <= range then
      if call(target, "IsMagicImmune") == true then return false end
      call(bot, "Action_UseAbilityOnEntity", ab, target)
      S.lastAbilityCast = dtime()
      return true
    end
  elseif hasBehavior(behavior, ABILITY_BEHAVIOR_POINT or 0) then
    if d <= range + 120 then
      local delay = (call(ab, "GetCastPoint") or 0.3) + 0.15
      local loc = predictLoc(target, delay)
      if loc ~= nil then
        call(bot, "Action_UseAbilityOnLocation", ab, loc)
        S.lastAbilityCast = dtime()
        return true
      end
    end
  elseif hasBehavior(behavior, ABILITY_BEHAVIOR_NO_TARGET or 0) then
    local r = range
    if r > 1200 then r = 900 end
    if d <= r then
      call(bot, "Action_UseAbility", ab)
      S.lastAbilityCast = dtime()
      return true
    end
  end
  return false
end

-- مجموع دمیج آنی‌ای که می‌توانیم روی هدف بریزیم
local function burstDamage(bot, target)
  local total = 0
  for _, e in pairs(castableAbilities(bot, false)) do
    if e.dmg > 0 and unitDist(bot, target) <= math.max(e.range, 400) + 200 then
      local real = call(target, "GetActualIncomingDamage", e.dmg, DAMAGE_TYPE_MAGICAL) or e.dmg * 0.75
      total = total + real
    end
  end
  local dg = itemUsable(bot, "item_dagon") or itemUsable(bot, "item_dagon_5")
  if dg ~= nil then total = total + 400 end
  return total
end

-- آیا می‌توانیم هدف را بکشیم؟
local function canKill(bot, target)
  if target == nil then return false end
  if call(target, "IsMagicImmune") == true then return false end
  local hp = call(target, "GetHealth") or 0
  local shield = 0
  if call(target, "HasModifier", "modifier_templar_assassin_refraction_absorb") == true then shield = 200 end
  return burstDamage(bot, target) >= (hp + shield) * 1.05
end

-- ===========================================================================
-- 15) COMBAT ITEMS  —  آیتم‌های نبرد
-- ===========================================================================
local OFFENSIVE_TARGET_ITEMS = {
  "item_sheepstick", "item_bloodthorn", "item_orchid", "item_nullifier", "item_rod_of_atos",
  "item_ethereal_blade", "item_dagon_5", "item_dagon_4", "item_dagon_3", "item_dagon_2", "item_dagon",
  "item_solar_crest", "item_urn_of_shadows", "item_spirit_vessel", "item_heavens_halberd",
}
local OFFENSIVE_SELF_ITEMS = { "item_shivas_guard", "item_veil_of_discord", "item_mjollnir" }

local function useOffensiveItems(bot, target)
  if target == nil then return false end
  local d = unitDist(bot, target)
  for _, name in ipairs(OFFENSIVE_TARGET_ITEMS) do
    local it = itemUsable(bot, name)
    if it ~= nil then
      local r = call(it, "GetCastRange") or 700
      if r <= 0 then r = 700 end
      if d <= r and call(target, "IsMagicImmune") ~= true then
        call(bot, "Action_UseAbilityOnEntity", it, target)
        return true
      end
    end
  end
  if d <= 700 then
    for _, name in ipairs(OFFENSIVE_SELF_ITEMS) do
      local it = itemUsable(bot, name)
      if it ~= nil then call(bot, "Action_UseAbility", it); return true end
    end
  end
  return false
end

local function useBKB(bot)
  local it = itemUsable(bot, "item_black_king_bar")
  if it == nil then return false end
  local hpP = pct(call(bot, "GetHealth") or 1, call(bot, "GetMaxHealth") or 1)
  local enemies = visibleEnemies(bot, 1100)
  if #enemies >= 2 or (#enemies >= 1 and hpP < 0.6) then
    if isDisabled(bot) then return false end
    call(bot, "Action_UseAbility", it)
    return true
  end
  return false
end

local function useDefensiveItems(bot)
  local hpP = pct(call(bot, "GetHealth") or 1, call(bot, "GetMaxHealth") or 1)
  local threat = threatLevel(bot, 2.0)
  local hp = call(bot, "GetHealth") or 1
  local danger = hpP < 0.45 or threat > hp * 0.8

  if not danger then return false end
  if useBKB(bot) then return true end

  local sat = itemUsable(bot, "item_satanic")
  if sat ~= nil and hpP < 0.4 then call(bot, "Action_UseAbility", sat); return true end

  local bm = itemUsable(bot, "item_blade_mail")
  if bm ~= nil and #visibleEnemies(bot, 700) >= 1 and hpP < 0.55 then
    call(bot, "Action_UseAbility", bm); return true
  end

  if hpP < 0.35 then
    local g = itemUsable(bot, "item_glimmer_cape")
    if g ~= nil then call(bot, "Action_UseAbilityOnEntity", g, bot); return true end
    local gh = itemUsable(bot, "item_ghost")
    if gh ~= nil then call(bot, "Action_UseAbility", gh); return true end
    local cy = itemUsable(bot, "item_cyclone") or itemUsable(bot, "item_wind_waker")
    if cy ~= nil and isDisabled(bot) ~= true then
      call(bot, "Action_UseAbilityOnEntity", cy, bot); return true
    end
  end
  return false
end

-- فرار: بلینک/فورس‌استاف در جهت خانه
local function useEscapeItems(bot)
  local home = homeLocation()
  local myLoc = call(bot, "GetLocation")
  if home == nil or myLoc == nil then return false end

  local fs = itemUsable(bot, "item_force_staff") or itemUsable(bot, "item_hurricane_pike")
  local bl = itemUsable(bot, "item_blink") or itemUsable(bot, "item_swift_blink")
             or itemUsable(bot, "item_arcane_blink") or itemUsable(bot, "item_overwhelming_blink")

  if bl ~= nil and call(bot, "WasRecentlyDamagedByAnyHero", 3.0) == true then
    local target = towards(myLoc, home, 1180)
    if gcall(IsLocationPassable, target) ~= false then
      call(bot, "Action_UseAbilityOnLocation", bl, target)
      return true
    end
  end
  if fs ~= nil then
    -- برای فرار باید رو به خانه باشیم
    local dir = towards(myLoc, home, 100)
    call(bot, "Action_MoveToLocation", dir)
    call(bot, "Action_UseAbilityOnEntity", fs, bot)
    return true
  end
  local sb = itemUsable(bot, "item_invis_sword") or itemUsable(bot, "item_silver_edge")
  if sb ~= nil then call(bot, "Action_UseAbility", sb); return true end
  return false
end

-- ===========================================================================
-- 16) ELITE LAST-HIT / DENY ENGINE  —  موتور لست‌هیت و دنای (قلب اسکریپت)
-- ===========================================================================

-- کمینه/بیشینه‌ی دمیج ضربه‌ی ما (رول دمیج) روی هدف
local function damageWindow(bot, target)
  local avg = call(bot, "GetAttackDamage") or 50
  local base = call(bot, "GetBaseDamage")
  local var  = call(bot, "GetBaseDamageVariance") or 0
  local lo, hi = avg, avg
  if base ~= nil and var ~= nil and var > 0 then
    local bonus = avg - base
    lo = base - var * 0.5 + bonus
    hi = base + var * 0.5 + bonus
  end
  local rlo = call(target, "GetActualIncomingDamage", lo, DAMAGE_TYPE_PHYSICAL) or lo * 0.75
  local rhi = call(target, "GetActualIncomingDamage", hi, DAMAGE_TYPE_PHYSICAL) or hi * 0.75
  return rlo, rhi
end

-- زمان تا آماده شدن + رسیدن ضربه
local function strikeDelay(bot, target)
  return attackReadyIn(bot) + timeToImpact(bot, target)
end

-- ارزیابی یک کریپ به‌عنوان هدف لست‌هیت/دنای
-- خروجی: state ("now" | "soon" | "late" | "no") , زمان تخمینی , اختلاف HP
local function evaluateCreep(bot, creep, forDeny)
  if creep == nil or call(creep, "IsAlive") ~= true then return "no", 0, 0 end
  if forDeny then
    local hpP = pct(call(creep, "GetHealth") or 0, call(creep, "GetMaxHealth") or 1)
    local denyPct = CFG.DENY_HP_PCT
    if call(creep, "IsChanneling") == true then denyPct = 1.0 end
    if hpP > denyPct then return "no", 0, 0 end
  end

  local range = (call(bot, "GetAttackRange") or 150)
  local d = unitDist(bot, creep)
  local t = strikeDelay(bot, creep)
  local dmgLo = select(1, damageWindow(bot, creep)) * CFG.LASTHIT_SAFETY
  local hpAtImpact = predictedHealth(bot, creep, t)

  -- خارج از برد ولی نزدیک؟ فرصت با کمی حرکت
  local reachable = d <= range + 40
  local closeEnough = d <= range + 260

  if hpAtImpact <= 0 then
    -- کریپ قبل از ضربه‌ی ما می‌میرد (توسط کریپ‌های دیگر)
    return "late", t, hpAtImpact
  end
  if hpAtImpact <= dmgLo then
    if reachable then return "now", t, hpAtImpact end
    if closeEnough then return "step", t, hpAtImpact end
    return "no", t, hpAtImpact
  end

  -- چند لحظه دیگر قابل کشتن می‌شود؟
  local dps = meleeDpsOn(bot, creep, true) + meleeDpsOn(bot, creep, false)
  if dps > 1 then
    local extra = (hpAtImpact - dmgLo) / dps
    if extra <= 2.2 and closeEnough then return "soon", t + extra, hpAtImpact end
  end
  return "no", t, hpAtImpact
end

-- بهترین هدف لست‌هیت
local function bestLastHit(bot)
  local best, bestState, bestTime = nil, "no", 99
  local creeps = call(bot, "GetNearbyLaneCreeps", 900, true) or {}
  local rank = { now = 1, step = 2, soon = 3, late = 4, no = 5 }
  for _, c in pairs(creeps) do
    local st, t = evaluateCreep(bot, c, false)
    if st ~= "no" and st ~= "late" then
      if rank[st] < rank[bestState] or (rank[st] == rank[bestState] and t < bestTime) then
        best, bestState, bestTime = c, st, t
      end
    end
  end
  return best, bestState, bestTime
end

-- بهترین هدف دنای
local function bestDeny(bot)
  local best, bestState, bestTime = nil, "no", 99
  local rank = { now = 1, step = 2, soon = 3, late = 4, no = 5 }
  local creeps = call(bot, "GetNearbyLaneCreeps", 900, false) or {}
  for _, c in pairs(creeps) do
    local st, t = evaluateCreep(bot, c, true)
    if st ~= "no" and st ~= "late" then
      if rank[st] < rank[bestState] or (rank[st] == rank[bestState] and t < bestTime) then
        best, bestState, bestTime = c, st, t
      end
    end
  end
  return best, bestState, bestTime
end

-- ارزش نسبی دنای در برابر لست‌هیت (کریپ رنج/سیج ارزش بیشتری دارد)
local function denyValue(creep)
  local n = call(creep, "GetUnitName") or ""
  if string.find(n, "siege", 1, true) then return 1.6 end
  if string.find(n, "ranged", 1, true) then return 1.25 end
  return 0.85
end

-- آیا در ۱.۲ ثانیه‌ی آینده لست‌هیت/دنای داریم؟ (برای جلوگیری از هدر رفتن ضربه)
local function pendingFarmWindow(bot)
  local _, s1, t1 = bestLastHit(bot)
  local _, s2, t2 = bestDeny(bot)
  local best = 99
  if s1 == "soon" or s1 == "step" then best = math.min(best, t1) end
  if s2 == "soon" or s2 == "step" then best = math.min(best, t2) end
  return best
end

-- اجرای فارم دقیق؛ true اگر دستوری صادر شد
local function executeFarming(bot)
  local lh, lhState = nil, "no"
  local dn, dnState = nil, "no"
  if CFG.ENABLE_LASTHIT then lh, lhState = bestLastHit(bot) end
  if CFG.ENABLE_DENY then dn, dnState = bestDeny(bot) end

  -- هر دو آماده => انتخاب بر اساس ارزش
  if lhState == "now" and dnState == "now" then
    if denyValue(dn) > 1.0 then attackUnit(bot, dn) else attackUnit(bot, lh) end
    return true
  end
  if dnState == "now" then attackUnit(bot, dn); return true end
  if lhState == "now" then attackUnit(bot, lh); return true end

  -- نزدیک شدن برای رسیدن به کریپی که الان می‌میرد
  if dnState == "step" and dn ~= nil then
    local loc = call(dn, "GetLocation")
    if loc ~= nil then
      moveTo(bot, towards(call(bot, "GetLocation"), loc, 160))
      return true
    end
  end
  if lhState == "step" and lh ~= nil then
    local loc = call(lh, "GetLocation")
    if loc ~= nil then
      moveTo(bot, towards(call(bot, "GetLocation"), loc, 160))
      return true
    end
  end
  return false
end

-- آیا همین حالا لست‌هیت/دنای قابل زدن با ضربه‌ی معمولی داریم؟
local function immediateSecureAvailable(bot)
  if CFG.ENABLE_LASTHIT then
    local _, st = bestLastHit(bot)
    if st == "now" then return true end
  end
  if CFG.ENABLE_DENY then
    local _, st = bestDeny(bot)
    if st == "now" then return true end
  end
  return false
end

-- کمک اسکیل برای لست‌هیت/دنایی که با ضربه‌ی معمولی از دست می‌رود
local function abilityFarmAssist(bot, brain)
  if not CFG.ENABLE_ABILITIES then return false end
  if brain == nil or brain.OnFarmAssist == nil then return false end
  local mpP = pct(call(bot, "GetMana") or 0, call(bot, "GetMaxMana") or 1)
  if mpP < 0.45 then return false end

  -- کریپی که دقیقا بین دمیج ضربه و مرگ گیر کرده
  local creeps = call(bot, "GetNearbyLaneCreeps", 800, true) or {}
  for _, c in pairs(creeps) do
    local st = evaluateCreep(bot, c, false)
    if st == "late" or st == "no" then
      local t = strikeDelay(bot, c)
      local hp = predictedHealth(bot, c, t)
      local dmgLo = select(1, damageWindow(bot, c))
      if hp > dmgLo and hp <= dmgLo * 3.0 and hp > 0 then
        local ok = brain.OnFarmAssist(bot, c, false)
        if ok then return true end
      end
    end
  end
  local mine = call(bot, "GetNearbyLaneCreeps", 800, false) or {}
  for _, c in pairs(mine) do
    local hpP = pct(call(c, "GetHealth") or 0, call(c, "GetMaxHealth") or 1)
    if hpP <= CFG.DENY_HP_PCT then
      local t = strikeDelay(bot, c)
      local hp = predictedHealth(bot, c, t)
      local dmgLo = select(1, damageWindow(bot, c))
      if hp > dmgLo and hp <= dmgLo * 2.5 and hp > 0 then
        local ok = brain.OnFarmAssist(bot, c, true)
        if ok then return true end
      end
    end
  end
  return false
end

-- ===========================================================================
-- 17) LANE GEOMETRY  —  هندسه‌ی لاین، تعادل موج و کنترل ارگ
-- ===========================================================================

-- تبدیل یک نقطه به نسبت روی لاین میانی (0 = پایه‌ی رادیانت، 1 = پایه‌ی دایر)
local function laneFracOf(loc)
  if loc == nil then return 0.5 end
  local best, bestD = 0.5, 999999
  local f = 0.0
  while f <= 1.0 do
    local p = gcall(GetLocationAlongLane, LANE_MID, f)
    if p ~= nil then
      local d = dist2D(p, loc)
      if d < bestD then best, bestD = f, d end
    end
    f = f + 0.02
  end
  return best
end

-- «جلوی» موج: کریپ خودی/دشمن که بیشترین پیشروی را دارد
local function waveFront(bot)
  return cached("waveFront", function()
    local mine = call(bot, "GetNearbyLaneCreeps", 1500, false) or {}
    local theirs = call(bot, "GetNearbyLaneCreeps", 1500, true) or {}
    local myLoc, enLoc, n1, n2 = nil, nil, 0, 0
    for _, c in pairs(mine) do
      local l = call(c, "GetLocation")
      if l ~= nil then n1 = n1 + 1; myLoc = midpoint(myLoc, l) end
    end
    for _, c in pairs(theirs) do
      local l = call(c, "GetLocation")
      if l ~= nil then n2 = n2 + 1; enLoc = midpoint(enLoc, l) end
    end
    return { mine = myLoc, theirs = enLoc, nMine = n1, nTheirs = n2,
             contact = midpoint(myLoc, enLoc) }
  end)
end

-- نسبت لاینِ فعلیِ نبرد کریپ‌ها
local function contactFrac(bot)
  return cached("contactFrac", function()
    local wf = waveFront(bot)
    if wf == nil or wf.contact == nil then return 0.5 end
    return laneFracOf(wf.contact)
  end)
end

-- نسبت آرمانی برای تعادل لاین (کمی سمت تاور خودی = امن‌ترین فارم)
local function desiredFrac()
  if myTeam() == TEAM_RADIANT then return 0.46 end
  return 0.54
end

-- آیا بیش از حد جلو رفته‌ایم؟
local function isOverextended(bot)
  local cf = contactFrac(bot)
  if myTeam() == TEAM_RADIANT then return cf > desiredFrac() + 0.045 end
  return cf < desiredFrac() - 0.045
end

-- تاور دشمن ما را می‌زند؟
local function underEnemyTower(bot)
  local towers = call(bot, "GetNearbyTowers", 1000, true) or {}
  for _, t in pairs(towers) do
    if call(t, "IsAlive") == true then
      local r = (call(t, "GetAttackRange") or 700) + 80
      if unitDist(bot, t) <= r then return true, t end
    end
  end
  return false, nil
end

-- نقطه‌ی ایستادن حرفه‌ای در لاین
local function laningPosition(bot)
  local wf = waveFront(bot)
  local home = homeLocation()
  local range = call(bot, "GetAttackRange") or 150
  local anchor = nil

  if wf ~= nil then anchor = wf.theirs or wf.contact or wf.mine end
  if anchor == nil then anchor = laneLoc(desiredFrac()) end

  -- فاصله‌ی امن: درست داخل برد حمله، سمت خانه
  local offset = clamp(range - 60, 130, 520)
  local stand = towards(anchor, home, offset)

  -- تنظیم برای خطر: هرچه تهدید بیشتر، عقب‌تر
  local hp = call(bot, "GetHealth") or 1
  local threat = threatLevel(bot, 2.0)
  if threat > hp * 0.55 then stand = towards(stand, home, 260) end
  if underEnemyTower(bot) then stand = towards(stand, home, 340) end

  return stand
end

-- کشیدن ارگ کریپ‌ها با ضربه به هیروی دشمن (اصلاح تعادل لاین)
local function pullCreepAggro(bot)
  if not isOverextended(bot) then return false end
  if (dtime() - S.aggroPullUntil) < 0 then return false end
  local range = call(bot, "GetAttackRange") or 150
  for _, e in pairs(visibleEnemies(bot, range + 40)) do
    if call(e, "IsMagicImmune") ~= true then
      attackUnit(bot, e)
      S.aggroPullUntil = dtime() + 1.2
      return true
    end
  end
  return false
end

-- آیا ضربه‌ی ما شلیک شده و می‌توانیم backswing را کنسل کنیم؟ (Orb Walk)
local function attackReleased(bot)
  local last = call(bot, "GetLastAttackTime")
  if last == nil then return false end
  local since = dtime() - last
  local wind = attackWindup(bot)
  return since >= wind and since < (call(bot, "GetSecondsPerAttack") or 1.7)
end

-- تعداد کریپ‌های دشمن که ما را هدف گرفته‌اند
local function creepsOnMe(bot)
  local n = 0
  local creeps = call(bot, "GetNearbyLaneCreeps", 900, true) or {}
  for _, c in pairs(creeps) do
    if call(c, "GetAttackTarget") == bot then n = n + 1 end
  end
  return n
end

-- ===========================================================================
-- 18) LANING BRAIN  —  مغز فاز لاین
-- ===========================================================================
local function nearestEnemyHero(bot, radius)
  local best, bestD = nil, radius + 1
  for _, e in pairs(visibleEnemies(bot, radius)) do
    local d = unitDist(bot, e)
    if d < bestD then best, bestD = e, d end
  end
  return best, bestD
end

-- آیا هرس کردن الان سود دارد؟
local function shouldHarass(bot, enemy)
  if not CFG.ENABLE_HARASS or enemy == nil then return false end
  local hpP = pct(call(bot, "GetHealth") or 1, call(bot, "GetMaxHealth") or 1)
  if hpP < CFG.HARASS_HP_MIN then return false end
  if pendingFarmWindow(bot) < 0.9 then return false end       -- لست‌هیت مقدم است
  if underEnemyTower(bot) then return false end

  local range = call(bot, "GetAttackRange") or 150
  if unitDist(bot, enemy) > range then return false end

  -- تریدینگ: دمیج ما در برابر دمیج برگشتی + دمیج کریپ‌ها
  local myDps = (call(bot, "GetAttackDamage") or 50) / math.max(call(bot, "GetSecondsPerAttack") or 1.7, 0.4)
  local hisDps = (call(enemy, "GetAttackDamage") or 50) / math.max(call(enemy, "GetSecondsPerAttack") or 1.7, 0.4)
  local creepPenalty = creepsOnMe(bot) * 22
  local score = myDps * CFG.HARASS_AGGRESSION - hisDps - creepPenalty

  -- اگر ملی هستیم و کریپ‌های دشمن روی ما هستند، هرس کردن ضرر است
  if not isRanged(bot) and creepsOnMe(bot) >= 2 then return false end
  return score > 0
end

-- کمبوی کشتن (اسکیل + آیتم + ضربه)
local function tryKillCombo(bot, brain, target)
  if target == nil then return false end
  if not CFG.ENABLE_ABILITIES then return false end
  if call(target, "IsIllusion") == true then return false end

  local hpP = pct(call(bot, "GetHealth") or 1, call(bot, "GetMaxHealth") or 1)
  local diving = underEnemyTower(bot)
  if diving and hpP < CFG.TOWER_DIVE_HP_PCT then return false end

  local killable = canKill(bot, target)
  if not killable then return false end

  if brain ~= nil and brain.OnCombat ~= nil then
    if brain.OnCombat(bot, target, { kill = true, diving = diving }) then return true end
  end
  if useOffensiveItems(bot, target) then return true end
  for _, e in pairs(castableAbilities(bot, false)) do
    if e.dmg > 0 and castOn(bot, e, target) then return true end
  end
  attackUnit(bot, target)
  return true
end

local function laningThink(bot, brain)
  local enemy, enemyDist = nearestEnemyHero(bot, 1400)

  -- ۱) فرصت کشتن
  if enemy ~= nil and enemyDist < 1100 then
    if tryKillCombo(bot, brain, enemy) then return true end
  end

  -- ۲) لست‌هیت / دنای (بالاترین اولویت اقتصادی)
  --    اول ضربه‌ی معمولی (مانا مصرف نمی‌کند)، بعد کمک اسکیل
  if immediateSecureAvailable(bot) then
    if executeFarming(bot) then return true end
  end
  if abilityFarmAssist(bot, brain) then return true end
  if executeFarming(bot) then return true end

  -- ۳) هرس (اول اسکیل مخصوص هیرو، بعد ضربه)
  if enemy ~= nil and shouldHarass(bot, enemy) then
    local mpP = pct(call(bot, "GetMana") or 0, call(bot, "GetMaxMana") or 1)
    if CFG.ENABLE_ABILITIES and mpP > CFG.HARASS_MANA_MIN and brain ~= nil and brain.OnLaneHarass ~= nil then
      if brain.OnLaneHarass(bot, enemy, { creepsOnMe = creepsOnMe(bot) }) then return true end
    end
    attackUnit(bot, enemy)
    return true
  end

  -- ۴) اصلاح تعادل لاین با کشیدن ارگ
  if pullCreepAggro(bot) then return true end

  -- ۵) موقعیت‌گیری (و کنسل کردن backswing)
  local stand = laningPosition(bot)
  if CFG.ORB_WALK and attackReleased(bot) then
    moveTo(bot, stand)
    return true
  end
  local myLoc = call(bot, "GetLocation")
  if myLoc ~= nil and stand ~= nil and dist2D(myLoc, stand) > 90 then
    moveTo(bot, stand)
    return true
  end
  return false
end

-- ===========================================================================
-- 19) RUNES  —  کنترل رون
-- ===========================================================================
local function runeList()
  local list = {}
  local candidates = { RUNE_POWERUP_1, RUNE_POWERUP_2, RUNE_POWERUP_3, RUNE_POWERUP_4,
                       RUNE_BOUNTY_1, RUNE_BOUNTY_2, RUNE_BOUNTY_3, RUNE_BOUNTY_4 }
  for _, r in pairs(candidates) do
    if r ~= nil then list[#list + 1] = r end
  end
  return list
end

local function isPowerRune(r)
  return r == RUNE_POWERUP_1 or r == RUNE_POWERUP_2 or r == RUNE_POWERUP_3 or r == RUNE_POWERUP_4
end

-- بهترین رونی که باید برویم سراغش
local function pickRune(bot)
  local now = dtime()
  local best, bestScore = nil, -1
  for _, r in pairs(runeList()) do
    local loc = gcall(GetRuneSpawnLocation, r)
    if loc ~= nil then
      local d = locDist(bot, loc)
      if d <= CFG.RUNE_MAX_TRAVEL then
        local status = gcall(GetRuneStatus, r)
        local spawn = gcall(GetRuneSpawnTime, r) or 0
        local eta = d / math.max(call(bot, "GetMoveSpeed") or 300, 100)
        local ready = (status == RUNE_STATUS_AVAILABLE)
        local soon = (spawn - now) <= CFG.RUNE_PREP_TIME and (spawn - now) > -1
        if ready or soon then
          local score = 1000 - d * 0.2
          if isPowerRune(r) then score = score + 400 end
          if ready then score = score + 250 end
          -- اگر باتل خالی داریم، رون ارزش بیشتری دارد
          local b = getItem(bot, "item_bottle")
          if b ~= nil and (call(b, "GetCurrentCharges") or 0) == 0 then score = score + 300 end
          if eta > (spawn - now) + 6 then score = score - 400 end
          if score > bestScore then best, bestScore = r, score end
        end
      end
    end
  end
  return best
end

local function runeThink(bot)
  if not CFG.ENABLE_RUNES then return false end
  local now = dtime()
  if now < 0 then return false end

  local r = S.runeTarget
  if r == nil or now > S.runeUntil then
    r = pickRune(bot)
    if r == nil then S.runeTarget = nil; return false end
    S.runeTarget = r
    S.runeUntil = now + 16
  end

  local loc = gcall(GetRuneSpawnLocation, r)
  if loc == nil then S.runeTarget = nil; return false end

  -- خطر بالای رون؟ بی‌خیال شو
  if threatLevel(bot, 2.0) > (call(bot, "GetHealth") or 1) * 0.9 then
    S.runeTarget = nil
    return false
  end

  local d = locDist(bot, loc)
  if d < 220 and gcall(GetRuneStatus, r) == RUNE_STATUS_AVAILABLE then
    call(bot, "Action_PickUpRune", r)
    S.runeTarget = nil
    return true
  end
  if d > 180 then
    moveTo(bot, loc)
    return true
  end
  -- منتظر اسپاون
  local spawn = gcall(GetRuneSpawnTime, r) or 0
  if (spawn - now) < 3.0 then
    moveTo(bot, loc)
    return true
  end
  S.runeTarget = nil
  return false
end

-- ===========================================================================
-- 20) SAFETY  —  بقا، عقب‌نشینی، TP، بای‌بک
-- ===========================================================================
local function fountainLoc()
  local l = gcall(GetShopLocation, myTeam(), SHOP_HOME)
  if l ~= nil then return l end
  if myTeam() == TEAM_RADIANT then return laneLoc(0.02) end
  return laneLoc(0.98)
end

local function shouldRetreat(bot)
  local hp = call(bot, "GetHealth") or 1
  local maxHp = call(bot, "GetMaxHealth") or 1
  local hpP = pct(hp, maxHp)
  if hpP < CFG.DANGER_HP_PCT then return true end
  local threat = threatLevel(bot, 2.5)
  if threat > hp * 0.95 then return true end
  if hpP < CFG.RETREAT_HP_PCT and #visibleEnemies(bot, 1300) >= 1 then return true end
  -- خطر گنک: چند دشمن گم شده‌اند و ما جلو هستیم
  if isOverextended(bot) and missingEnemyCount() >= 2 and hpP < 0.6 then return true end
  return false
end

local function useTpHome(bot)
  local tp = itemUsable(bot, "item_tpscroll") or itemUsable(bot, "item_travel_boots")
             or itemUsable(bot, "item_travel_boots_2")
  if tp == nil then return false end
  if call(bot, "WasRecentlyDamagedByAnyHero", 2.0) == true then return false end
  local t = ownTowerMid1()
  local loc = nil
  if t ~= nil and call(t, "IsAlive") == true then loc = call(t, "GetLocation") end
  if loc == nil then loc = fountainLoc() end
  if loc == nil then return false end
  if locDist(bot, loc) < 1500 then return false end
  call(bot, "Action_UseAbilityOnLocation", tp, loc)
  S.lastTpUse = dtime()
  return true
end

local function retreatThink(bot, brain)
  if not CFG.ENABLE_ESCAPE then return false end
  if useDefensiveItems(bot) then return true end
  if brain ~= nil and brain.OnEscape ~= nil then
    if brain.OnEscape(bot, { threat = threatLevel(bot, 2.5) }) then return true end
  end
  if useEscapeItems(bot) then return true end

  local hpP = pct(call(bot, "GetHealth") or 1, call(bot, "GetMaxHealth") or 1)
  if hpP < 0.55 and #visibleEnemies(bot, 1400) == 0 and useTpHome(bot) then return true end
  if useRegen(bot) then return true end

  local home = homeLocation()
  local t = ownTowerMid1()
  if t ~= nil and call(t, "IsAlive") == true then home = call(t, "GetLocation") end
  if hpP < 0.25 then home = fountainLoc() end
  moveTo(bot, home)
  return true
end

local function handleDeath(bot)
  if call(bot, "IsAlive") == true then return false end
  -- بای‌بک فقط وقتی بازی در خطر است
  if dtime() > 25 * 60 then
    local respawn = call(bot, "GetRespawnTime") or 0
    local gold = call(bot, "GetGold") or 0
    local cost = call(bot, "GetBuybackCost") or 99999
    local ancient = gcall(GetAncient, myTeam())
    local danger = ancient ~= nil and call(ancient, "WasRecentlyDamagedByAnyHero", 8.0) == true
    if danger and respawn > 25 and gold >= cost then
      call(bot, "ActionImmediate_Buyback")
    end
  end
  return true
end

-- ===========================================================================
-- 21) TEAMFIGHT  —  انتخاب هدف و جنگ تیمی
-- ===========================================================================
-- امتیاز هدف: تهدید بالا + جان کم + نزدیک = بهترین هدف
local function scoreTarget(bot, e)
  local ehp = effectiveHP(e)
  local threat = threatFrom(e, bot, 3.0)
  local d = unitDist(bot, e)
  local score = (threat + 120) / math.max(ehp, 1) * 1000
  score = score - d * 0.25
  if canKill(bot, e) then score = score + 900 end
  if call(e, "IsChanneling") == true then score = score + 400 end
  if call(e, "IsMagicImmune") == true then score = score - 350 end
  if call(e, "IsIllusion") == true then score = score - 5000 end
  local hpP = pct(call(e, "GetHealth") or 1, call(e, "GetMaxHealth") or 1)
  score = score + (1 - hpP) * 500
  return score
end

local function bestTarget(bot, radius)
  local best, bestScore = nil, -99999
  for _, e in pairs(visibleEnemies(bot, radius)) do
    local s = scoreTarget(bot, e)
    if s > bestScore then best, bestScore = e, s end
  end
  return best
end

local function teamfightThink(bot, brain)
  local target = bestTarget(bot, CFG.TEAMFIGHT_RADIUS)
  if target == nil then return false end

  local allies = #nearbyAllies(bot, 1200) + 1
  local enemies = #visibleEnemies(bot, 1200)
  local hpP = pct(call(bot, "GetHealth") or 1, call(bot, "GetMaxHealth") or 1)

  -- نبرد نابرابر و بدون فرصت کشتن => عقب
  if enemies > allies + 1 and not canKill(bot, target) and hpP < 0.75 then
    return false
  end

  if useBKB(bot) then return true end
  if brain ~= nil and brain.OnCombat ~= nil then
    if brain.OnCombat(bot, target, { kill = canKill(bot, target), teamfight = enemies >= 2 }) then
      return true
    end
  end
  if CFG.ENABLE_ITEMS and useOffensiveItems(bot, target) then return true end
  if CFG.ENABLE_ABILITIES then
    for _, e in pairs(castableAbilities(bot, true)) do
      if e.dmg > 0 and castOn(bot, e, target) then return true end
    end
  end

  local range = call(bot, "GetAttackRange") or 150
  if unitDist(bot, target) <= range + 250 then
    attackUnit(bot, target)
  else
    local myLoc = call(bot, "GetLocation")
    local tLoc = call(target, "GetLocation")
    if myLoc ~= nil and tLoc ~= nil and dist2D(myLoc, tLoc) < CFG.CHASE_MAX_DISTANCE then
      moveTo(bot, tLoc)
    else
      return false
    end
  end
  return true
end

-- ===========================================================================
-- 22) MID GAME  —  دیفنس با TP، گنک، پوش، فارم، روشان
-- ===========================================================================
local function ourBuildings()
  local list = {}
  local towers = { TOWER_MID_1, TOWER_MID_2, TOWER_MID_3, TOWER_TOP_1, TOWER_TOP_2,
                   TOWER_TOP_3, TOWER_BOT_1, TOWER_BOT_2, TOWER_BOT_3 }
  for _, id in pairs(towers) do
    local t = gcall(GetTower, myTeam(), id)
    if t ~= nil and call(t, "IsAlive") == true then list[#list + 1] = t end
  end
  return list
end

local function defendThink(bot)
  if not CFG.ENABLE_TP_DEFEND then return false end
  local now = dtime()
  for _, t in pairs(ourBuildings()) do
    if call(t, "WasRecentlyDamagedByAnyHero", CFG.DEFEND_TP_TIME) == true then
      local loc = call(t, "GetLocation")
      if loc ~= nil then
        local d = locDist(bot, loc)
        local hpP = pct(call(bot, "GetHealth") or 1, call(bot, "GetMaxHealth") or 1)
        if hpP < 0.5 then return false end
        if d > 2500 then
          local tp = itemUsable(bot, "item_tpscroll") or itemUsable(bot, "item_travel_boots")
                     or itemUsable(bot, "item_travel_boots_2")
          if tp ~= nil and call(bot, "WasRecentlyDamagedByAnyHero", 3.0) ~= true then
            call(bot, "Action_UseAbilityOnLocation", tp, loc)
            S.lastTpUse = now
            return true
          end
        elseif d > 600 then
          moveTo(bot, loc)
          return true
        end
      end
    end
  end
  return false
end

local function gankThink(bot, brain)
  if not CFG.ENABLE_GANK then return false end
  if (call(bot, "GetLevel") or 1) < CFG.GANK_MIN_LEVEL then return false end
  local hpP = pct(call(bot, "GetHealth") or 1, call(bot, "GetMaxHealth") or 1)
  local mpP = pct(call(bot, "GetMana") or 0, call(bot, "GetMaxMana") or 1)
  if hpP < 0.6 or mpP < 0.5 then return false end

  local best, bestScore = nil, 0
  for _, e in pairs(enemyHeroes()) do
    if call(e, "IsAlive") == true and call(e, "CanBeSeen") == true then
      local d = unitDist(bot, e)
      if d < 3200 then
        local eHpP = pct(call(e, "GetHealth") or 1, call(e, "GetMaxHealth") or 1)
        local alliesNear = #nearbyAllies(e, 900)
        local enemiesNear = #visibleEnemies(e, 900)
        local score = (1 - eHpP) * 100 + alliesNear * 40 - enemiesNear * 45 - d * 0.02
        if canKill(bot, e) then score = score + 120 end
        if score > bestScore then best, bestScore = e, score end
      end
    end
  end
  if best == nil then return false end

  local d = unitDist(bot, best)
  if d < CFG.TEAMFIGHT_RADIUS then
    if teamfightThink(bot, brain) then return true end
  end
  local loc = call(best, "GetLocation")
  if loc ~= nil then moveTo(bot, loc); return true end
  return false
end

local function pushThink(bot)
  if not CFG.ENABLE_PUSH then return false end
  local hpP = pct(call(bot, "GetHealth") or 1, call(bot, "GetMaxHealth") or 1)
  if hpP < 0.6 then return false end
  if #visibleEnemies(bot, 1400) > #nearbyAllies(bot, 1400) then return false end

  local towers = call(bot, "GetNearbyTowers", 1300, true) or {}
  for _, t in pairs(towers) do
    if call(t, "IsAlive") == true then
      local myCreeps = call(bot, "GetNearbyLaneCreeps", 900, false) or {}
      if #myCreeps >= 2 then
        attackUnit(bot, t)
        return true
      end
    end
  end
  return false
end

local function roshanThink(bot, brain)
  if not CFG.ENABLE_ROSHAN then return false end
  if dtime() < CFG.ROSHAN_MIN_TIME then return false end
  local rosh = gcall(GetRoshan)
  if rosh == nil or call(rosh, "IsAlive") ~= true or call(rosh, "CanBeSeen") ~= true then return false end
  if unitDist(bot, rosh) > 1600 then return false end
  if #nearbyAllies(bot, 1200) + 1 < CFG.ROSHAN_MIN_ALLIES then return false end
  local hpP = pct(call(bot, "GetHealth") or 1, call(bot, "GetMaxHealth") or 1)
  if hpP < 0.7 then return false end
  attackUnit(bot, rosh)
  return true
end

local function farmThink(bot, brain)
  -- ۱) کریپ‌های لاین نزدیک
  if immediateSecureAvailable(bot) then
    if executeFarming(bot) then return true end
  end
  if abilityFarmAssist(bot, brain) then return true end
  if executeFarming(bot) then return true end

  local creeps = call(bot, "GetNearbyLaneCreeps", 1000, true) or {}
  if #creeps > 0 then
    local best, bestHp = nil, 999999
    for _, c in pairs(creeps) do
      local hp = call(c, "GetHealth") or 0
      if hp < bestHp then best, bestHp = c, hp end
    end
    if best ~= nil then attackUnit(bot, best); return true end
  end

  -- ۲) کمپ خنثی
  local neutrals = call(bot, "GetNearbyNeutralCreeps", 900) or {}
  if #neutrals > 0 then
    local hpP = pct(call(bot, "GetHealth") or 1, call(bot, "GetMaxHealth") or 1)
    if hpP > 0.55 then
      local best, bestHp = nil, 999999
      for _, c in pairs(neutrals) do
        local hp = call(c, "GetHealth") or 0
        if hp < bestHp then best, bestHp = c, hp end
      end
      if best ~= nil then attackUnit(bot, best); return true end
    end
  end

  -- ۳) حرکت به سمت موج بعدی در مید
  local frac = desiredFrac()
  if (call(bot, "GetLevel") or 1) >= 7 then
    if myTeam() == TEAM_RADIANT then frac = 0.55 else frac = 0.45 end
  end
  attackMove(bot, laneLoc(frac))
  return true
end

-- ===========================================================================
-- 23) MAIN THINK  —  حلقه‌ی اصلی تصمیم‌گیری
-- ===========================================================================
local function preGameThink(bot)
  handlePurchasing(bot)
  handleLeveling(bot, S.brain)
  local frac = desiredFrac()
  local target = laneLoc(frac)
  if myTeam() == TEAM_RADIANT then target = laneLoc(0.38) else target = laneLoc(0.62) end
  moveTo(bot, target)
end

function Core.Think(bot, brain)
  if bot == nil then return end
  refreshSettings()
  S.brain = brain

  if not CFG.MASTER then
    -- حالت خاموش: فقط فارم ساده (تا بات بی‌حرکت نماند)
    attackMove(bot, laneLoc(desiredFrac()))
    return
  end
  if CFG.MID_ONLY and not isMidLane(bot) then
    attackMove(bot, laneLoc(desiredFrac()))
    return
  end
  if handleDeath(bot) then return end
  if isDisabled(bot) then return end

  -- کارهای «آنی» که نیازی به لغو حرکت ندارند
  if CFG.ENABLE_ITEMS then handleCourier(bot) end
  handlePurchasing(bot)
  handleLeveling(bot, brain)
  if brain ~= nil and brain.OnTick ~= nil then brain.OnTick(bot) end

  if gcall(GetGameState) ~= GAME_STATE_GAME_IN_PROGRESS and dtime() < 0 then
    preGameThink(bot)
    return
  end

  if isBusy(bot) then return end

  -- اولویت ۱: بقا
  if shouldRetreat(bot) then
    if retreatThink(bot, brain) then return end
  end
  if CFG.ENABLE_ITEMS and useDefensiveItems(bot) then return end

  -- اولویت ۲: رجن در شرایط امن
  if #visibleEnemies(bot, 1200) == 0 and useRegen(bot) then return end

  -- اولویت ۳: رون
  if runeThink(bot) then return end

  -- اولویت ۴: دیفنس اضطراری با TP
  if defendThink(bot) then return end

  -- اولویت ۵: فاز لاین
  -- (فاز لاین بر تیم‌فایت مقدم است؛ وگرنه حضور همیشگی میدلینر حریف باعث
  --  می‌شود بات به‌جای لست‌هیت مدام دنبال جنگ برود. کیل‌کمبو داخل خود
  --  laningThink انجام می‌شود و درگیری چندنفره پایین‌تر مدیریت می‌گردد.)
  local level = call(bot, "GetLevel") or 1
  local laningPhase = dtime() < 11 * 60 or level < 9
  local multiEnemy = #visibleEnemies(bot, 1200) >= 2
  if laningPhase and isMidLane(bot) and not multiEnemy then
    if laningThink(bot, brain) then return end
  end

  -- اولویت ۶: نبرد
  if teamfightThink(bot, brain) then return end

  -- اولویت ۷: بازی میانی
  if roshanThink(bot, brain) then return end
  if gankThink(bot, brain) then return end
  if pushThink(bot) then return end
  farmThink(bot, brain)
end

-- ===========================================================================
-- 24) EXPORTS  —  ابزارهایی که مغزهای هیرو استفاده می‌کنند
-- ===========================================================================
Core.call            = call
Core.gcall           = gcall
Core.log             = log
Core.clamp           = clamp
Core.pct             = pct
Core.dist2D          = dist2D
Core.unitDist        = unitDist
Core.locDist         = locDist
Core.towards         = towards
Core.midpoint        = midpoint
Core.dtime           = dtime
Core.myTeam          = myTeam
Core.enemyTeam       = enemyTeam
Core.enemyHeroes     = enemyHeroes
Core.allyHeroes      = allyHeroes
Core.visibleEnemies  = visibleEnemies
Core.nearbyAllies    = nearbyAllies
Core.homeLocation    = homeLocation
Core.laneLoc         = laneLoc
Core.fountainLoc     = fountainLoc
Core.getItem         = getItem
Core.hasItem         = hasItem
Core.itemUsable      = itemUsable
Core.attackUnit      = attackUnit
Core.moveTo          = moveTo
Core.attackMove      = attackMove
Core.isBusy          = isBusy
Core.isDisabled      = isDisabled
Core.threatLevel     = threatLevel
Core.threatFrom      = threatFrom
Core.effectiveHP     = effectiveHP
Core.canKill         = canKill
Core.burstDamage     = burstDamage
Core.predictLoc      = predictLoc
Core.predictedHealth = predictedHealth
Core.damageWindow    = damageWindow
Core.strikeDelay     = strikeDelay
Core.bestTarget      = bestTarget
Core.underEnemyTower = underEnemyTower
Core.creepsOnMe      = creepsOnMe
Core.isOverextended  = isOverextended
Core.contactFrac     = contactFrac
Core.waveFront       = waveFront
Core.useOffensiveItems = useOffensiveItems
Core.useEscapeItems  = useEscapeItems
Core.castableAbilities = castableAbilities
Core.castOn          = castOn
Core.hasBehavior     = hasBehavior
Core.State           = S

return Core
