-- شبیه‌ساز حداقلی API بات دوتا برای تست دود (smoke test)
-- تست دود: اسکریپت را با یک API ساختگی اجرا می‌کند تا از نبود خطای زمان اجرا
-- مطمئن شویم (بدون نیاز به باز کردن بازی).   اجرا:  lua5.4 tests/mock_run.lua
local DIR = (arg and arg[0] and arg[0]:match("^(.*)/tests/[^/]+$")) or "."
package.path = "?.lua;" .. package.path
function GetScriptDirectory() return DIR end

-- constants -----------------------------------------------------------------
TEAM_RADIANT, TEAM_DIRE = 2, 3
LANE_MID, LANE_TOP, LANE_BOT = 2, 1, 3
TOWER_MID_1, TOWER_MID_2, TOWER_MID_3 = 1, 2, 3
TOWER_TOP_1, TOWER_TOP_2, TOWER_TOP_3 = 4, 5, 6
TOWER_BOT_1, TOWER_BOT_2, TOWER_BOT_3 = 7, 8, 9
DAMAGE_TYPE_PHYSICAL, DAMAGE_TYPE_MAGICAL, DAMAGE_TYPE_ALL = 1, 2, 3
ATTRIBUTE_STRENGTH, ATTRIBUTE_AGILITY, ATTRIBUTE_INTELLECT = 0, 1, 2
ABILITY_BEHAVIOR_NO_TARGET, ABILITY_BEHAVIOR_UNIT_TARGET = 4, 8
ABILITY_BEHAVIOR_POINT, ABILITY_BEHAVIOR_PASSIVE = 16, 2
ABILITY_BEHAVIOR_CHANNELLED, ABILITY_BEHAVIOR_TOGGLE = 4096, 512
ABILITY_CAN_BE_UPGRADED = 1
GAME_STATE_GAME_IN_PROGRESS, GAME_STATE_PRE_GAME = 5, 4
UNIT_LIST_ENEMY_HEROES, UNIT_LIST_ALLIED_HEROES, UNIT_LIST_ALLIED_CREEPS = 1, 2, 3
RUNE_POWERUP_1, RUNE_POWERUP_2, RUNE_BOUNTY_1, RUNE_BOUNTY_2 = 1, 2, 3, 4
RUNE_STATUS_AVAILABLE, RUNE_STATUS_MISSING = 1, 2
SHOP_HOME = 0
PURCHASE_ITEM_SUCCESS, PURCHASE_ITEM_NOT_AT_SECRET_SHOP, PURCHASE_ITEM_OUT_OF_STOCK = 0, 1, 2
COURIER_STATE_IDLE, COURIER_STATE_AT_BASE = 0, 1
COURIER_ACTION_TAKE_STASH_AND_TRANSFER_ITEMS, COURIER_ACTION_SECRET_SHOP = 1, 2

local T = 0
function DotaTime() return T end
function GameTime() return T + 90 end
function GetTeam() return TEAM_RADIANT end
function GetGameState() return GAME_STATE_GAME_IN_PROGRESS end
function Vector(x, y, z) return { x = x or 0, y = y or 0, z = z or 0 } end
function GetLocationAlongLane(lane, f) return Vector(-6000 + 12000 * f, -6000 + 12000 * f, 0) end
function IsLocationPassable(l) return true end
function GetShopLocation(team, shop) return Vector(-7000, -7000, 0) end
function GetItemCost(name) return 500 end
function GetCourier(i) return nil end
function GetCourierState(c) return COURIER_STATE_IDLE end
function GetRuneSpawnLocation(r) return Vector(0, 500, 0) end
function GetRuneStatus(r) return RUNE_STATUS_MISSING end
function GetRuneSpawnTime(r) return T + 60 end
function GetRoshan() return nil end
function GetAncient(t) return nil end
function RandomInt(a, b) return a end

local function dist(a, b)
  if a == nil or b == nil then return 99999 end
  local dx, dy = a.x - b.x, a.y - b.y
  return math.sqrt(dx * dx + dy * dy)
end
function GetUnitToUnitDistance(a, b) return dist(a:GetLocation(), b:GetLocation()) end
function GetUnitToLocationDistance(u, l) return dist(u:GetLocation(), l) end

-- unit factory ---------------------------------------------------------------
local function makeAbility(name, level, behavior, dmg)
  local a = {}
  function a:GetName() return name end
  function a:GetLevel() return level end
  function a:IsHidden() return false end
  function a:IsPassive() return false end
  function a:IsFullyCastable() return level > 0 end
  function a:GetCooldownTimeRemaining() return 0 end
  function a:GetManaCost() return 100 end
  function a:GetCastRange() return 700 end
  function a:GetCastPoint() return 0.3 end
  function a:GetBehavior() return behavior or ABILITY_BEHAVIOR_POINT end
  function a:GetAbilityDamage() return dmg or 150 end
  function a:GetSpecialValueInt(k) return 400 end
  function a:GetSpecialValueFloat(k) return 0.7 end
  function a:CanAbilityBeUpgraded() return ABILITY_CAN_BE_UPGRADED end
  function a:GetCurrentCharges() return 3 end
  return a
end

local function makeUnit(opts)
  local u = {}
  local o = opts or {}
  u.__loc = o.loc or Vector(0, 0, 0)
  function u:GetLocation() return self.__loc end
  function u:GetUnitName() return o.name or "npc_dota_creep_lane" end
  function u:IsAlive() return o.alive ~= false end
  function u:IsNull() return false end
  function u:CanBeSeen() return o.seen ~= false end
  function u:IsIllusion() return false end
  function u:IsMagicImmune() return false end
  function u:IsStunned() return false end
  function u:IsHexed() return false end
  function u:IsNightmared() return false end
  function u:IsRooted() return false end
  function u:IsSilenced() return false end
  function u:IsChanneling() return false end
  function u:IsCastingAbility() return false end
  function u:IsUsingAbility() return false end
  function u:GetHealth() return o.hp or 550 end
  function u:GetMaxHealth() return o.maxHp or 550 end
  function u:GetMana() return o.mana or 400 end
  function u:GetMaxMana() return o.maxMana or 700 end
  function u:GetHealthRegen() return 2.0 end
  function u:GetActualIncomingDamage(d, t) return d * 0.75 end
  function u:GetEstimatedDamageToTarget(a, b, c, d) return 200 end
  function u:GetAttackDamage() return o.dmg or 55 end
  function u:GetBaseDamage() return 45 end
  function u:GetBaseDamageVariance() return 6 end
  function u:GetAttackRange() return o.range or 500 end
  function u:GetAttackPoint() return 0.35 end
  function u:GetAttackSpeed() return 1.1 end
  function u:GetSecondsPerAttack() return 1.6 end
  function u:GetAttackProjectileSpeed() return 900 end
  function u:GetLastAttackTime() return T - 1.0 end
  function u:GetAttackTarget() return o.attackTarget end
  function u:GetMoveSpeed() return 300 end
  function u:GetLevel() return o.level or 6 end
  function u:GetAbilityPoints() return o.points or 1 end
  function u:GetPrimaryAttribute() return ATTRIBUTE_INTELLECT end
  function u:GetGold() return o.gold or 900 end
  function u:GetStashValue() return 0 end
  function u:GetRespawnTime() return 20 end
  function u:GetBuybackCost() return 2000 end
  function u:GetAssignedLane() return LANE_MID end
  function u:HasModifier(m) return false end
  function u:GetIncomingTrackingProjectiles()
    return { { location = Vector(200, 0, 0), move_speed = 900, is_attack = true, is_dodgeable = true, caster = nil } }
  end
  function u:GetExtrapolatedLocation(d) return self.__loc end
  function u:GetNearbyTrees(r) return { 1, 2 } end
  function u:GetItemInSlot(i) return nil end
  function u:GetAbilityByName(n) return makeAbility(n, 2) end
  function u:GetAbilityInSlot(i)
    if i > 3 then return nil end
    return makeAbility("mock_ability_" .. i, 2)
  end
  function u:GetNearbyLaneCreeps(r, enemy) return o.creeps or {} end
  function u:GetNearbyCreeps(r, enemy) return o.creeps or {} end
  function u:GetNearbyNeutralCreeps(r) return {} end
  function u:GetNearbyTowers(r, enemy) return {} end
  function u:GetNearbyHeroes(r, enemy, mode) return {} end
  function u:WasRecentlyDamagedByAnyHero(t) return o.damaged == true end
  function u:WasRecentlyDamagedByTower(t) return false end
  function u:WasRecentlyDamagedByCreep(t) return false end
  function u:DistanceFromFountain() return 5000 end
  -- actions
  local function noop() end
  for _, m in ipairs({ "Action_AttackUnit", "Action_MoveToLocation", "Action_AttackMove",
    "Action_UseAbility", "Action_UseAbilityOnEntity", "Action_UseAbilityOnLocation",
    "Action_UseAbilityOnTree", "Action_PickUpRune", "Action_ClearActions", "Action_Delay",
    "ActionImmediate_LevelAbility", "ActionImmediate_Courier", "ActionImmediate_Chat",
    "ActionImmediate_Buyback", "SetNextItemPurchaseValue", "ActionImmediate_Ping" }) do
    u[m] = noop
  end
  function u:ActionImmediate_PurchaseItem(n) return PURCHASE_ITEM_SUCCESS end
  return u
end

local creeps = {
  makeUnit({ name = "npc_dota_creep_lane", loc = Vector(300, 300, 0), hp = 40, maxHp = 550 }),
  makeUnit({ name = "npc_dota_creep_badguys_ranged", loc = Vector(360, 340, 0), hp = 120, maxHp = 300 }),
}
local enemyHero = makeUnit({ name = "npc_dota_hero_lina", loc = Vector(500, 500, 0), hp = 700, maxHp = 1200 })
local allyHero  = makeUnit({ name = "npc_dota_hero_lion", loc = Vector(-500, -500, 0) })

function GetUnitList(kind)
  if kind == UNIT_LIST_ENEMY_HEROES then return { enemyHero } end
  if kind == UNIT_LIST_ALLIED_HEROES then return { allyHero } end
  return {}
end
function GetTower(team, id)
  return makeUnit({ name = "tower", loc = Vector(-1500, -1500, 0) })
end

local bot = makeUnit({ name = "npc_dota_hero_puck", loc = Vector(0, 0, 0), hp = 900, maxHp = 1300,
                       creeps = creeps, range = 400 })
function GetBot() return bot end

-- run ------------------------------------------------------------------------
local Core = require(DIR .. "/mid_ai_core")
local brains = {}
for _, n in ipairs({ "ember_spirit", "puck", "earth_spirit", "storm_spirit" }) do
  brains[n] = require(DIR .. "/heroes/" .. n)
end

local counts = {}
for name, br in pairs(brains) do
  for _, hook in ipairs({ "OnCombat", "OnLaneHarass", "OnFarmAssist", "OnEscape", "OnTick" }) do
    local f = br[hook]
    if f ~= nil then
      br[hook] = function(...) counts[name .. "." .. hook] = (counts[name .. "." .. hook] or 0) + 1; return f(...) end
    end
  end
end

local scenarios = {
  { name = "laning",    hp = 900,  damaged = false },
  { name = "harass",    hp = 1250, damaged = false, close = true },
  { name = "retreat",   hp = 200,  damaged = true  },
  { name = "teamfight", hp = 1100, damaged = true  },
}

local errors = 0
for _, br in pairs({ "ember_spirit", "puck", "earth_spirit", "storm_spirit" }) do
  for _, sc in ipairs(scenarios) do
    if sc.close then
      enemyHero.__loc = Vector(150, 150, 0)
      enemyHero.GetHealth = function() return 5000 end
      enemyHero.GetMaxHealth = function() return 6000 end
      creeps[1].GetHealth = function() return 130 end
    else
      enemyHero.__loc = Vector(500, 500, 0)
      enemyHero.GetHealth = function() return 700 end
      creeps[1].GetHealth = function() return 40 end
    end
    bot.GetHealth = function() return sc.hp end
    bot.WasRecentlyDamagedByAnyHero = function() return sc.damaged end
    for step = 1, 12 do
      T = T + 0.5
      local ok, err = pcall(Core.Think, bot, brains[br])
      if not ok then
        errors = errors + 1
        print("ERROR [" .. br .. "/" .. sc.name .. "]: " .. tostring(err))
        break
      end
    end
  end
end

-- حالت مرگ و پیش از بازی
bot.IsAlive = function() return false end
local ok, err = pcall(Core.Think, bot, brains["puck"])
if not ok then errors = errors + 1; print("ERROR [dead]: " .. tostring(err)) end
bot.IsAlive = function() return true end
T = -30
local ok2, err2 = pcall(Core.Think, bot, brains["storm_spirit"])
if not ok2 then errors = errors + 1; print("ERROR [pregame]: " .. tostring(err2)) end

local keys = {}
for k in pairs(counts) do keys[#keys+1] = k end
table.sort(keys)
for _, k in ipairs(keys) do print(string.format("hook %-32s x%d", k, counts[k])) end

-- پاس دوم: API ناقص (بیشتر متدها حذف شده‌اند)
local strip = { "GetIncomingTrackingProjectiles", "GetActualIncomingDamage", "GetBaseDamage",
  "GetBaseDamageVariance", "GetAttackSpeed", "GetEstimatedDamageToTarget", "GetNearbyTowers",
  "GetNearbyNeutralCreeps", "GetAbilityInSlot", "GetStashValue", "GetLastAttackTime",
  "GetHealthRegen", "HasModifier", "GetExtrapolatedLocation", "GetNearbyTrees" }
for _, m in ipairs(strip) do bot[m] = nil end
GetLocationAlongLane = function() return nil end
GetRuneSpawnLocation = function() return nil end
GetTower = function() return nil end
T = 300
for _, br in ipairs({ "ember_spirit", "puck", "earth_spirit", "storm_spirit" }) do
  for step = 1, 8 do
    T = T + 0.5
    local ok, err = pcall(Core.Think, bot, brains[br])
    if not ok then errors = errors + 1; print("ERROR [degraded/" .. br .. "]: " .. tostring(err)); break end
  end
end

if errors == 0 then print("SMOKE TEST PASSED — no runtime errors") else print("FAILURES: " .. errors) end
