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
const SEEN_USERS_KEY = "takorg:bot:seen_users";

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

    if (!raw) {
      console.log("👥 [Store] هنوز هیچ کاربر ذخیره‌شده‌ای روی Redis نبود.");
      return map;
    }

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

// =====================================
// ثبت «همهٔ» کاربرهایی که تا حالا با ربات
// تعامل داشتن (نه فقط اونایی که شماره دادن)
// برای آمار و پیام همگانی
// =====================================

// یه بار در طول عمر پروسه، برای هر کاربر فقط یه‌بار
// درخواست نوشتن به Redis می‌فرستیم (نه هر پیام)
const recordedThisRun = new Set();

async function recordSeenUser(telegramId, info = {}) {
  if (!isEnabled) return;
  if (recordedThisRun.has(telegramId)) return;

  recordedThisRun.add(telegramId);

  try {
    // اگه قبلاً ثبت شده، تاریخ اولین بازدیدش رو نگه می‌داریم
    // و فقط آخرین بازدید رو آپدیت می‌کنیم.
    const existingRaw = await client.hget(SEEN_USERS_KEY, String(telegramId));
    const existing = existingRaw ? JSON.parse(existingRaw) : null;

    const now = new Date().toISOString();

    await client.hset(
      SEEN_USERS_KEY,
      String(telegramId),
      JSON.stringify({
        telegramId,
        firstName: info.firstName || null,
        lastName: info.lastName || null,
        username: info.username || null,
        firstSeenAt: existing?.firstSeenAt || now,
        lastSeenAt: now,
      })
    );
  } catch (err) {
    console.error(
      "⚠️ [Store] خطا در ثبت کاربر دیده‌شده:",
      err.message
    );
  }
}

// تعداد کل کاربرهای منحصربه‌فردی که تا حالا ربات رو
// استفاده کردن (برای دستور /stats)
async function getSeenUsersCount() {
  if (!isEnabled) return 0;

  try {
    return await client.hlen(SEEN_USERS_KEY);
  } catch (err) {
    console.error("⚠️ [Store] خطا در شمارش کاربرها:", err.message);
    return 0;
  }
}

// لیست آیدی تلگرام همهٔ کاربرهای دیده‌شده (برای /broadcast)
async function getAllSeenUserIds() {
  if (!isEnabled) return [];

  try {
    const ids = await client.hkeys(SEEN_USERS_KEY);
    return ids.map(Number);
  } catch (err) {
    console.error("⚠️ [Store] خطا در دریافت لیست کاربرها:", err.message);
    return [];
  }
}

// جزئیات کامل همهٔ کاربرهای دیده‌شده (برای آمار دقیق‌تر
// مثل تعداد کاربر جدید امروز/این هفته)
async function getSeenUsersDetailed() {
  if (!isEnabled) return [];

  try {
    const all = await client.hgetall(SEEN_USERS_KEY);
    return Object.values(all).map((raw) => JSON.parse(raw));
  } catch (err) {
    console.error(
      "⚠️ [Store] خطا در دریافت جزئیات کاربرها:",
      err.message
    );
    return [];
  }
}

// =====================================
// اشتراک «خبرم کن» برای محصولات ناموجود
// یه Hash توی Redis: کلید = شناسهٔ محصول،
// مقدار = آرایه‌ای از آیدی‌های تلگرام منتظر
// =====================================

const STOCK_WATCH_KEY = "takorg:bot:stock_watch";

// اضافه کردن یه کاربر به لیست منتظرهای یه محصول
async function addStockWatcher(productId, telegramId) {
  if (!isEnabled) return false;

  try {
    const raw = await client.hget(STOCK_WATCH_KEY, String(productId));
    const watchers = raw ? JSON.parse(raw) : [];

    if (watchers.includes(telegramId)) {
      return false; // قبلاً ثبت شده بود
    }

    watchers.push(telegramId);

    await client.hset(
      STOCK_WATCH_KEY,
      String(productId),
      JSON.stringify(watchers)
    );

    return true;
  } catch (err) {
    console.error("⚠️ [Store] خطا در ثبت اشتراک موجودی:", err.message);
    return false;
  }
}

// همهٔ محصولاتی که یه نفر منتظرشونه، به همراه لیست منتظرها
// (برای چک دوره‌ای موجودی در پس‌زمینه)
async function getAllStockWatches() {
  if (!isEnabled) return {};

  try {
    const all = await client.hgetall(STOCK_WATCH_KEY);
    const result = {};

    for (const productId of Object.keys(all)) {
      result[productId] = JSON.parse(all[productId]);
    }

    return result;
  } catch (err) {
    console.error(
      "⚠️ [Store] خطا در دریافت لیست اشتراک‌های موجودی:",
      err.message
    );
    return {};
  }
}

// بعد از اطلاع‌رسانی، اشتراک یه محصول کامل پاک می‌شه
async function clearStockWatch(productId) {
  if (!isEnabled) return;

  try {
    await client.hdel(STOCK_WATCH_KEY, String(productId));
  } catch (err) {
    console.error(
      "⚠️ [Store] خطا در پاک‌کردن اشتراک موجودی:",
      err.message
    );
  }
}

module.exports = {
  saveUsers,
  loadUsers,
  recordSeenUser,
  getSeenUsersCount,
  getAllSeenUserIds,
  getSeenUsersDetailed,
  addStockWatcher,
  getAllStockWatches,
  clearStockWatch,
  isEnabled,
};