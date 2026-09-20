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
} = require("./woocommerce");

const { saveUsers, loadUsers } = require("./store");

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

// =====================================
// منوی اصلی
// =====================================

function showMainMenu(ctx) {
  searchMode.delete(ctx.from.id);

  return ctx.reply(
    "🛍 *به فروشگاه TAKORG خوش آمدید*\n\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:",
    {
      parse_mode: "Markdown",
      ...Markup.keyboard([
        ["🛍 مشاهده محصولات", "🔍 جستجوی محصول"],
        ["📄 دریافت لیست کامل قیمت"],
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

  return showMainMenu(ctx);
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

    // شماره خام دریافتی از تلگرام را با همان تابع نرمال‌ساز
    // مشترکِ woocommerce.js به فرمت یکسان "9123456789" تبدیل می‌کنیم
    // تا با شماره‌های ذخیره‌شده در سایت همیشه یکسان مقایسه شود.
    const rawPhone = contact.phone_number;
    const phone = normalizePhone(rawPhone);

    console.log(
      `📞 [Telegram] شماره خام دریافتی: ${rawPhone} | نرمال‌شده: ${phone}`
    );

    await ctx.reply("🔍 در حال بررسی شماره شما در سایت...");

    const user = await findUserByPhone(phone);

    const role = getUserRole(user) || "customer";

    users.set(telegramId, {
      telegramId,
      phone,
      role,
      customerId: user?.id || null,
      firstName: user?.firstName || null,
      lastName: user?.lastName || null,
      user,
    });

    // ذخیرهٔ ماندگار (بی‌صدا در پس‌زمینه؛ اگه شکست بخوره
    // ربات همچنان با حافظهٔ موقت کار می‌کنه)
    saveUsers(users);

    if (user) {
      if (role === "hamkar") {
        await ctx.reply(
          "✅ شماره شما تأیید شد.\n\n👨‍💼 نقش شما: مشتری همکار\n\nقیمت‌های مشتری همکار برای شما نمایش داده می‌شود."
        );
      } else {
        await ctx.reply(
          "✅ شماره شما تأیید شد.\n\n👤 نقش شما: مشتری تکی\n\nقیمت‌های مشتری تکی برای شما نمایش داده می‌شود."
        );
      }
    } else {
      await ctx.reply(
        "❌ شماره شما در سایت TAKORG ثبت نشده است.\n\nاگر قبلاً ثبت‌نام کرده‌اید، مطمئن شوید شماره ثبت‌شده در سایت با شماره تلگرام یکسان است."
      );
    }

    return showMainMenu(ctx);
  } catch (err) {
    console.error("Contact Error:", err.message);

    return ctx.reply(
      "❌ خطا در بررسی شماره. لطفاً دوباره تلاش کنید."
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
    "📦 برای مشاهده سفارش‌های خود، ابتدا وارد حساب کاربری شوید.",
    Markup.inlineKeyboard([
      [
        Markup.button.url(
          "📦 ورود و مشاهده سفارش‌ها",
          "https://takorg.com/my-account/orders/"
        ),
      ],
    ])
  );
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