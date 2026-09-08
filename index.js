
require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");

const {
  getCategories,
  getProductsByCategory,
  searchProducts,
} = require("./woocommerce");

const bot = new Telegraf(process.env.BOT_TOKEN);

// ===============================
// ذخیره وضعیت کاربران
// ===============================
const userSessions = new Map();

// ===============================
// دریافت وضعیت کاربر
// ===============================
function getSession(userId) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      searchMode: false,
      categories: new Map(),
    });
  }

  return userSessions.get(userId);
}

// ===============================
// ایموجی دسته‌بندی
// ===============================
function getCategoryEmoji(name) {
  const text = String(name || "").toLowerCase();

  if (
    text.includes("ساعت") ||
    text.includes("واچ") ||
    text.includes("watch")
  ) {
    return "⌚";
  }

  if (
    text.includes("هدفون") ||
    text.includes("هندزفری") ||
    text.includes("ایرپاد") ||
    text.includes("headphone") ||
    text.includes("earphone")
  ) {
    return "🎧";
  }

  if (
    text.includes("اسپیکر") ||
    text.includes("speaker")
  ) {
    return "🔊";
  }

  if (
    text.includes("موبایل") ||
    text.includes("گوشی") ||
    text.includes("phone")
  ) {
    return "📱";
  }

  if (
    text.includes("لپ تاپ") ||
    text.includes("لپ‌تاپ") ||
    text.includes("لپتاب") ||
    text.includes("laptop")
  ) {
    return "💻";
  }

  if (
    text.includes("کامپیوتر") ||
    text.includes("computer")
  ) {
    return "🖥️";
  }

  if (
    text.includes("مانیتور") ||
    text.includes("monitor")
  ) {
    return "🖥️";
  }

  if (
    text.includes("کیبورد") ||
    text.includes("keyboard")
  ) {
    return "⌨️";
  }

  if (
    text.includes("ماوس") ||
    text.includes("موس") ||
    text.includes("mouse")
  ) {
    return "🖱️";
  }

  if (
    text.includes("کابل") ||
    text.includes("cable")
  ) {
    return "🔌";
  }

  if (
    text.includes("شارژر") ||
    text.includes("شارژ") ||
    text.includes("charger")
  ) {
    return "🔋";
  }

  if (
    text.includes("فلش") ||
    text.includes("flash")
  ) {
    return "💾";
  }

  if (
    text.includes("دوربین") ||
    text.includes("camera")
  ) {
    return "📷";
  }

  if (
    text.includes("تلویزیون") ||
    text.includes("tv")
  ) {
    return "📺";
  }

  if (
    text.includes("گیم") ||
    text.includes("بازی") ||
    text.includes("game")
  ) {
    return "🎮";
  }

  if (
    text.includes("لوازم جانبی") ||
    text.includes("اکسسوری") ||
    text.includes("accessories")
  ) {
    return "🧩";
  }

  return "📦";
}

// ===============================
// پاک کردن HTML
// ===============================
function cleanHtml(text) {
  return String(text || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ===============================
// کوتاه کردن توضیحات
// ===============================
function makeShortDescription(text, maxLength = 180) {
  const cleanText = cleanHtml(text);

  if (!cleanText) {
    return "";
  }

  if (cleanText.length <= maxLength) {
    return cleanText;
  }

  return cleanText.substring(0, maxLength) + "...";
}

// ===============================
// منوی اصلی
// ===============================
async function showMainMenu(ctx) {
  const session = getSession(ctx.from.id);

  session.searchMode = false;
  session.categories = new Map();

  await ctx.reply(
    "🛍 *به فروشگاه TAKORG خوش آمدید*\n\n" +
    "لطفاً یکی از گزینه‌های زیر را انتخاب کنید:",
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

// ===============================
// شروع ربات
// ===============================
bot.start(async (ctx) => {
  try {
    await showMainMenu(ctx);
  } catch (error) {
    console.error("خطا در /start:", error.message);
  }
});

// ===============================
// مشاهده محصولات
// ===============================
bot.hears("🛍 مشاهده محصولات", async (ctx) => {
  try {
    const session = getSession(ctx.from.id);

    session.searchMode = false;
    session.categories = new Map();

    await ctx.reply("⏳ در حال دریافت دسته‌بندی‌ها...");

    const categories = await getCategories();

    if (!categories || categories.length === 0) {
      return ctx.reply(
        "❌ هیچ دسته‌بندی نهایی‌ای در فروشگاه پیدا نشد."
      );
    }

    const buttons = [];

    for (const category of categories) {
      const buttonText =
        `${getCategoryEmoji(category.name)} ${category.name}`;

      session.categories.set(
        buttonText,
        category.id
      );

      buttons.push([buttonText]);
    }

    buttons.push(["🔙 بازگشت به منوی اصلی"]);

    await ctx.reply(
      "🛍 *دسته‌بندی محصولات*\n\n" +
      "دسته موردنظر خود را انتخاب کنید:",
      {
        parse_mode: "Markdown",
        ...Markup.keyboard(buttons).resize(),
      }
    );

  } catch (error) {
    console.error(
      "خطا در دریافت دسته‌بندی:",
      error.response?.data || error.message
    );

    await ctx.reply(
      "❌ نتوانستم دسته‌بندی‌های فروشگاه را دریافت کنم."
    );
  }
});

// ===============================
// نمایش محصولات یک دسته
// ===============================
async function showCategoryProducts(ctx, categoryId) {
  try {
    await ctx.reply(
      "⏳ در حال دریافت محصولات..."
    );

    const products =
      await getProductsByCategory(categoryId);

    if (!products || products.length === 0) {
      return ctx.reply(
        "❌ در این دسته‌بندی محصول موجودی وجود ندارد."
      );
    }

    await sendProducts(ctx, products);

  } catch (error) {
    console.error(
      "خطا در دریافت محصولات:",
      error.response?.data || error.message
    );

    await ctx.reply(
      "❌ خطا در دریافت محصولات فروشگاه."
    );
  }
}

// ===============================
// ارسال محصولات
// ===============================
async function sendProducts(ctx, products) {
  if (!products || products.length === 0) {
    return ctx.reply(
      "❌ محصولی پیدا نشد."
    );
  }

  for (const product of products) {
    try {
      const productName =
        cleanHtml(product.name);

      const price =
        product.price && product.price !== "0"
          ? `${product.price} تومان`
          : "تماس بگیرید";

      const description =
        makeShortDescription(
          product.short_description ||
          product.description ||
          "",
          180
        );

      let caption =
        `🛍 ${productName}\n\n` +
        `💰 قیمت: ${price}`;

      if (description) {
        caption +=
          `\n\n📝 ${description}`;
      }

      // ===============================
      // عکس‌های محصول
      // ===============================
      const images =
        Array.isArray(product.images)
          ? product.images
              .filter(
                (image) =>
                  image &&
                  image.src
              )
              .slice(0, 3)
          : [];

      // ===============================
      // دکمه خرید
      // ===============================
      const buyKeyboard =
        Markup.inlineKeyboard([
          [
            Markup.button.url(
              "🛒 خرید از سایت",
              product.permalink
            ),
          ],
        ]);

      // ===============================
      // 3 عکس
      // ===============================
      if (images.length === 3) {
        await ctx.replyWithMediaGroup([
          {
            type: "photo",
            media: images[0].src,
            caption: caption,
          },
          {
            type: "photo",
            media: images[1].src,
          },
          {
            type: "photo",
            media: images[2].src,
          },
        ]);

        await ctx.reply(
          "🛒 برای خرید این محصول:",
          buyKeyboard
        );

        continue;
      }

      // ===============================
      // 2 عکس
      // ===============================
      if (images.length === 2) {
        await ctx.replyWithMediaGroup([
          {
            type: "photo",
            media: images[0].src,
            caption: caption,
          },
          {
            type: "photo",
            media: images[1].src,
          },
        ]);

        await ctx.reply(
          "🛒 برای خرید این محصول:",
          buyKeyboard
        );

        continue;
      }

      // ===============================
      // 1 عکس
      // ===============================
      if (images.length === 1) {
        await ctx.replyWithPhoto(
          images[0].src,
          {
            caption: caption,
            ...buyKeyboard,
          }
        );

        continue;
      }

      // ===============================
      // بدون عکس
      // ===============================
      await ctx.reply(
        caption,
        buyKeyboard
      );

    } catch (error) {
      console.error(
        `خطا در ارسال محصول ${product.id}:`,
        error.response?.data || error.message
      );
    }
  }
}

// ===============================
// جستجوی محصول
// ===============================
bot.hears("🔍 جستجوی محصول", async (ctx) => {
  try {
    const session = getSession(ctx.from.id);

    session.searchMode = true;

    await ctx.reply(
      "🔎 *جستجوی محصول*\n\n" +
      "نام محصول، برند یا مدل موردنظر را بنویسید.\n\n" +
      "مثلاً:\n" +
      "• اسپیکر\n" +
      "• هدفون\n" +
      "• JBL\n" +
      "• AUX\n" +
      "• کابل شارژ",
      {
        parse_mode: "Markdown",
      }
    );

  } catch (error) {
    console.error(
      "خطا در فعال کردن جستجو:",
      error.message
    );
  }
});

// ===============================
// پردازش متن کاربر
// ===============================
bot.on("text", async (ctx) => {
  const text =
    ctx.message.text.trim();

  const userId =
    ctx.from.id;

  const session =
    getSession(userId);

  // ===============================
  // دستورات
  // ===============================
  if (text.startsWith("/")) {
    return;
  }

  // ===============================
  // اگر کاربر در حالت جستجو است
  // ===============================
  if (session.searchMode) {
    try {
      await ctx.reply(
        "🔎 در حال جستجوی محصول..."
      );

      const products =
        await searchProducts(text);

      if (!products || products.length === 0) {
        return ctx.reply(
          `❌ محصولی برای «${text}» پیدا نشد.\n\n` +
          "نام محصول یا مدل را دقیق‌تر وارد کنید."
        );
      }

      // بعد از جستجو همچنان در حالت جستجو می‌ماند
      await sendProducts(
        ctx,
        products
      );

    } catch (error) {
      console.error(
        "خطا در جستجو:",
        error.response?.data || error.message
      );

      await ctx.reply(
        "❌ هنگام جستجوی محصول خطایی رخ داد."
      );
    }

    return;
  }

  // ===============================
  // بررسی دسته‌بندی
  // ===============================
  if (
    session.categories &&
    session.categories.has(text)
  ) {
    const categoryId =
      session.categories.get(text);

    await showCategoryProducts(
      ctx,
      categoryId
    );

    return;
  }

  // ===============================
  // اگر متن یکی از دکمه‌های اصلی بود
  // ===============================
  const menuButtons = [
    "🛍 مشاهده محصولات",
    "🔍 جستجوی محصول",
    "🛒 سبد خرید",
    "📦 سفارش‌های من",
    "📞 پشتیبانی",
    "👨‍💼 آقای محمدی",
    "👩‍💼 خانم حسین زاده",
    "🛡 مسئول گارانتی",
    "🔙 بازگشت به منوی اصلی",
  ];

  if (menuButtons.includes(text)) {
    return;
  }

  // ===============================
  // متن ناشناخته
  // ===============================
  await ctx.reply(
    "❓ لطفاً یکی از گزینه‌های منو را انتخاب کنید."
  );
});

// ===============================
// سبد خرید
// ===============================
bot.hears("🛒 سبد خرید", async (ctx) => {
  await ctx.reply(
    "🛒 سبد خرید شما فعلاً خالی است.\n\n" +
    "در نسخه بعدی مستقیماً به سبد خرید ووکامرس متصل می‌شود."
  );
});

// ===============================
// سفارش‌های من
// ===============================
bot.hears("📦 سفارش‌های من", async (ctx) => {
  await ctx.reply(
    "📦 در نسخه بعدی سفارش‌های واقعی ووکامرس شما اینجا نمایش داده می‌شود."
  );
});

// ===============================
// پشتیبانی
// ===============================
bot.hears("📞 پشتیبانی", async (ctx) => {
  const session =
    getSession(ctx.from.id);

  session.searchMode = false;
  session.categories = new Map();

  await ctx.reply(
    "📞 *بخش پشتیبانی TAKORG*\n\n" +
    "لطفاً واحد موردنظر را انتخاب کنید:",
    {
      parse_mode: "Markdown",
      ...Markup.keyboard([
        ["👨‍💼 آقای محمدی"],
        ["👩‍💼 خانم حسین زاده"],
        ["🛡 مسئول گارانتی"],
        ["🔙 بازگشت به منوی اصلی"],
      ]).resize(),
    }
  );
});

// ===============================
// آقای محمدی
// ===============================
bot.hears("👨‍💼 آقای محمدی", async (ctx) => {
  await ctx.reply(
    "👨‍💼 آقای محمدی\n\n" +
    "📞 شماره تماس:\n" +
    "09058531174"
  );
});

// ===============================
// خانم حسین زاده
// ===============================
bot.hears("👩‍💼 خانم حسین زاده", async (ctx) => {
  await ctx.reply(
    "👩‍💼 خانم حسین زاده\n\n" +
    "📞 شماره تماس:\n" +
    "09058531170"
  );
});

// ===============================
// مسئول گارانتی
// ===============================
bot.hears("🛡 مسئول گارانتی", async (ctx) => {
  await ctx.reply(
    "🛡 مسئول گارانتی\n\n" +
    "🆔 آیدی تلگرام:\n" +
    "@Mohammadi_Tak"
  );
});

// ===============================
// بازگشت به منوی اصلی
// ===============================
bot.hears(
  "🔙 بازگشت به منوی اصلی",
  async (ctx) => {
    try {
      await showMainMenu(ctx);
    } catch (error) {
      console.error(
        "خطا در بازگشت:",
        error.message
      );
    }
  }
);

// ===============================
// مدیریت خطا
// ===============================
bot.catch((error, ctx) => {
  console.error(
    "BOT ERROR:",
    error.response?.data ||
    error.message ||
    error
  );

  ctx.reply(
    "❌ متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید."
  ).catch(() => {});
});

// ===============================
// اجرای ربات
// ===============================
bot.launch();

console.log(
  "🤖 TAKORG Bot is running..."
);

// ===============================
// خاموش شدن صحیح ربات
// ===============================
process.once(
  "SIGINT",
  () => bot.stop("SIGINT")
);

process.once(
  "SIGTERM",
  () => bot.stop("SIGTERM")
);

