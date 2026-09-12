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
        Markup.button.contactRequest("📱 ارسال شماره موبایل"),
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

  users.delete(telegramId);
  searchMode.delete(telegramId);

  await ctx.reply(
    "🛍 *به فروشگاه TAKORG خوش آمدید*\n\nبرای شروع، شماره موبایل خود را ارسال کنید.",
    { parse_mode: "Markdown" }
  );

  return requestPhone(ctx);
});

// =====================================
// دستور تست نقش (فقط برای دیباگ - بعداً حذف کن)
// =====================================

bot.command("checkrole", async (ctx) => {
  try {
    const parts = ctx.message.text.split(" ");
    const phone = parts[1];

    if (!phone) {
      return ctx.reply(
        "لطفاً اینطور بنویس:\n/checkrole 09058531174"
      );
    }

    await ctx.reply(
      `📱 شماره ورودی: ${phone}\n` +
      `🔄 شماره نرمال‌شده: ${normalizePhone(phone)}`
    );

    const user = await findUserByPhone(phone);
    const role = getUserRole(user);

    if (!user) {
      return ctx.reply(
        `❌ هیچ کاربری با این شماره پیدا نشد.`
      );
    }

    return ctx.reply(
      `👤 کاربر پیدا شد: ${user.username}\n` +
      `📞 شماره ذخیره‌شده کاربر: ${user.phone}\n` +
      `🔑 role واقعی تو دیتابیس: ${user.role}\n` +
      `🎯 role تشخیص‌داده‌شده: ${role}`
    );
  } catch (err) {
    console.error("Checkrole Error:", err.message);
    return ctx.reply("❌ خطا در بررسی.");
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
    `👨‍💼 آقای محمدی\n\n📞 شماره تماس:\n09058531174\n\n💬 آیدی تلگرام:\n@Mohammadi_Tak`
  );
});

bot.hears("👩‍💼 خانم حسین‌زاده", (ctx) => {
  ctx.reply(
    `👩‍💼 خانم حسین‌زاده\n\n📞 شماره تماس:\n09058531170\n\n💬 آیدی تلگرام:\n@Hosseinzadeh_TAK`
  );
});

bot.hears("🛡 مسئول گارانتی", (ctx) => {
  ctx.reply(
    `🛡 مسئول گارانتی\n\n📞 شماره تماس:\n09058531174\n\n💬 آیدی تلگرام:\n@Mohammadi_Tak`
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