require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");

const {
  getCategories,
  getProductsByCategory,
  searchProducts,
  findUserByPhone,
  getUserRole,
  getProductPrice,
  formatPrice,
  normalizePhone,
} = require("./woocommerce");

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
        ["🛒 سبد خرید", "📦 سفارش‌های من"],
        ["📞 پشتیبانی"],
      ]).resize(),
    }
  );
}

// =====================================
// درخواست شماره موبایل
// =====================================

function requestPhone(ctx) {
  return ctx.reply(
    "📱 برای مشاهده قیمت محصولات، ابتدا شماره موبایل خود را ارسال کنید.",
    Markup.keyboard([
      [
        Markup.button.contactRequest("📱 ارسال شماره موبایل")
      ],
    ])
      .oneTime()
      .resize()
  );
}

// =====================================
// استارت ربات
// =====================================

bot.start(async (ctx) => {
  const telegramId = ctx.from.id;

  const existing = users.get(telegramId);

  // اگر کاربر قبلاً در همین اجرا شماره‌اش را ارسال و تأیید کرده،
  // دیگر شماره نخواه و مستقیم منوی اصلی را نشان بده.
  if (existing) {
    const name = existing.firstName ? `${existing.firstName} عزیز، ` : "";

    await ctx.reply(
      `🛍 *${name}به فروشگاه TAKORG خوش آمدید*`,
      { parse_mode: "Markdown" }
    );

    return showMainMenu(ctx);
  }

  searchMode.delete(telegramId);

  await ctx.reply(
    "🛍 *به فروشگاه TAKORG خوش آمدید*\n\nبرای شروع، شماره موبایل خود را ارسال کنید.",
    { parse_mode: "Markdown" }
  );

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

    if (user) {
      if (role === "hamkar") {
        await ctx.reply(
          "✅ شماره شما تأیید شد.\n\n👨‍💼 نقش شما: همکار\n\nقیمت‌های همکاری برای شما نمایش داده می‌شود."
        );
      } else {
        await ctx.reply(
          "✅ شماره شما تأیید شد.\n\n👤 نقش شما: مشتری\n\nقیمت‌های مشتری برای شما نمایش داده می‌شود."
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
    if (!users.has(ctx.from.id)) {
      return requestPhone(ctx);
    }

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
// نمایش محصول با قیمت نقش
// =====================================

async function sendProduct(ctx, product) {
  const telegramId = ctx.from.id;

  const userData = users.get(telegramId);

  const role = userData?.role || "guest";

  const price = getProductPrice(product, role);

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
    "🛒 سبد خرید",
    "📦 سفارش‌های من",
    "📞 پشتیبانی",
    "👨‍💼 آقای محمدی",
    "👩‍💼 خانم حسین‌زاده",
    "🛡 مسئول گارانتی",
    "🔙 بازگشت به منوی اصلی",
  ];

  if (menuButtons.includes(text)) {
    return next();
  }

  if (!users.has(ctx.from.id)) {
    return requestPhone(ctx);
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
  if (!users.has(ctx.from.id)) {
    return requestPhone(ctx);
  }

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
// اجرای ربات
// =====================================

bot.launch().catch((err) => {
  console.error("❌ Launch Error:", err);
});

console.log("🤖 TAKORG Bot V4 is running...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));