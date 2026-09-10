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

  if (text.includes("ساعت") || text.includes("واچ") || text.includes("watch"))
    return "⌚";

  if (
    text.includes("هدفون") ||
    text.includes("هندزفری") ||
    text.includes("ایرپاد") ||
    text.includes("headphone") ||
    text.includes("earphone")
  )
    return "🎧";

  if (text.includes("اسپیکر") || text.includes("speaker")) return "🔊";

  if (
    text.includes("موبایل") ||
    text.includes("گوشی") ||
    text.includes("phone")
  )
    return "📱";

  if (
    text.includes("لپ تاپ") ||
    text.includes("لپ‌تاپ") ||
    text.includes("laptop")
  )
    return "💻";

  if (text.includes("کامپیوتر") || text.includes("computer")) return "🖥️";

  if (text.includes("مانیتور") || text.includes("monitor")) return "🖥️";

  if (text.includes("کیبورد") || text.includes("keyboard")) return "⌨️";

  if (
    text.includes("ماوس") ||
    text.includes("موس") ||
    text.includes("mouse")
  )
    return "🖱️";

  if (text.includes("کابل") || text.includes("cable")) return "🔌";

  if (
    text.includes("شارژر") ||
    text.includes("شارژ") ||
    text.includes("charger")
  )
    return "🔋";

  if (text.includes("پاوربانک") || text.includes("powerbank")) return "🔋";

  if (text.includes("فلش") || text.includes("flash")) return "💾";

  if (text.includes("دوربین") || text.includes("camera")) return "📷";

  if (text.includes("تلویزیون") || text.includes("tv")) return "📺";

  if (
    text.includes("گیم") ||
    text.includes("بازی") ||
    text.includes("game")
  )
    return "🎮";

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

  if (!cleanText) return "";

  if (cleanText.length <= maxLength) return cleanText;

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
// مشاهده محصولات (دسته‌بندی‌های ووکامرس)
// فقط زیر دسته‌ها نمایش داده می‌شوند
// ===============================
bot.hears("🛍 مشاهده محصولات", async (ctx) => {
  try {
    const session = getSession(ctx.from.id);

    session.searchMode = false;
    session.categories = new Map();

    await ctx.reply("⏳ در حال دریافت دسته‌بندی‌های فروشگاه...");

    // فقط زیر دسته‌ها
    const categories = (await getCategories()).filter(cat => cat.parent !== 0);

    if (!categories.length) {
      return ctx.reply("❌ هیچ دسته‌بندی‌ای پیدا نشد.");
    }

    const buttons = [];

    for (const category of categories) {
      const buttonText = `${getCategoryEmoji(category.name)} ${category.name}`;

      session.categories.set(buttonText, category.id);

      buttons.push([buttonText]);
    }

    buttons.push(["🔙 بازگشت به منوی اصلی"]);

    await ctx.reply(
      "📂 *دسته‌بندی محصولات*\n\nلطفاً دسته موردنظر را انتخاب کنید:",
      {
        parse_mode: "Markdown",
        ...Markup.keyboard(buttons).resize(),
      }
    );
  } catch (error) {
    console.error(error.response?.data || error.message);

    ctx.reply("❌ خطا در دریافت دسته‌بندی‌های فروشگاه.");
  }
});

// ===============================
// دریافت محصولات یک دسته
// ===============================
async function showCategoryProducts(ctx, categoryId) {
  try {
    await ctx.reply("⏳ در حال دریافت محصولات...");

    const products = await getProductsByCategory(categoryId);

    if (!products.length) {
      return ctx.reply("❌ در این دسته محصولی وجود ندارد.");
    }

    await sendProducts(ctx, products);
  } catch (error) {
    console.error(error.response?.data || error.message);

    ctx.reply("❌ خطا در دریافت محصولات.");
  }
}

// ===============================
// ارسال محصولات
// ===============================
async function sendProducts(ctx, products) {
  for (const product of products) {
    try {
      const title = cleanHtml(product.name);

      const price =
        product.price && product.price !== "0"
          ? Number(product.price).toLocaleString("fa-IR") + " تومان"
          : "تماس بگیرید";

      const description = makeShortDescription(
        product.short_description || product.description || "",
        180
      );

      let caption =
        `🛍 *${title}*\n\n` +
        `💰 *${price}*`;

      if (description) {
        caption += `\n\n📝 ${description}`;
      }

      // حداکثر ۵ عکس
      const images = (product.images || [])
        .filter(img => img && img.src)
        .slice(0, 5);

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url("🛒 خرید از سایت", product.permalink)],
      ]);

      // اگر عکس دارد
      if (images.length > 0) {
        await ctx.replyWithMediaGroup(
          images.map((img, index) => ({
            type: "photo",
            media: img.src,
            caption: index === 0 ? caption : undefined,
            parse_mode: "Markdown",
          }))
        );

        await ctx.reply("👇 برای خرید این محصول:", keyboard);
      } else {
        // اگر عکس نداشت
        await ctx.reply(caption, {
          parse_mode: "Markdown",
          ...keyboard,
        });
      }
    } catch (error) {
      console.error("خطا در ارسال محصول:", error.message);
    }
  }
}
// ===============================
// جستجوی محصول
// ===============================
bot.hears("🔍 جستجوی محصول", async (ctx) => {
  const session = getSession(ctx.from.id);

  session.searchMode = true;

  await ctx.reply(
    "🔎 *جستجوی محصول*\n\n" +
    "نام محصول، برند یا مدل را بنویسید.\n\n" +
    "مثلاً:\n" +
    "• اسپیکر JBL\n" +
    "• ساعت هوشمند\n" +
    "• کابل آیفون",
    {
      parse_mode: "Markdown",
      ...Markup.keyboard([["🔙 بازگشت به منوی اصلی"]]).resize(),
    }
  );
});

// ===============================
// مدیریت تمام پیام‌های متنی
// ===============================
bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  const session = getSession(ctx.from.id);

  // اگر دستور بود
  if (text.startsWith("/")) return;

  // -------------------------------
  // حالت جستجوی محصول
  // -------------------------------
  if (session.searchMode) {
    if (text === "🔙 بازگشت به منوی اصلی") {
      session.searchMode = false;
      return showMainMenu(ctx);
    }

    try {
      await ctx.reply("⏳ در حال جستجوی محصول...");

      const products = await searchProducts(text);

      if (!products.length) {
        return ctx.reply(
          `❌ محصولی با عبارت «${text}» پیدا نشد.\n\nلطفاً نام یا مدل را دقیق‌تر وارد کنید.`
        );
      }

      session.searchMode = false;

      await sendProducts(ctx, products);

    } catch (error) {
      console.error(error.response?.data || error.message);

      await ctx.reply("❌ خطا در جستجوی محصول.");
    }

    return;
  }

  // -------------------------------
  // انتخاب دسته‌بندی
  // -------------------------------
  if (session.categories.has(text)) {
    const categoryId = session.categories.get(text);

    await showCategoryProducts(ctx, categoryId);

    return;
  }

  // -------------------------------
  // دکمه‌های اصلی منو
  // -------------------------------
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

  // -------------------------------
  // متن ناشناس
  // -------------------------------
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
    "در نسخه بعدی ربات به ووکامرس متصل می‌شود."
  );
});

// ===============================
// سفارش‌های من
// ===============================
bot.hears("📦 سفارش‌های من", async (ctx) => {
  await ctx.reply(
    "📦 هنوز سفارشی برای حساب شما ثبت نشده است."
  );
});

// ===============================
// پشتیبانی
// ===============================
bot.hears("📞 پشتیبانی", async (ctx) => {
  await ctx.reply(
    "📞 *واحد موردنظر را انتخاب کنید:*",
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
// کارشناس فروش ۱
// ===============================
bot.hears("👨‍💼 آقای محمدی", async (ctx) => {
  await ctx.reply(
    "👨‍💼 *کارشناس فروش*\n\n" +
    "📞 09058531174",
    {
      parse_mode: "Markdown",
    }
  );
});

// ===============================
// کارشناس فروش ۲
// ===============================
bot.hears("👩‍💼 خانم حسین زاده", async (ctx) => {
  await ctx.reply(
    "👩‍💼 *کارشناس فروش*\n\n" +
    "📞 09058531170",
    {
      parse_mode: "Markdown",
    }
  );
});

// ===============================
// مسئول گارانتی
// ===============================
bot.hears("🛡 مسئول گارانتی", async (ctx) => {
  await ctx.reply(
    "🛡 *مسئول گارانتی*\n\n" +
    "📞 09058531171",
    {
      parse_mode: "Markdown",
    }
  );
});

// ===============================
// بازگشت به منوی اصلی
// ===============================
bot.hears("🔙 بازگشت به منوی اصلی", async (ctx) => {
  await showMainMenu(ctx);
});

// ===============================
// مدیریت خطاها
// ===============================
bot.catch((err, ctx) => {
  console.error("BOT ERROR:", err);

  ctx.reply(
    "❌ خطایی در ربات رخ داد.\nلطفاً چند لحظه دیگر دوباره تلاش کنید."
  ).catch(() => {});
});

// ===============================
// اجرای ربات
// ===============================
bot.launch();

console.log("🤖 TAKORG Bot V2 is running...");

// ===============================
// خاموش شدن ایمن
// ===============================
process.once("SIGINT", () => {
  bot.stop("SIGINT");
});

process.once("SIGTERM", () => {
  bot.stop("SIGTERM");
});