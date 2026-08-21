--[[ ==========================================================================
  MID AI  —  منوی تنظیمات  (Settings Menu)
  ---------------------------------------------------------------------------
  این فایل «منوی تنظیمات» اسکریپت است. هر مقدار را می‌توانی تغییر بدهی.

  ★ اعمال تغییرات حین بازی (بدون ری‌استارت):
      این فایل را ذخیره کن و کلیدی که به دستور زیر بایند کرده‌ای را بزن:

          bind "F5" "dota_bot_reload_scripts"

  ★ کلیدهای پیشنهادی (در کنسول بازی یک‌بار وارد کن یا در autoexec.cfg بگذار):

      // اعمال تنظیمات جدید
      bind "F5" "dota_bot_reload_scripts"

      // پروفایل‌های آماده (فایل‌های cfg خودت را بساز و در آن‌ها
      // فقط دستور reload را صدا بزن؛ تغییر مقادیر از همین فایل انجام می‌شود)
      bind "F6" "exec mid_ai_aggressive; dota_bot_reload_scripts"
      bind "F7" "exec mid_ai_safe;       dota_bot_reload_scripts"

  ★ اگر محیط اجرای تو کانسول‌ور می‌سازد، این نام‌ها اولویت بالاتری دارند
    و بدون ری‌لود هم اعمال می‌شوند:
        mid_ai_master  mid_ai_lasthit  mid_ai_deny  mid_ai_harass
        mid_ai_abilities  mid_ai_items  mid_ai_runes  mid_ai_gank
        mid_ai_push  mid_ai_debug  mid_ai_aggression
    مثال:  bind "F8" "toggle mid_ai_harass 0 1"
  ========================================================================== ]]

return {
  -- ==== کلید اصلی =========================================================
  MASTER              = true,   -- خاموش/روشن کل اسکریپت
  MID_ONLY            = false,  -- فقط اگر لاین بات «مید» بود فعال شود
  DEBUG               = false,  -- لاگ در کنسول
  DEBUG_DRAW          = false,  -- رسم خطوط دیباگ

  -- ==== ماژول‌ها (هر کدام مستقل) ==========================================
  ENABLE_LASTHIT      = true,   -- لست‌هیت خودکار
  ENABLE_DENY         = true,   -- دنای خودکار
  ENABLE_HARASS       = true,   -- هرس حریف
  ENABLE_ABILITIES    = true,   -- استفاده از اسکیل‌ها
  ENABLE_ITEMS        = true,   -- استفاده از آیتم‌ها
  ENABLE_AUTO_BUY     = true,   -- خرید خودکار
  ENABLE_AUTO_LEVEL   = true,   -- لِوِل‌آپ خودکار مهارت‌ها و تلنت
  ENABLE_RUNES        = true,   -- کنترل رون
  ENABLE_GANK         = true,   -- گنک لاین‌های کناری
  ENABLE_PUSH         = true,   -- پوش تاور
  ENABLE_TP_DEFEND    = true,   -- دیفنس با TP
  ENABLE_ROSHAN       = true,   -- شرکت در روشان
  ENABLE_COURIER      = true,   -- مدیریت کوریر
  ENABLE_ESCAPE       = true,   -- فرار خودکار

  -- ==== فاز لاین ==========================================================
  LASTHIT_LEAD        = 0.10,   -- ثانیه؛ پیش‌بینی زودتر برای شلیک
  LASTHIT_SAFETY      = 0.94,   -- 1.0 = دقیق، کمتر = محتاط‌تر (رول پایین دمیج)
  DENY_HP_PCT         = 0.50,   -- آستانه‌ی دنای
  HARASS_HP_MIN       = 0.55,   -- زیر این HP هرس نکن
  HARASS_MANA_MIN     = 0.35,   -- زیر این مانا اسکیل هرس نزن
  HARASS_AGGRESSION   = 1.0,    -- 0 = پسیو ، 1 = متعادل ، 2 = خیلی تهاجمی
  RETREAT_HP_PCT      = 0.34,
  DANGER_HP_PCT       = 0.22,
  TOWER_DIVE_HP_PCT   = 0.72,
  LANE_EQ_TOLERANCE   = 260,
  CREEP_AGGRO_RANGE   = 500,
  ORB_WALK            = true,   -- کنسل انیمیشن و ریپوزیشن بین ضربه‌ها

  -- ==== رون ===============================================================
  RUNE_PREP_TIME      = 11.0,
  RUNE_MAX_TRAVEL     = 2600,

  -- ==== نبرد ==============================================================
  MANA_RESERVE_ESCAPE = 0.18,
  TEAMFIGHT_RADIUS    = 1400,
  CHASE_MAX_DISTANCE  = 1600,
  KILL_CONFIDENCE     = 1.05,

  -- ==== بازی میانی ========================================================
  GANK_MIN_LEVEL      = 6,
  DEFEND_TP_TIME      = 4.0,
  ROSHAN_MIN_TIME     = 15 * 60,
  ROSHAN_MIN_ALLIES   = 3,
}
