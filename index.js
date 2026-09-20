require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");

const {
  getCategories,
  getProductsByCategory,
  searchProducts,
  findUserByPhone,
  getUserRole,
  getProductPrice,
  formatPrice,
  normalizePhone,
  getAllProducts,
  getMeta,
  HAMKAR_PRICE_KEYS,
  getOrderByIdAndPhone,
  getOrderStatusLabel,
  getSaleProducts,
  getProductById,
  getProductsByIds,
} = require("./woocommerce");

const {
  saveUsers,
  loadUsers,
  recordSeenUser,
  getSeenUsersCount,
  getAllSeenUserIds,
  getSeenUsersDetailed,
  addStockWatcher,
  getAllStockWatches,
  removeStockWatchers,
  pingStore,
  addFavorite,
  removeFavorite,
  getFavorites,
  MAX_FAVORITES,
} = require("./store");

// آیدی عددی تلگرام مدیر (برای دسترسی به دستورات مخفی مثل /priceaudit)
// این عدد رو از لاگ‌های قبلی ربات (بخش [Telegram] ... telegramId) پیدا کردم.
const ADMIN_TELEGRAM_ID = 6122044844;

const bot = new Telegraf(process.env.BOT_TOKEN);

// =====================================
// وضعیت کاربران
// (در حافظه؛ تا زمانی که ربات ری‌استارت نشود،
// کاربرِ شناخته‌شده دیگر نیازی به ارسال دوبارهٔ شماره ندارد)
// =====================================

const users = new Map();
const searchMode = new Map();
const orderTrackState = new Map(); // telegramId -> { step: "order_id" }
const stockCheckMode = new Map(); // telegramId -> true (منتظر انتخاب دسته‌بندی برای «برام موجودش کن»)

// درخواست «برام موجودش کن» در حال تکمیل:
// telegramId -> { step: "phone" | "quantity", productId, productName, permalink }
const stockRequestState = new Map();

// کسایی که پیام درخواست موجودی براشون میاد (آیدی عددی تلگرام).
// اگه خواستی همکار دیگه‌ای هم پیام رو بگیره، آیدی عددیش رو به این لیست اضافه کن.
const STOCK_REQUEST_RECEIVERS = [ADMIN_TELEGRAM_ID];

// متن دکمه‌های منو (برای اینکه وسط ثبت درخواست، با زدن هر دکمهٔ منو، درخواست ناتموم کنسل بشه)
const MENU_BUTTONS = [
  "🛍 مشاهده محصولات",
  "🔍 جستجوی محصول",
  "🔥 پیشنهاد ویژه",
  "🙋 برام موجودش کن",
  "❤️ علاقه‌مندی‌های من",
  "📄 دریافت لیست کامل قیمت",
  "🛒 سبد خرید",
  "📦 سفارش‌های من",
  "📞 پشتیبانی",
  "🔐 احراز هویت",
  "📱 ثبت شماره من",
  "📱 ارسال شماره موبایل",
  "👨‍💼 آقای محمدی",
  "👩‍💼 خانم حسین‌زاده",
  "🛡 مسئول گارانتی",
  "🔙 بازگشت به منوی اصلی",
];

// =====================================
// ثبت هر کاربری که با ربات تعامل داره
// (برای دستور /stats و /broadcast — مستقل
// از اینکه شماره موبایلش رو داده یا نه)
// =====================================

bot.use((ctx, next) => {
  if (ctx.from) {
    recordSeenUser(ctx.from.id, {
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      username: ctx.from.username,
    });
  }
  return next();
});

// اگه کاربر وسط ثبت درخواست «برام موجودش کن» یکی از دکمه‌های منو
// یا یه دستور (مثل /start) رو زد، درخواست ناتموم کنسل می‌شه
bot.use((ctx, next) => {
  const t = ctx.message?.text;

  if (ctx.from && t && (t.startsWith("/") || MENU_BUTTONS.includes(t))) {
    stockRequestState.delete(ctx.from.id);
  }

  return next();
});

// =====================================
// منوی اصلی
// =====================================

function showMainMenu(ctx) {
  searchMode.delete(ctx.from.id);
  orderTrackState.delete(ctx.from.id);
  stockCheckMode.delete(ctx.from.id);
  stockRequestState.delete(ctx.from.id);

  return ctx.reply(
    "🛍 *به فروشگاه TAKORG خوش آمدید*\n\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:",
    {
      parse_mode: "Markdown",
      ...Markup.keyboard([
        ["🛍 مشاهده محصولات", "🔍 جستجوی محصول"],
        ["🔥 پیشنهاد ویژه", "🙋 برام موجودش کن"],
        ["❤️ علاقه‌مندی‌های من", "📄 دریافت لیست کامل قیمت"],
        ["🛒 سبد خرید", "📦 سفارش‌های من"],
        ["📞 پشتیبانی", "🔐 احراز هویت"],
        ["📱 ثبت شماره من"],
      ]).resize(),
    }
  );
}

// =====================================
// درخواست شماره موبایل
// =====================================

function requestPhone(
  ctx,
  message = "📱 برای ثبت شماره موبایل خود در سیستم، دکمهٔ زیر را بزنید."
) {
  return ctx.reply(
    message,
    Markup.keyboard([
      [
        Markup.button.contactRequest("📱 ارسال شماره موبایل")
      ],
      ["🔙 بازگشت به منوی اصلی"],
    ])
      .oneTime()
      .resize()
  );
}

// =====================================
// ثبت شماره من (ورودی برای اشتراک‌گذاری شماره)
// =====================================

bot.hears("📱 ثبت شماره من", (ctx) => {
  return requestPhone(ctx);
});

// =====================================
// فایل PDF ثابت لیست محصولات
// فایل باید کنار همین index.js (توی ریشهٔ پروژه) باشه:
// TAKORG-Products.pdf
// هر وقت خواستید محتواش رو عوض کنید، کافیه همین فایل رو
// با فایل جدید جایگزین (Upload/overwrite) کنید؛ کد نیازی
// به تغییر نداره.
// =====================================

const PRODUCTS_PDF_PATH = path.join(__dirname, "TAKORG-Products.pdf");

// =====================================
// استارت ربات
// =====================================

bot.start(async (ctx) => {
  const telegramId = ctx.from.id;

  searchMode.delete(telegramId);
  stockRequestState.delete(telegramId);

  await ctx.reply(
    "🛍 *به فروشگاه TAKORG خوش آمدید*",
    { parse_mode: "Markdown" }
  );

  // اگه این کاربر قبلاً شماره‌اش رو داده (چه همین اجرا، چه
  // از دفعهٔ قبل که از Redis بارگذاری شده)، دیگه دوباره
  // شماره نخواه و مستقیم منو رو نشون بده.
  if (users.has(telegramId)) {
    return showMainMenu(ctx);
  }

  return requestPhone(ctx);
});

// =====================================
// دریافت شماره موبایل
// =====================================

bot.on("contact", async (ctx) => {
  try {
    const telegramId = ctx.from.id;

    const contact = ctx.message.contact;

    // فقط شماره‌ای که متعلق به خود کاربر است
    if (contact.user_id && contact.user_id !== telegramId) {
      return ctx.reply(
        "❌ لطفاً شماره موبایل خودتان را ارسال کنید."
      );
    }

    const rawPhone = contact.phone_number;
    const phone = normalizePhone(rawPhone);

    console.log(
      `📞 [Telegram] شماره ثبت شد: ${rawPhone} | نرمال‌شده: ${phone} | telegramId: ${telegramId}`
    );

    // دیگه به ووکامرس سر نمی‌زنیم؛ فقط شماره رو ذخیره می‌کنیم.
    users.set(telegramId, {
      telegramId,
      phone,
      role: "hamkar",
      firstName: ctx.from.first_name || null,
      lastName: ctx.from.last_name || null,
    });

    // ذخیرهٔ ماندگار (بی‌صدا در پس‌زمینه؛ اگه شکست بخوره
    // ربات همچنان با حافظهٔ موقت کار می‌کنه)
    saveUsers(users);

    await ctx.reply("✅ شماره شما با موفقیت ثبت شد.");

    // اگه کاربر وسط «برام موجودش کن» بود و شمارهٔ ثبت‌شده نداشت،
    // به‌جای منوی اصلی، ثبت درخواست رو ادامه بده (مرحلهٔ تعداد)
    const pending = stockRequestState.get(telegramId);

    if (pending && pending.step === "phone") {
      pending.step = "quantity";
      return askQuantity(ctx, pending);
    }

    return showMainMenu(ctx);
  } catch (err) {
    console.error("Contact Error:", err.message);

    return ctx.reply(
      "❌ خطا در ثبت شماره. لطفاً دوباره تلاش کنید."
    );
  }
});

// =====================================
// مشاهده دسته‌بندی‌ها
// =====================================

bot.hears("🛍 مشاهده محصولات", async (ctx) => {
  try {
    const categories = await getCategories();

    const buttons = categories.map((cat) => [cat.name]);

    buttons.push(["🔙 بازگشت به منوی اصلی"]);

    return ctx.reply(
      "📂 یک دسته‌بندی را انتخاب کنید:",
      Markup.keyboard(buttons).resize()
    );
  } catch (err) {
    console.error(err.message);

    return ctx.reply("❌ خطا در دریافت دسته‌بندی‌ها.");
  }
});

// =====================================
// پیشنهاد ویژه (محصولات تخفیف‌دار موجود)
// =====================================

bot.hears("🔥 پیشنهاد ویژه", async (ctx) => {
  try {
    const products = await getSaleProducts();

    if (!products.length) {
      return ctx.reply("😕 در حال حاضر پیشنهاد ویژه‌ای فعال نیست.");
    }

    await ctx.reply(`🔥 ${products.length} پیشنهاد ویژهٔ امروز:`);

    const favSet = await getFavoriteIdSet(ctx.from.id);

    for (const product of products) {
      await sendProduct(ctx, product, favSet);
    }
  } catch (err) {
    console.error("Special Offer Error:", err.message);
    return ctx.reply("❌ خطا در دریافت پیشنهادهای ویژه.");
  }
});

// =====================================
// برام موجودش کن — انتخاب دسته‌بندی
// (فقط محصولات ناموجود نمایش داده می‌شن)
// =====================================

bot.hears("🙋 برام موجودش کن", async (ctx) => {
  try {
    const categories = await getCategories();

    const buttons = categories.map((cat) => [cat.name]);

    buttons.push(["🔙 بازگشت به منوی اصلی"]);

    searchMode.delete(ctx.from.id);
    orderTrackState.delete(ctx.from.id);
    stockCheckMode.set(ctx.from.id, true);

    return ctx.reply(
      "🙋 دسته‌بندی محصولی که ناموجوده رو انتخاب کنید تا محصولات ناموجودش رو ببینید:",
      Markup.keyboard(buttons).resize()
    );
  } catch (err) {
    console.error(err.message);
    return ctx.reply("❌ خطا در دریافت دسته‌بندی‌ها.");
  }
});

// =====================================
// دریافت لیست کامل محصولات به صورت PDF
// =====================================

bot.hears("📄 دریافت لیست کامل قیمت", async (ctx) => {
  try {
    if (!fs.existsSync(PRODUCTS_PDF_PATH)) {
      console.error(
        `❌ فایل PDF پیدا نشد: ${PRODUCTS_PDF_PATH} — باید این فایل رو توی گیت‌هاب آپلود کنید.`
      );

      return ctx.reply(
        "❌ فایل لیست محصولات هنوز روی سرور آپلود نشده. لطفاً بعداً دوباره تلاش کنید."
      );
    }

    await ctx.reply("⏳ در حال آماده‌سازی فایل PDF...");

    await ctx.replyWithDocument({
      source: PRODUCTS_PDF_PATH,
      filename: "TAKORG-Products.pdf",
    });

    await ctx.reply(
      "✅ فایل لیست محصولات آماده و ارسال شد.\n\nبه دلیل نوسانات قیمتی، به تاریخ بروز درج شده در لیست توجه نمایید🙏🏻"
    );
  } catch (err) {
    console.error("❌ PDF Send Error:", err);

    return ctx.reply(
      "❌ خطا در ارسال فایل PDF. لطفاً دوباره تلاش کنید."
    );
  }
});

// =====================================
// آمار کاربرها (فقط برای مدیر)
// =====================================

bot.command("stats", async (ctx) => {
  if (ctx.from.id !== ADMIN_TELEGRAM_ID) {
    return; // بی‌صدا نادیده بگیر، این دستور مخفیه
  }

  try {
    const allUsers = await getSeenUsersDetailed();
    const totalRegistered = users.size;

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);

    let newToday = 0;
    let newThisWeek = 0;
    let activeToday = 0;

    for (const u of allUsers) {
      const firstSeen = u.firstSeenAt ? new Date(u.firstSeenAt) : null;
      const lastSeen = u.lastSeenAt ? new Date(u.lastSeenAt) : null;

      if (firstSeen && firstSeen >= startOfToday) newToday++;
      if (firstSeen && firstSeen >= startOfWeek) newThisWeek++;
      if (lastSeen && lastSeen >= startOfToday) activeToday++;
    }

    await ctx.reply(
      `📊 آمار ربات:\n\n` +
        `👥 کل کاربرهای منحصربه‌فرد تا الان: ${allUsers.length}\n` +
        `🆕 کاربر جدید امروز: ${newToday}\n` +
        `📅 کاربر جدید طی ۷ روز اخیر: ${newThisWeek}\n` +
        `⚡️ فعال (پیام زده) امروز: ${activeToday}\n` +
        `📱 کسایی که شماره‌شون رو ثبت کردن: ${totalRegistered}`
    );
  } catch (err) {
    console.error("Stats Error:", err.message);
    return ctx.reply("❌ خطا در دریافت آمار: " + err.message);
  }
});

// =====================================
// پیام همگانی (فقط برای مدیر)
// استفاده: /broadcast متن پیام شما
// =====================================

bot.command("broadcast", async (ctx) => {
  if (ctx.from.id !== ADMIN_TELEGRAM_ID) {
    return; // بی‌صدا نادیده بگیر، این دستور مخفیه
  }

  const text = ctx.message.text.replace(/^\/broadcast(@\S+)?\s*/, "");

  if (!text) {
    return ctx.reply(
      "⚠️ متن پیام رو بعد از دستور بنویس.\n\nمثال:\n/broadcast محصولات جدید به فروشگاه اضافه شد!"
    );
  }

  try {
    const userIds = await getAllSeenUserIds();

    if (!userIds.length) {
      return ctx.reply("❌ هیچ کاربری برای ارسال پیدا نشد.");
    }

    await ctx.reply(`⏳ در حال ارسال پیام به ${userIds.length} نفر...`);

    let sent = 0;
    let failed = 0;

    for (const userId of userIds) {
      try {
        await ctx.telegram.sendMessage(userId, text);
        sent++;
      } catch (err) {
        failed++;
      }

      // یه مکث کوچیک بین هر ارسال تا به محدودیت تلگرام نخوریم
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await ctx.reply(
      `✅ پیام همگانی تموم شد.\n\nموفق: ${sent}\nناموفق (مثلاً بلاک کرده بودن): ${failed}`
    );
  } catch (err) {
    console.error("Broadcast Error:", err.message);
    return ctx.reply("❌ خطا در ارسال پیام همگانی: " + err.message);
  }
});

// =====================================
// ممیزی قیمت (فقط برای مدیر)
// محصولاتی که قیمت اصلی‌شون با قیمت
// همکاری‌شون برابر یا کمتره رو لیست می‌کنه
// (یعنی جایی که احتمالاً اشتباه ثبت شده)
// =====================================

bot.command("priceaudit", async (ctx) => {
  if (ctx.from.id !== ADMIN_TELEGRAM_ID) {
    return; // بی‌صدا نادیده بگیر، این دستور مخفیه
  }

  await ctx.reply("⏳ در حال بررسی همه محصولات، چند لحظه صبر کن...");

  try {
    const products = await getAllProducts();

    const problems = [];

    for (const product of products) {
      const regularPrice = Number(product.regular_price || product.price || 0);

      const hamkarPriceRaw = getMeta(product, HAMKAR_PRICE_KEYS);

      if (!hamkarPriceRaw) continue; // قیمت همکاری اصلاً ثبت نشده، فعلاً کاری نداریم

      const hamkarPrice = Number(hamkarPriceRaw);

      if (regularPrice > 0 && hamkarPrice > 0 && regularPrice <= hamkarPrice) {
        problems.push(
          `• ${product.name}\n   مشتری: ${formatPrice(regularPrice)} | همکار: ${formatPrice(hamkarPrice)}\n   ویرایش: ${product.permalink}`
        );
      }
    }

    if (!problems.length) {
      return ctx.reply(
        `✅ بررسی ${products.length} محصول انجام شد. هیچ محصولی با قیمت اشتباه (مشتری ≤ همکار) پیدا نشد.`
      );
    }

    await ctx.reply(
      `⚠️ از ${products.length} محصول، ${problems.length} محصول قیمت مشتری‌شون کمتر یا مساوی قیمت همکاری‌شونه:`
    );

    // تلگرام پیام‌های خیلی بلند رو رد می‌کنه، پس تکه‌تکه می‌فرستیم
    let chunk = "";
    for (const line of problems) {
      if ((chunk + line).length > 3500) {
        await ctx.reply(chunk);
        chunk = "";
      }
      chunk += line + "\n\n";
    }
    if (chunk) await ctx.reply(chunk);
  } catch (err) {
    console.error("Price Audit Error:", err.message);
    return ctx.reply("❌ خطا در ممیزی قیمت: " + err.message);
  }
});

// =====================================
// نمایش محصول با قیمت نقش
// =====================================

async function sendProduct(ctx, product, favSet = null) {
  const telegramId = ctx.from.id;

  const userData = users.get(telegramId);

  // احراز هویت اولیه حذف شده؛ همه کاربرها قیمت همکاری می‌بینند.
  const role = "hamkar";

  const price = getProductPrice(product, role);

  console.log(
    `🐞 [Debug Price] محصول: ${product.name} | telegramId: ${telegramId} | ` +
      `userData.role: ${userData?.role} | role نهایی: ${role} | ` +
      `regular_price: ${product.regular_price} | sale_price: ${product.sale_price} | ` +
      `product.price (خام از API): ${product.price} | ` +
      `قیمت محاسبه‌شده نهایی: ${price}`
  );

  const priceText = formatPrice(price);

  const shortDescription = String(
    product.short_description || ""
  )
    .replace(/<[^>]*>/g, "")
    .substring(0, 150);

  const caption =
    `🛍 *${product.name}*\n\n` +
    `💰 قیمت: *${priceText} تومان*\n\n` +
    `${shortDescription}`;

  const image = product.images?.length
    ? product.images[0].src
    : null;

  const isFavorite = Boolean(favSet && favSet.has(Number(product.id)));
  const favSpec = favoriteButtonSpec(product.id, isFavorite);

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url("🛒 خرید از سایت", product.permalink)],
    [Markup.button.callback(favSpec.text, favSpec.data)],
  ]);

  if (image) {
    return ctx.replyWithPhoto(image, {
      caption,
      parse_mode: "Markdown",
      ...keyboard,
    });
  }

  return ctx.reply(caption, {
    parse_mode: "Markdown",
    ...keyboard,
  });
}

// =====================================
// علاقه‌مندی‌ها
// =====================================

// متن و callback دکمهٔ علاقه‌مندی، بسته به اینکه محصول الان تو لیست هست یا نه
//   fav:add:<id> → افزودن      fav:rm:<id> → حذف (روی کارت محصول)
//   fav:del:<id> → حذف و پاک‌کردن کارت (توی خود لیست علاقه‌مندی‌ها)
function favoriteButtonSpec(productId, isFavorite) {
  return isFavorite
    ? { text: "💔 حذف از علاقه‌مندی", data: `fav:rm:${productId}` }
    : { text: "❤️ افزودن به علاقه‌مندی", data: `fav:add:${productId}` };
}

// مجموعهٔ شناسه‌های علاقه‌مندی کاربر (برای اینکه دکمهٔ هر محصول وضعیت درست رو نشون بده)
async function getFavoriteIdSet(telegramId) {
  const { ids } = await getFavorites(telegramId);
  return new Set(ids);
}

// دکمهٔ علاقه‌مندیِ همون پیام رو (بدون دست‌زدن به بقیهٔ دکمه‌ها) عوض می‌کنه
async function swapFavoriteButton(ctx, productId, isFavorite) {
  const keyboard = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard;

  if (!keyboard) return;

  const spec = favoriteButtonSpec(productId, isFavorite);

  const newKeyboard = keyboard.map((row) =>
    row.map((btn) =>
      btn.callback_data &&
      /^fav:(add|rm):\d+$/.test(btn.callback_data) &&
      btn.callback_data.endsWith(`:${productId}`)
        ? { text: spec.text, callback_data: spec.data }
        : btn
    )
  );

  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: newKeyboard });
  } catch (err) {
    // مثلاً «message is not modified»؛ مهم نیست
  }
}

bot.action(/^fav:(add|rm|del):(\d+)$/, async (ctx) => {
  const action = ctx.match[1];
  const productId = Number(ctx.match[2]);
  const telegramId = ctx.from.id;

  try {
    if (action === "add") {
      const result = await addFavorite(telegramId, productId);

      if (result === "added" || result === "exists") {
        await ctx.answerCbQuery(
          result === "added"
            ? "به علاقه‌مندی‌ها اضافه شد ❤️"
            : "قبلاً توی علاقه‌مندی‌هاتون بود ❤️"
        );

        return swapFavoriteButton(ctx, productId, true);
      }

      if (result === "full") {
        return ctx.answerCbQuery(
          `❌ حداکثر ${MAX_FAVORITES} محصول می‌تونید توی علاقه‌مندی‌ها داشته باشید. اول یکی از قبلی‌ها رو حذف کنید.`,
          { show_alert: true }
        );
      }

      console.error(
        `❌ [Favorites] افزودن انجام نشد (${result}) → محصول ${productId} | کاربر ${telegramId}`
      );

      return ctx.answerCbQuery(
        "❌ فعلاً امکان ذخیره نیست. لطفاً کمی بعد دوباره امتحان کنید.",
        { show_alert: true }
      );
    }

    // action === "rm" | "del"
    const result = await removeFavorite(telegramId, productId);

    if (result !== "removed" && result !== "missing") {
      console.error(
        `❌ [Favorites] حذف انجام نشد (${result}) → محصول ${productId} | کاربر ${telegramId}`
      );

      return ctx.answerCbQuery(
        "❌ فعلاً امکان حذف نیست. لطفاً کمی بعد دوباره امتحان کنید.",
        { show_alert: true }
      );
    }

    await ctx.answerCbQuery("از علاقه‌مندی‌ها حذف شد 💔");

    if (action === "rm") {
      return swapFavoriteButton(ctx, productId, false);
    }

    // داخل لیست علاقه‌مندی‌ها: کارت رو پاک کن
    try {
      await ctx.deleteMessage();
    } catch (err) {
      // پیام‌های خیلی قدیمی قابل‌حذف نیستن؛ دکمه‌ها رو برمی‌داریم
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch (e) {
        // مهم نیست
      }
    }
  } catch (err) {
    console.error("Favorites Action Error:", err.message);

    try {
      await ctx.answerCbQuery("❌ خطا، دوباره امتحان کنید");
    } catch (e) {
      // مهم نیست
    }
  }
});

// کارت یک محصول توی لیست «علاقه‌مندی‌های من»
async function sendFavoriteCard(ctx, product) {
  const price = formatPrice(getProductPrice(product, "hamkar"));
  const inStock = product.stock_status === "instock";

  const caption =
    `🛍 <b>${safeText(product.name)}</b>\n\n` +
    `${inStock ? "✅ موجود" : "❌ ناموجود"}\n` +
    `💰 قیمت: <b>${price} تومان</b>`;

  const rows = [];

  if (inStock && product.permalink) {
    rows.push([Markup.button.url("🛒 خرید از سایت", product.permalink)]);
  }

  rows.push([
    Markup.button.callback("💔 حذف از علاقه‌مندی", `fav:del:${product.id}`),
  ]);

  if (!inStock) {
    rows.push([
      Markup.button.callback("🙋 برام موجودش کن", `req:${product.id}`),
    ]);
  }

  const extra = { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) };

  const image = product.images?.length ? product.images[0].src : null;

  if (image) {
    try {
      return await ctx.replyWithPhoto(image, { caption, ...extra });
    } catch (err) {
      console.error(
        `⚠️ [Favorites] ارسال عکس محصول ${product.id} ناموفق بود؛ بدون عکس ارسال می‌شه:`,
        err.message
      );
    }
  }

  return ctx.reply(caption, extra);
}

// =====================================
// دکمهٔ منو: ❤️ علاقه‌مندی‌های من
// =====================================

bot.hears("❤️ علاقه‌مندی‌های من", async (ctx) => {
  const telegramId = ctx.from.id;

  searchMode.delete(telegramId);
  orderTrackState.delete(telegramId);
  stockCheckMode.delete(telegramId);

  try {
    const { status, ids } = await getFavorites(telegramId);

    if (status !== "ok") {
      return ctx.reply(
        "❌ فعلاً امکان نمایش علاقه‌مندی‌ها نیست. لطفاً کمی بعد دوباره تلاش کنید."
      );
    }

    const emptyText =
      "❤️ لیست علاقه‌مندی‌های شما خالیه.\n\nزیر هر محصول موجود روی «❤️ افزودن به علاقه‌مندی» بزنید تا اینجا ذخیره بشه.";

    if (!ids.length) {
      return ctx.reply(emptyText);
    }

    const fetched = await getProductsByIds(ids);
    const byId = new Map(fetched.map((p) => [Number(p.id), p]));

    const products = [];

    for (const id of ids) {
      const product = byId.get(id);

      if (!product) {
        // محصول از سایت حذف شده → از لیست کاربر هم پاک بشه
        await removeFavorite(telegramId, id);
        continue;
      }

      // محصول پیش‌نویس/خصوصی رو نشون نمی‌دیم (ولی از لیست حذفش نمی‌کنیم)
      if (product.status && product.status !== "publish") continue;

      products.push(product);
    }

    if (!products.length) {
      return ctx.reply(emptyText);
    }

    await ctx.reply(
      `❤️ ${products.length} محصول توی لیست علاقه‌مندی‌های شماست:`
    );

    for (const product of products) {
      await sendFavoriteCard(ctx, product);
      await sleep(80); // رعایت محدودیت ارسال تلگرام
    }
  } catch (err) {
    console.error("Favorites List Error:", err.message);
    return ctx.reply("❌ خطا در دریافت علاقه‌مندی‌ها. لطفاً دوباره تلاش کنید.");
  }
});

// =====================================
// ابزارهای کمکی «برام موجودش کن»
// =====================================

function decodeHtmlEntities(text = "") {
  return String(text)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// اسم محصول ووکامرس (ممکنه کاراکتر HTML داشته باشه) → متن امن برای parse_mode: HTML
function safeText(text = "") {
  return escapeHtml(decodeHtmlEntities(text));
}

// ارقام فارسی/عربی → انگلیسی
function toEnglishDigits(text = "") {
  return String(text)
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

// از متن کاربر یه تعداد معتبر (۱ تا ۱۰۰۰۰۰) درمیاره؛ اگه نشد null
function parseQuantity(text = "") {
  const numbers = toEnglishDigits(text).match(/\d+/g);

  if (!numbers || numbers.length !== 1) return null;

  const quantity = Number(numbers[0]);

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
    return null;
  }

  return quantity;
}

// شمارهٔ نرمال‌شده (9123456789) → فرمت قابل‌نمایش (09123456789)
function displayPhone(phone = "") {
  const p = String(phone);
  return /^9\d{9}$/.test(p) ? `0${p}` : p;
}

function askQuantity(ctx, state) {
  return ctx.reply(
    `🔢 چند عدد از «${decodeHtmlEntities(state.productName)}» نیاز دارید؟\n\nفقط تعداد رو به‌صورت عدد بفرستید (مثلاً 5).`,
    Markup.keyboard([["🔙 بازگشت به منوی اصلی"]]).resize()
  );
}

// =====================================
// نمایش محصولِ ناموجود در حالت «برام موجودش کن»
// (فقط ناموجودها + دکمهٔ درخواست)
// =====================================

async function sendOutOfStockProduct(ctx, product) {
  const price = getProductPrice(product, "hamkar");
  const priceText = formatPrice(price);

  const caption =
    `🛍 <b>${safeText(product.name)}</b>\n\n` +
    `❌ ناموجود\n` +
    `💰 قیمت: <b>${priceText} تومان</b>`;

  const extra = {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("🙋 برام موجودش کن", `req:${product.id}`)],
    ]),
  };

  const image = product.images?.length ? product.images[0].src : null;

  if (image) {
    try {
      return await ctx.replyWithPhoto(image, { caption, ...extra });
    } catch (err) {
      console.error(
        `⚠️ [StockRequest] ارسال عکس محصول ${product.id} ناموفق بود؛ بدون عکس ارسال می‌شه:`,
        err.message
      );
    }
  }

  return ctx.reply(caption, extra);
}

// =====================================
// دکمهٔ «🙋 برام موجودش کن» روی یک محصول
// مرحله ۱: (اگه شماره ثبت نشده) شماره بگیر
// مرحله ۲: تعداد بگیر
// مرحله ۳: پیام کامل برای مدیر بفرست
// =====================================

bot.action(/^req:(\d+)$/, async (ctx) => {
  const telegramId = ctx.from.id;
  const productId = Number(ctx.match[1]);

  try {
    await ctx.answerCbQuery();

    let product;

    try {
      product = await getProductById(productId);
    } catch (err) {
      return ctx.reply(
        "❌ خطا در دریافت اطلاعات محصول. لطفاً چند لحظه بعد دوباره امتحان کنید."
      );
    }

    if (!product) {
      return ctx.reply("❌ این محصول دیگه توی سایت پیدا نشد.");
    }

    // اگه بین نمایش لیست و زدن دکمه موجود شده باشه
    if (product.stock_status === "instock") {
      return ctx.reply(
        `✅ خبر خوب! «${decodeHtmlEntities(product.name)}» همین الان موجود شده.`,
        product.permalink
          ? Markup.inlineKeyboard([
              [Markup.button.url("🛒 خرید از سایت", product.permalink)],
            ])
          : {}
      );
    }

    // حالت‌های دیگه‌ای که ممکنه فعال باشن رو ببند
    searchMode.delete(telegramId);
    orderTrackState.delete(telegramId);
    stockCheckMode.delete(telegramId);

    const state = {
      step: "quantity",
      productId: product.id,
      productName: product.name,
      permalink: product.permalink || null,
    };

    const userData = users.get(telegramId);

    // شماره موبایل حتماً باید داشته باشیم تا بتونیم باهاش هماهنگ کنیم
    if (!userData?.phone) {
      state.step = "phone";
      stockRequestState.set(telegramId, state);

      return requestPhone(
        ctx,
        "📱 برای ثبت درخواست، لازمه شمارهٔ موبایلتون رو داشته باشیم تا بتونیم باهاتون هماهنگ کنیم.\n\nلطفاً دکمهٔ «ارسال شماره موبایل» رو بزنید."
      );
    }

    stockRequestState.set(telegramId, state);

    return askQuantity(ctx, state);
  } catch (err) {
    console.error("Stock Request Action Error:", err.message);
    return ctx.reply("❌ خطا در ثبت درخواست. لطفاً دوباره تلاش کنید.");
  }
});

// =====================================
// ارسال پیام درخواست برای مدیر
// خروجی: تعداد گیرنده‌هایی که پیام بهشون رسید
// =====================================

async function sendStockRequestToAdmins(ctx, state, quantity, phone) {
  const from = ctx.from;

  const fullName =
    [from.first_name, from.last_name].filter(Boolean).join(" ") || "بدون نام";

  const usernameLine = from.username ? `@${from.username}` : "ندارد";

  const time = new Date().toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });

  const productLine = state.permalink
    ? `<a href="${escapeHtml(state.permalink)}">${safeText(state.productName)}</a>`
    : safeText(state.productName);

  const text =
    `📥 <b>درخواست موجود کردن کالا</b>\n\n` +
    `🛍 محصول: <b>${productLine}</b>\n` +
    `🔢 تعداد درخواستی: <b>${quantity}</b>\n\n` +
    `👤 نام: <a href="tg://user?id=${from.id}">${escapeHtml(fullName)}</a>\n` +
    `🆔 آیدی تلگرام: ${escapeHtml(usernameLine)}\n` +
    `🔢 آیدی عددی: <code>${from.id}</code>\n` +
    `📞 شماره تماس: <code>${escapeHtml(displayPhone(phone))}</code>\n\n` +
    `🕒 ${escapeHtml(time)}`;

  let delivered = 0;

  for (const receiverId of STOCK_REQUEST_RECEIVERS) {
    try {
      await bot.telegram.sendMessage(receiverId, text, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      delivered++;
    } catch (err) {
      console.error(
        `❌ [StockRequest] ارسال درخواست به ${receiverId} ناموفق بود:`,
        err.response?.description || err.message
      );
    }
  }

  console.log(
    `📥 [StockRequest] محصول ${state.productId} (${decodeHtmlEntities(state.productName)}) | تعداد: ${quantity} | کاربر: ${from.id} | شماره: ${displayPhone(phone)} | تحویل به ${delivered} گیرنده`
  );

  return delivered;
}

// =====================================
// ارسال پیام ساده به مدیر(ها)
// =====================================

async function notifyAdmins(text) {
  for (const receiverId of STOCK_REQUEST_RECEIVERS) {
    try {
      await bot.telegram.sendMessage(receiverId, text);
    } catch (err) {
      console.error(
        `❌ [Admin] ارسال پیام به ${receiverId} ناموفق بود:`,
        err.response?.description || err.message
      );
    }
  }
}

// =====================================
// چک دوره‌ای موجودی محصولات درخواست‌شده
// و اطلاع‌رسانی خودکار به کسایی که درخواست «برام موجودش کن» دادن
// (اگه ما محصول رو موجود کنیم و باهاشون هماهنگ نکرده باشیم)
// =====================================

const STOCK_CHECK_INTERVAL_MS = 2 * 60 * 1000; // هر ۲ دقیقه
const STOCK_CHECK_FIRST_DELAY_MS = 20 * 1000; // اولین چک، ۲۰ ثانیه بعد از بالا اومدن ربات

let stockCheckRunning = false; // جلوگیری از هم‌پوشانی دو چک همزمان

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ارسال پیام «موجود شد» به یک نفر
// خروجی:
//   "sent"   → پیام رسید
//   "remove" → کاربر ربات رو بلاک کرده / چت وجود نداره → دیگه تلاش نکن
//   "keep"   → خطای موقتی (شبکه، محدودیت تلگرام و ...) → دفعهٔ بعد دوباره تلاش کن
async function notifyWatcher(telegramId, product) {
  try {
    const extra = product.permalink
      ? Markup.inlineKeyboard([
          [Markup.button.url("🛒 خرید از سایت", product.permalink)],
        ])
      : {};

    await bot.telegram.sendMessage(
      telegramId,
      `🎉 خبر خوب! محصول «${decodeHtmlEntities(product.name)}» که درخواستش رو داده بودید موجود شد.`,
      extra
    );

    return "sent";
  } catch (err) {
    const code = err.response?.error_code ?? err.code;
    const description = String(err.response?.description || err.message || "");

    if (code === 403 || (code === 400 && /chat not found/i.test(description))) {
      console.log(
        `ℹ️ [StockWatch] کاربر ${telegramId} ربات رو بلاک کرده یا چت پیدا نشد؛ از لیست حذف می‌شه.`
      );
      return "remove";
    }

    console.error(
      `⚠️ [StockWatch] ارسال پیام به ${telegramId} ناموفق بود (بعداً دوباره تلاش می‌شه):`,
      description
    );
    return "keep";
  }
}

// چک کامل: همهٔ محصولات تحت نظر رو با یک درخواست از ووکامرس می‌گیره،
// برای هر محصولِ موجودشده به منتظرها پیام می‌ده و «فقط» اونایی رو که
// پیامشون رسیده (یا بلاک کردن) از لیست حذف می‌کنه.
async function checkStockWatches() {
  const report = {
    skipped: false,
    error: null,
    watchedProducts: 0,
    restocked: 0,
    sent: 0,
    kept: 0,
    removed: 0,
    lines: [],
  };

  if (stockCheckRunning) {
    report.skipped = true;
    return report;
  }

  stockCheckRunning = true;

  try {
    const watches = await getAllStockWatches();
    const productIds = Object.keys(watches);

    report.watchedProducts = productIds.length;

    if (!productIds.length) return report;

    const products = await getProductsByIds(productIds);
    const byId = new Map(products.map((p) => [String(p.id), p]));

    for (const productId of productIds) {
      const watchers = watches[productId];
      const product = byId.get(String(productId));

      if (!product) {
        report.lines.push(
          `#${productId}: ❓ توی ووکامرس پیدا نشد (حذف شده؟) | منتظرها: ${watchers.length}`
        );
        continue;
      }

      const isInStock = product.stock_status === "instock";
      const isPublished = product.status === "publish";

      report.lines.push(
        `#${productId} ${decodeHtmlEntities(product.name)}\n   وضعیت موجودی: ${product.stock_status} | وضعیت انتشار: ${product.status} | منتظرها: ${watchers.length}`
      );

      // فقط وقتی هم موجوده و هم منتشر شده (لینک خرید کار می‌کنه) خبر بده
      if (!isInStock || !isPublished) continue;

      report.restocked++;

      const finished = []; // اونایی که دیگه نباید تو لیست بمونن

      for (const telegramId of watchers) {
        const result = await notifyWatcher(telegramId, product);

        if (result === "sent") {
          report.sent++;
          finished.push(telegramId);
        } else if (result === "remove") {
          report.removed++;
          finished.push(telegramId);
        } else {
          report.kept++;
        }

        // مکث کوچیک برای رعایت محدودیت تلگرام
        await sleep(50);
      }

      await removeStockWatchers(productId, finished);
    }
  } catch (err) {
    report.error = err.response?.data?.message || err.message;
    console.error(
      "❌ [StockWatch] خطا در چک موجودی:",
      err.response?.data || err.message
    );
  } finally {
    stockCheckRunning = false;
  }

  return report;
}

// اجرای زمان‌بندی‌شده + لاگ خلاصه (تا تو لاگ‌های Render معلوم باشه کار می‌کنه)
async function runScheduledStockCheck() {
  const report = await checkStockWatches();

  if (report.skipped) return;

  if (report.error) {
    console.error(`❌ [StockWatch] چک ناموفق: ${report.error}`);
    return;
  }

  if (report.watchedProducts > 0) {
    console.log(
      `🔔 [StockWatch] ${report.watchedProducts} محصول تحت نظر | موجودشده: ${report.restocked} | ارسال موفق: ${report.sent} | بلاک/حذف: ${report.removed} | تلاش مجدد: ${report.kept}`
    );
  }
}

setTimeout(runScheduledStockCheck, STOCK_CHECK_FIRST_DELAY_MS);
setInterval(runScheduledStockCheck, STOCK_CHECK_INTERVAL_MS);

// =====================================
// چک دستی موجودی + گزارش تشخیصی (فقط برای مدیر)
// نشون می‌ده Redis وصله یا نه، چند محصول تحت نظره و وضعیت هرکدوم چیه.
// توجه: این دستور یه چک «واقعی» انجام می‌ده، یعنی اگه محصولی
// موجود شده باشه، همین الان به منتظرها پیام می‌ده.
// =====================================

bot.command("checkstock", async (ctx) => {
  if (ctx.from.id !== ADMIN_TELEGRAM_ID) {
    return; // بی‌صدا نادیده بگیر، این دستور مخفیه
  }

  await ctx.reply("⏳ در حال چک موجودی محصولات تحت نظر...");

  try {
    const store = await pingStore();

    const storeLine = !store.enabled
      ? "❌ Redis: غیرفعال (متغیر REDIS_URL تنظیم نشده)"
      : store.ok
      ? "✅ Redis: وصله"
      : `❌ Redis: وصل نیست (${store.error})`;

    const report = await checkStockWatches();

    if (report.skipped) {
      return ctx.reply(
        "⏳ یه چک دیگه همین الان در حال اجراست؛ چند ثانیه بعد دوباره امتحان کن."
      );
    }

    let text =
      `📋 گزارش چک موجودی\n\n` +
      `${storeLine}\n` +
      `📦 محصولات تحت نظر: ${report.watchedProducts}\n` +
      `🟢 موجودشده در این چک: ${report.restocked}\n` +
      `📨 پیام ارسال‌شده: ${report.sent}\n` +
      `🚫 حذف‌شده (بلاک/چت ناموجود): ${report.removed}\n` +
      `🔁 ارسال ناموفق (بعداً تلاش می‌شه): ${report.kept}\n`;

    if (report.error) {
      text += `\n❌ خطا: ${report.error}\n`;
    }

    if (!report.watchedProducts && !report.error) {
      text +=
        "\nℹ️ هیچ محصولی تحت نظر نیست (هنوز درخواستی ثبت نشده، یا قبلاً اطلاع‌رسانی شده و پاک شده).";
    }

    if (report.lines.length) {
      text += `\n${report.lines.slice(0, 20).join("\n")}`;

      if (report.lines.length > 20) {
        text += `\n... و ${report.lines.length - 20} مورد دیگه`;
      }
    }

    // سقف طول پیام تلگرام
    return ctx.reply(text.slice(0, 4000));
  } catch (err) {
    console.error("CheckStock Command Error:", err.message);
    return ctx.reply("❌ خطا در چک موجودی: " + err.message);
  }
});

bot.on("text", async (ctx, next) => {
  const text = ctx.message.text;

  if (MENU_BUTTONS.includes(text)) {
    return next();
  }

  // حالت ثبت درخواست «برام موجودش کن» (مرحلهٔ شماره / تعداد)
  const requestState = stockRequestState.get(ctx.from.id);

  if (requestState) {
    if (requestState.step === "phone") {
      return ctx.reply(
        "📱 لطفاً با دکمهٔ «ارسال شماره موبایل» شمارهٔ خودتون رو بفرستید.\n\nبرای انصراف، «🔙 بازگشت به منوی اصلی» رو بزنید."
      );
    }

    const quantity = parseQuantity(text);

    if (!quantity) {
      return ctx.reply(
        "⚠️ لطفاً فقط تعداد رو به‌صورت یه عدد بنویسید (مثلاً 5)."
      );
    }

    try {
      const userData = users.get(ctx.from.id);

      // محافظ: اگه به هر دلیل شماره نبود، دوباره بگیر
      if (!userData?.phone) {
        requestState.step = "phone";

        return requestPhone(
          ctx,
          "📱 قبل از ثبت درخواست، لطفاً شمارهٔ موبایلتون رو با دکمهٔ زیر بفرستید."
        );
      }

      const delivered = await sendStockRequestToAdmins(
        ctx,
        requestState,
        quantity,
        userData.phone
      );

      if (!delivered) {
        return ctx.reply(
          "❌ متأسفانه ثبت درخواست انجام نشد. لطفاً چند دقیقه بعد دوباره تلاش کنید یا با پشتیبانی تماس بگیرید."
        );
      }

      stockRequestState.delete(ctx.from.id);

      // همزمان، کاربر رو تو لیست «خبرم کن» هم می‌ذاریم: اگه ما محصول رو موجود کردیم
      // و باهاش هماهنگ نکردیم، خود ربات بهش خبر می‌ده (چک دوره‌ای پایین‌تر)
      const watchResult = await addStockWatcher(
        requestState.productId,
        ctx.from.id
      );

      if (watchResult !== "added" && watchResult !== "exists") {
        console.error(
          `❌ [StockRequest] کاربر ${ctx.from.id} تو لیست اطلاع‌رسانی خودکار محصول ${requestState.productId} ثبت نشد (${watchResult}).`
        );

        await notifyAdmins(
          `⚠️ درخواست بالا ثبت شد ولی کاربر ${ctx.from.id} تو لیست اطلاع‌رسانی خودکار نرفت (${watchResult}؛ احتمالاً Redis وصل نیست). یعنی اگه محصول موجود بشه، ربات خودکار بهش خبر نمی‌ده.`
        );
      }

      await ctx.reply(
        `✅ درخواست شما ثبت شد:\n\n` +
          `🛍 محصول: ${decodeHtmlEntities(requestState.productName)}\n` +
          `🔢 تعداد: ${quantity}\n` +
          `📞 شماره تماس: ${displayPhone(userData.phone)}`
      );

      return showMainMenu(ctx);
    } catch (err) {
      console.error("Stock Request Submit Error:", err.message);
      return ctx.reply("❌ خطا در ثبت درخواست. لطفاً دوباره تلاش کنید.");
    }
  }

  // حالت پیگیری سفارش (فقط کد سفارش؛ شماره از قبل ثبت‌شده)
  if (orderTrackState.has(ctx.from.id)) {
    const state = orderTrackState.get(ctx.from.id);

    if (state.step === "order_id") {
      const orderId = text.replace(/\D/g, "");

      if (!orderId) {
        return ctx.reply("⚠️ لطفاً فقط عدد شمارهٔ سفارش رو وارد کنید.");
      }

      orderTrackState.delete(ctx.from.id);

      const userData = users.get(ctx.from.id);

      if (!userData?.phone) {
        await ctx.reply(
          "⚠️ برای پیگیری سفارش، اول باید شمارهٔ موبایلتون رو ثبت کنید."
        );
        return showMainMenu(ctx);
      }

      try {
        const order = await getOrderByIdAndPhone(orderId, userData.phone);

        if (!order) {
          await ctx.reply(
            "❌ سفارشی با این شماره سفارش، مرتبط با شمارهٔ موبایل ثبت‌شدهٔ شما پیدا نشد.\n\nلطفاً از صحت کد سفارش مطمئن شوید."
          );
          return showMainMenu(ctx);
        }

        const statusLabel = getOrderStatusLabel(order.status);
        const total = formatPrice(order.total);
        const itemsCount = order.line_items?.length || 0;

        await ctx.reply(
          `📦 *سفارش #${order.number}*\n\n` +
            `وضعیت: ${statusLabel}\n` +
            `تعداد اقلام: ${itemsCount}\n` +
            `مبلغ کل: ${total} تومان`,
          { parse_mode: "Markdown" }
        );

        return showMainMenu(ctx);
      } catch (err) {
        console.error("Order Track Error:", err.message);
        await ctx.reply("❌ خطا در بررسی سفارش. لطفاً دوباره تلاش کنید.");
        return showMainMenu(ctx);
      }
    }
  }

  // حالت جستجو
  if (searchMode.get(ctx.from.id)) {
    try {
      const products = await searchProducts(text);

      if (!products.length) {
        return ctx.reply("❌ محصولی پیدا نشد.");
      }

      searchMode.delete(ctx.from.id);

      const favSet = await getFavoriteIdSet(ctx.from.id);

      for (const product of products) {
        await sendProduct(ctx, product, favSet);
      }

      return;
    } catch (err) {
      console.error(err.message);

      return ctx.reply("❌ خطا در جستجو.");
    }
  }

  // حالت «برام موجودش کن» (فقط محصولات ناموجودِ دسته‌بندی انتخاب‌شده)
  if (stockCheckMode.get(ctx.from.id)) {
    stockCheckMode.delete(ctx.from.id);

    try {
      const products = await getProductsByCategory(text, {
        onlyOutOfStock: true,
      });

      if (!products.length) {
        await ctx.reply(
          "🎉 توی این دسته‌بندی محصول ناموجودی پیدا نشد."
        );
        return showMainMenu(ctx);
      }

      await ctx.reply(
        `❌ ${products.length} محصول ناموجود توی این دسته‌بندی هست.\n\nروی «🙋 برام موجودش کن» زیر محصول موردنظرتون بزنید:`
      );

      for (const product of products) {
        await sendOutOfStockProduct(ctx, product);
      }

      return showMainMenu(ctx);
    } catch (err) {
      console.error("Out Of Stock List Error:", err.message);
      await ctx.reply("❌ خطا در دریافت محصولات ناموجود.");
      return showMainMenu(ctx);
    }
  }

  // دسته‌بندی
  try {
    const products = await getProductsByCategory(text);

    if (!products.length) return;

    const favSet = await getFavoriteIdSet(ctx.from.id);

    for (const product of products) {
      await sendProduct(ctx, product, favSet);
    }
  } catch (err) {
    console.error(err.message);
  }
});

// =====================================
// جستجو
// =====================================

bot.hears("🔍 جستجوی محصول", (ctx) => {
  searchMode.set(ctx.from.id, true);

  return ctx.reply(
    "🔎 نام محصول را وارد کنید.\n\nمثلاً:\n• اسپیکر JBL\n• کابل آیفون\n• ساعت هوشمند",
    Markup.keyboard([
      ["🔙 بازگشت به منوی اصلی"],
    ]).resize()
  );
});

// =====================================
// سبد خرید
// =====================================

bot.hears("🛒 سبد خرید", (ctx) => {
  return ctx.reply(
    "🛒 برای مشاهده سبد خرید، ابتدا وارد حساب کاربری خود شوید.",
    Markup.inlineKeyboard([
      [
        Markup.button.url(
          "🔐 ورود به حساب و سبد خرید",
          "https://takorg.com/my-account/"
        ),
      ],
    ])
  );
});

// =====================================
// سفارش‌های من
// =====================================

bot.hears("📦 سفارش‌های من", (ctx) => {
  return ctx.reply(
    "📦 چطور می‌خواید سفارشتون رو پیگیری کنید؟",
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "🔎 پیگیری با کد سفارش",
          "track_order_start"
        ),
      ],
      [
        Markup.button.url(
          "🔐 ورود و مشاهده سفارش‌ها",
          "https://takorg.com/my-account/orders/"
        ),
      ],
    ])
  );
});

// =====================================
// پیگیری سفارش با کد سفارش + شماره موبایل
// =====================================

bot.action("track_order_start", async (ctx) => {
  await ctx.answerCbQuery();

  const userData = users.get(ctx.from.id);

  if (!userData?.phone) {
    return ctx.reply(
      "⚠️ برای پیگیری سفارش، اول باید شمارهٔ موبایلتون رو ثبت کنید.",
      Markup.inlineKeyboard([
        [Markup.button.callback("📱 ثبت شماره من", "register_phone_from_order")],
      ])
    );
  }

  orderTrackState.set(ctx.from.id, { step: "order_id" });

  return ctx.reply(
    "🔎 لطفاً شمارهٔ سفارش (کد فاکتور) را وارد کنید:\n\nمثلاً: 1024",
    Markup.keyboard([["🔙 بازگشت به منوی اصلی"]]).resize()
  );
});

bot.action("register_phone_from_order", async (ctx) => {
  await ctx.answerCbQuery();
  return requestPhone(ctx);
});

// =====================================
// احراز هویت (هدایت به صفحه ورود سایت)
// =====================================

bot.hears("🔐 احراز هویت", (ctx) => {
  return ctx.reply(
    "🔐 برای احراز هویت، لطفاً وارد حساب کاربری خود در سایت TAKORG شوید:",
    Markup.inlineKeyboard([
      [
        Markup.button.url(
          "🔐 ورود / احراز هویت",
          "https://takorg.com/colleague/"
        ),
      ],
    ])
  );
});

// =====================================
// پشتیبانی
// =====================================

bot.hears("📞 پشتیبانی", (ctx) => {
  return ctx.reply(
    "📞 بخش پشتیبانی TAKORG\n\nلطفاً شخص موردنظر را انتخاب کنید:",
    Markup.keyboard([
      ["👨‍💼 آقای محمدی"],
      ["👩‍💼 خانم حسین‌زاده"],
      ["🛡 مسئول گارانتی"],
      ["🔙 بازگشت به منوی اصلی"],
    ]).resize()
  );
});

bot.hears("👨‍💼 آقای محمدی", (ctx) => {
  ctx.reply(
    "👨‍💼 آقای محمدی\n\n📞 شماره تماس:\n09058531174\n\n💬 آیدی تلگرام:\n@Mohammadi_Tak"
  );
});

bot.hears("👩‍💼 خانم حسین‌زاده", (ctx) => {
  ctx.reply(
    "👩‍💼 خانم حسین‌زاده\n\n📞 شماره تماس:\n09058531170\n\n💬 آیدی تلگرام:\n@Hosseinzadeh_TAK"
  );
});

bot.hears("🛡 مسئول گارانتی", (ctx) => {
  ctx.reply(
    "🛡 مسئول گارانتی\n\n📞 شماره تماس:\n09058531174\n\n💬 آیدی تلگرام:\n@Mohammadi_Tak"
  );
});

// =====================================
// بازگشت
// =====================================

bot.hears("🔙 بازگشت به منوی اصلی", (ctx) => {
  return showMainMenu(ctx);
});

// =====================================
// مدیریت خطاهای غیرمنتظره (جلوگیری از کرش کامل ربات)
// =====================================

process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("⚠️ Uncaught Exception:", err);
});

bot.catch((err, ctx) => {
  console.error(`⚠️ Bot Error [${ctx.updateType}]:`, err);
});

// =====================================
// سرور کوچک برای رفع مشکل پورت روی Render
// =====================================

const http = require("http");

http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("Bot is running");
  })
  .listen(process.env.PORT || 3000, () => {
    console.log(
      "🌐 Health check server is listening on port",
      process.env.PORT || 3000
    );
  });

// =====================================
// خودپینگ (Self-Ping) برای جلوگیری از خوابیدن
// سرویس رایگان Render
// روی Render، متغیر RENDER_EXTERNAL_URL به‌صورت
// خودکار ست می‌شود؛ اگر روی هاست دیگری هستید،
// آن را در .env با کلید SELF_URL مقدار دهی کنید.
// =====================================

const SELF_URL =
  process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL || null;

if (SELF_URL) {
  const https = require("https");

  const PING_INTERVAL_MS = 5 * 60 * 1000; // هر ۵ دقیقه

  setInterval(() => {
    https
      .get(SELF_URL, (res) => {
        console.log(`🔄 Self-ping انجام شد. Status: ${res.statusCode}`);
      })
      .on("error", (err) => {
        console.error("⚠️ Self-ping Error:", err.message);
      });
  }, PING_INTERVAL_MS);

  console.log(`🔁 Self-ping فعال شد روی: ${SELF_URL}`);
} else {
  console.log(
    "ℹ️ Self-ping غیرفعال است (SELF_URL یا RENDER_EXTERNAL_URL تنظیم نشده)."
  );
}

// =====================================
// اجرای ربات
// =====================================

(async () => {
  try {
    const restoredUsers = await loadUsers();
    for (const [telegramId, userData] of restoredUsers.entries()) {
      users.set(telegramId, userData);
    }
  } catch (err) {
    console.error("⚠️ خطا در بارگذاری کاربرهای ذخیره‌شده:", err.message);
  }

  bot.launch().catch((err) => {
    console.error("❌ Launch Error:", err);
  });

  console.log("🤖 TAKORG Bot V4 is running...");
})();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));