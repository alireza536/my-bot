// =====================================
// ذخیره‌سازی ماندگار لیست کاربرها
//
// این سرویس روی همون حساب Render، به‌صورت یه Key-Value
// (سازگار با Redis) جداگانه ساخته شده (takorg-bot-users)
// و مستقل از خودِ ربات دیپلوی/ری‌استارت می‌شه، پس دیتاش
// با دیپلوی‌های ربات از بین نمی‌ره.
//
// اگه متغیر محیطی REDIS_URL تنظیم نشده باشه، این ماژول
// بی‌سروصدا غیرفعال می‌مونه و ربات مثل قبل فقط با حافظهٔ
// موقت (RAM) کار می‌کنه — یعنی نبودش کرش نمی‌کنه.
// =====================================

const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || null;

const USERS_KEY = "takorg:bot:users";

let client = null;

if (REDIS_URL) {
  client = new Redis(REDIS_URL, {
    // اگه اتصال قطع شد، خودش دوباره تلاش کنه، ولی
    // اگه اصلاً وصل نشد، بقیهٔ ربات رو قفل نکنه
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });

  client.on("error", (err) => {
    console.error("⚠️ [Store] خطای اتصال Redis:", err.message);
  });
}

const isEnabled = Boolean(client);

// فقط فیلدهای سبک و ضروری رو نگه می‌داریم (نه کل آبجکت
// خام ووکامرس) تا حجم داده کوچیک بمونه.
function slimUser(userData) {
  return {
    telegramId: userData.telegramId,
    phone: userData.phone,
    role: userData.role,
    customerId: userData.customerId || null,
    firstName: userData.firstName || null,
    lastName: userData.lastName || null,
  };
}

// ذخیرهٔ کل Map کاربرها (فراخوانی بعد از هر تغییر)
async function saveUsers(usersMap) {
  if (!isEnabled) return;

  try {
    const plain = {};
    for (const [telegramId, userData] of usersMap.entries()) {
      plain[telegramId] = slimUser(userData);
    }

    await client.set(USERS_KEY, JSON.stringify(plain));
  } catch (err) {
    console.error(
      "⚠️ [Store] خطا در ذخیرهٔ کاربرها روی Redis:",
      err.message
    );
  }
}

// بارگذاری کاربرهای ذخیره‌شده موقع بالا اومدن ربات
async function loadUsers() {
  const map = new Map();

  if (!isEnabled) {
    console.log(
      "ℹ️ [Store] REDIS_URL تنظیم نشده؛ ماندگاری کاربرها غیرفعاله."
    );
    return map;
  }

  try {
    const raw = await client.get(USERS_KEY);

    if (!raw) return map;

    const plain = JSON.parse(raw);

    for (const key of Object.keys(plain)) {
      map.set(Number(key), plain[key]);
    }

    console.log(`👥 [Store] ${map.size} کاربر از Redis بارگذاری شد.`);
  } catch (err) {
    console.error(
      "⚠️ [Store] خطا در بارگذاری کاربرها از Redis:",
      err.message
    );
  }

  return map;
}

module.exports = { saveUsers, loadUsers, isEnabled };