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
} = require("./woocommerce");

const { saveUsers, loadUsers, recordSeenUser, getSeenUsersCount, getAllSeenUserIds, getSeenUsersDetailed } = require("./store");

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

// =====================================
// منوی اصلی
// =====================================

function showMainMenu(ctx) {
  searchMode.delete(ctx.from.id);
  orderTrackState.delete(ctx.from.id);

  return ctx.reply(
    "🛍 *به فروشگاه TAKORG خوش آمدید*\n\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:",
    {
      parse_mode: "Markdown",
      ...Markup.keyboard([
        ["🛍 مشاهده محصولات", "🔍 جستجوی محصول"],
        ["🔥 پیشنهاد ویژه", "📄 دریافت لیست کامل قیمت"],
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

function requestPhone(ctx) {
  return ctx.reply(
    "📱 برای ثبت شماره موبایل خود در سیستم، دکمهٔ زیر را بزنید.",
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

    for (const product of products) {
      await sendProduct(ctx, product);
    }
  } catch (err) {
    console.error("Special Offer Error:", err.message);
    return ctx.reply("❌ خطا در دریافت پیشنهادهای ویژه.");
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

async function sendProduct(ctx, product) {
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

  if (image) {
    return ctx.replyWithPhoto(image, {
      caption,
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [
          Markup.button.url(
            "🛒 خرید از سایت",
            product.permalink
          ),
        ],
      ]),
    });
  }

  return ctx.reply(caption, {
    parse_mode: "Markdown",
  });
}

// =====================================
// انتخاب دسته‌بندی و جستجو
// =====================================

bot.on("text", async (ctx, next) => {
  const text = ctx.message.text;

  const menuButtons = [
    "🛍 مشاهده محصولات",
    "🔍 جستجوی محصول",
    "🔥 پیشنهاد ویژه",
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

  if (menuButtons.includes(text)) {
    return next();
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

      for (const product of products) {
        await sendProduct(ctx, product);
      }

      return;
    } catch (err) {
      console.error(err.message);

      return ctx.reply("❌ خطا در جستجو.");
    }
  }

  // دسته‌بندی
  try {
    const products = await getProductsByCategory(text);

    if (!products.length) return;

    for (const product of products) {
      await sendProduct(ctx, product);
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