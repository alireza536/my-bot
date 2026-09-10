require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");
const {
  getCategories,
  getProductsByCategory,
} = require("./woocommerce");

const bot = new Telegraf(process.env.BOT_TOKEN);

// ===============================
// منوی اصلی
// ===============================
function showMainMenu(ctx) {
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

// ===============================
// شروع ربات
// ===============================
bot.start((ctx) => {
  showMainMenu(ctx);
});

// ===============================
// مشاهده دسته‌بندی‌های ووکامرس
// ===============================
bot.hears("🛍 مشاهده محصولات", async (ctx) => {
  try {
    const categories = await getCategories();

    if (!categories.length) {
      return ctx.reply("❌ هیچ دسته‌بندی‌ای در فروشگاه پیدا نشد.");
    }

    const buttons = categories.map((cat) => [cat.name]);
    buttons.push(["🔙 بازگشت به منوی اصلی"]);

    ctx.reply(
      "🛍 یک دسته‌بندی را انتخاب کنید:",
      Markup.keyboard(buttons).resize()
    );
  } catch (err) {
    console.error(err.response?.data || err.message);
    ctx.reply("❌ نتوانستم دسته‌بندی‌های فروشگاه را دریافت کنم.");
  }
});

// ===============================
// بازگشت
// ===============================
bot.hears("🔙 بازگشت به منوی اصلی", (ctx) => {
  showMainMenu(ctx);
});

// ===============================
// نمایش محصولات هر دسته
// ===============================
bot.on("text", async (ctx, next) => {
  const text = ctx.message.text;

  const ignoreButtons = [
    "🛍 مشاهده محصولات",
    "🔍 جستجوی محصول",
    "🛒 سبد خرید",
    "📦 سفارش‌های من",
    "📞 پشتیبانی",
    "🔙 بازگشت به منوی اصلی",
  ];

  if (ignoreButtons.includes(text) || text.startsWith("/")) {
    return next();
  }

  try {
    const products = await getProductsByCategory(text);

    if (!products.length) {
      return next();
    }

    for (const product of products) {
      const image =
        product.images.length > 0 ? product.images[0].src : null;

      const caption =
`🛍 *${product.name}*

💰 قیمت: *${product.price} تومان*

${product.short_description
  .replace(/<[^>]*>/g, "")
  .substring(0, 100)}`;

      if (image) {
        await ctx.replyWithPhoto(image, {
          caption,
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.url("🛒 خرید از سایت", product.permalink)],
          ]),
        });
      } else {
        await ctx.reply(caption, {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.url("🛒 خرید از سایت", product.permalink)],
          ]),
        });
      }
    }
  } catch (err) {
    console.error(err.response?.data || err.message);
    ctx.reply("❌ خطا در دریافت محصولات.");
  }
});

// ===============================
// جستجوی محصول
// ===============================
bot.hears("🔍 جستجوی محصول", (ctx) => {
  ctx.reply(
    "🔎 نام محصول را بنویسید.\n\nمثلاً:\n• اسپیکر\n• AUX\n• هدفون"
  );
});

// ===============================
// سبد خرید
// ===============================
bot.hears("🛒 سبد خرید", (ctx) => {
  ctx.reply(
    "🛒 سبد خرید شما فعلاً خالی است.\n\nدر نسخه بعدی مستقیماً به سبد خرید ووکامرس متصل می‌شود."
  );
});

// ===============================
// سفارش‌های من
// ===============================
bot.hears("📦 سفارش‌های من", (ctx) => {
  ctx.reply(
    "📦 در نسخه بعدی سفارش‌های واقعی ووکامرس شما اینجا نمایش داده می‌شود."
  );
});

// ===============================
// پشتیبانی
// ===============================
bot.hears("📞 پشتیبانی", (ctx) => {
  ctx.reply(
    "📞 پشتیبانی فروشگاه TAKORG\n\nپیام خود را ارسال کنید. در نسخه بعدی مستقیماً برای مدیر فروشگاه ارسال می‌شود."
  );
});

// ===============================
// اجرای ربات
// ===============================
bot.launch();

console.log("🤖 TAKORG Bot v3 is running...");