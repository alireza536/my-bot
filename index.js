require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");
const {
  getCategories,
  getProductsByCategory,
  searchProducts,
} = require("./woocommerce");

const bot = new Telegraf(process.env.BOT_TOKEN);

// ذخیره وضعیت جستجوی کاربران
const searchMode = new Map();

// ===============================
// منوی اصلی
// ===============================
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

// ===============================
// شروع ربات
// ===============================
bot.start((ctx) => showMainMenu(ctx));

// ===============================
// مشاهده دسته‌بندی‌ها
// ===============================
bot.hears("🛍 مشاهده محصولات", async (ctx) => {
  try {
    const categories = await getCategories();

    const buttons = categories.map((cat) => [cat.name]);
    buttons.push(["🔙 بازگشت به منوی اصلی"]);

    ctx.reply(
      "📂 یک دسته‌بندی را انتخاب کنید:",
      Markup.keyboard(buttons).resize()
    );
  } catch (err) {
    console.error(err.message);
    ctx.reply("❌ خطا در دریافت دسته‌بندی‌ها.");
  }
});

// ===============================
// انتخاب دسته‌بندی
// ===============================
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

  // منوها رد شوند
  if (menuButtons.includes(text)) return next();

  // حالت جستجو
  if (searchMode.get(ctx.from.id)) {
    try {
      const products = await searchProducts(text);

      if (!products.length) {
        return ctx.reply("❌ محصولی پیدا نشد.");
      }

      searchMode.delete(ctx.from.id);

      for (const product of products) {
        const image = product.images?.length
          ? product.images[0].src
          : null;

        const caption =
`🛍 *${product.name}*

💰 قیمت: *${Number(product.price).toLocaleString("fa-IR")} تومان*

${product.short_description.replace(/<[^>]*>/g, "").substring(0,150)}`;

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
          });
        }
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
      const image = product.images?.length
        ? product.images[0].src
        : null;

      const caption =
`🛍 *${product.name}*

💰 قیمت: *${Number(product.price).toLocaleString("fa-IR")} تومان*

${product.short_description.replace(/<[^>]*>/g, "").substring(0,150)}`;

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
        });
      }
    }
  } catch (err) {
    console.error(err.message);
  }
});

// ===============================
// جستجو
// ===============================
bot.hears("🔍 جستجوی محصول", (ctx) => {
  searchMode.set(ctx.from.id, true);

  ctx.reply(
    "🔎 نام محصول را وارد کنید.\n\nمثلاً:\n• اسپیکر JBL\n• کابل آیفون\n• ساعت هوشمند",
    Markup.keyboard([["🔙 بازگشت به منوی اصلی"]]).resize()
  );
});

// ===============================
// سبد خرید
// ===============================
bot.hears("🛒 سبد خرید", (ctx) => {
  ctx.reply(
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

// ===============================
// سفارش‌های من
// ===============================
bot.hears("📦 سفارش‌های من", (ctx) => {
  ctx.reply(
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

// ===============================
// پشتیبانی
// ===============================
bot.hears("📞 پشتیبانی", (ctx) => {
  ctx.reply(
    "📞 بخش پشتیبانی TAKORG\n\nلطفاً واحد موردنظر را انتخاب کنید:",
    Markup.keyboard([
      ["👨‍💼 آقای محمدی"],
      ["👩‍💼 خانم حسین‌زاده"],
      ["🛡 مسئول گارانتی"],
      ["🔙 بازگشت به منوی اصلی"],
    ]).resize()
  );
});

// آقای محمدی
bot.hears("👨‍💼 آقای محمدی", (ctx) => {
  ctx.reply(`👨‍💼 آقای محمدی

📞 شماره تماس:
09058531174

💬 آیدی تلگرام:
@Mohammadi_Tak`);
});

// خانم حسین‌زاده
bot.hears("👩‍💼 خانم حسین‌زاده", (ctx) => {
  ctx.reply(`👩‍💼 خانم حسین‌زاده

📞 شماره تماس:
09058531170

💬 آیدی تلگرام:
@Hosseinzadeh_TAK`);
});

// مسئول گارانتی
bot.hears("🛡 مسئول گارانتی", (ctx) => {
  ctx.reply(`🛡 مسئول گارانتی

📞 شماره تماس:
09058531174

💬 آیدی تلگرام:
@Mohammadi_Tak`);
});

// بازگشت
bot.hears("🔙 بازگشت به منوی اصلی", (ctx) => {
  showMainMenu(ctx);
});

// ===============================
// اجرای ربات
// ===============================
bot.launch();

console.log("🤖 TAKORG Bot V3 is running...");