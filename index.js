require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

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
        ["📄 دریافت لیست کامل محصولات"],
        ["🛒 سبد خرید", "📦 سفارش‌های من"],
        ["📞 پشتیبانی", "🔐 احراز هویت"],
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
// ساخت PDF لیست کامل محصولات
// =====================================

// فونت فارسی مورد نیاز برای نمایش صحیح حروف فارسی در PDF.
// چون فونت‌های پیش‌فرض pdfkit (Helvetica و ...) اصلاً گلیف
// فارسی/عربی ندارند، باید یک فایل فونت TTF فارسی (مثلاً
// Vazirmatn-Regular.ttf) در مسیر زیر قرار بگیرد:
// fonts/Vazirmatn-Regular.ttf (کنار همین فایل index.js)
const PERSIAN_FONT_PATH = path.join(__dirname, "fonts", "ttf", "Vazirmatn-Regular.ttf");

// pdfkit هیچ شکل‌دهی (shaping) یا بازآرایی راست‌به‌چپ برای
// حروف فارسی/عربی انجام نمی‌دهد و متن را همیشه از چپ به راست
// رسم می‌کند. برای اینکه ترتیب کلمات و حروفِ فارسی روی صفحه
// درست دیده شود (بدون نیاز به کتابخانه شکل‌دهی جداگانه)،
// هر خط را کلمه‌به‌کلمه بررسی می‌کنیم: کلماتی که حرف فارسی
// دارند معکوس می‌شوند و سپس کل ترتیب کلمات هم معکوس می‌شود.
// اعداد، SKU و لینک (که فارسی نیستند) دست‌نخورده باقی می‌مانند.
const PERSIAN_LETTER_REGEX =
  /[\u0621-\u064A\u067E\u0686\u0698\u06A9\u06AF\u06CC\u06CE]/;

function reshapeToken(token) {
  return PERSIAN_LETTER_REGEX.test(token)
    ? token.split("").reverse().join("")
    : token;
}

function rtl(text = "") {
  return String(text)
    .split(" ")
    .map(reshapeToken)
    .reverse()
    .join(" ");
}

// تولید فایل PDF لیست کامل محصولات بر اساس نقش کاربر (hamkar/customer)
// خروجی: مسیر فایل PDF ساخته‌شده روی دیسک
function generateProductsPDF(role, outputPath) {
  return new Promise(async (resolve, reject) => {
    try {
      const products = await getAllProducts();

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      const hasPersianFont = fs.existsSync(PERSIAN_FONT_PATH);

      if (hasPersianFont) {
        doc.registerFont("Persian", PERSIAN_FONT_PATH);
        doc.font("Persian");
      } else {
        console.warn(
          "⚠️ فونت فارسی در مسیر fonts/Vazirmatn-Regular.ttf پیدا نشد؛ " +
            "بدون این فونت متن فارسی در PDF به‌درستی نمایش داده نمی‌شود. " +
            "لطفاً یک فایل فونت فارسی TTF در پوشه fonts/ پروژه قرار دهید."
        );
      }

      // عنوان
      doc.fontSize(18).text(rtl("TAKORG — لیست کامل محصولات"), {
        align: "center",
      });

      doc.moveDown(0.3);

      const now = new Date();
      const dateStr =
        now.toLocaleDateString("fa-IR") + " - " + now.toLocaleTimeString("fa-IR");

      doc.fontSize(10).text(rtl(`تاریخ تولید فایل: ${dateStr}`), {
        align: "center",
      });

      doc.moveDown();
      doc
        .moveTo(40, doc.y)
        .lineTo(555, doc.y)
        .strokeColor("#999999")
        .stroke();
      doc.moveDown();

      if (!products.length) {
        doc
          .fontSize(12)
          .text(rtl("هیچ محصول موجودی برای نمایش یافت نشد."), {
            align: "right",
          });
      }

      for (const product of products) {
        // اگر نزدیک انتهای صفحه بودیم، صفحه جدید باز کن
        if (doc.y > 720) {
          doc.addPage();
        }

        const price = getProductPrice(product, role);
        const priceText = formatPrice(price);
        const sku =
          product.sku && String(product.sku).trim()
            ? product.sku
            : "—";
        const categoryNames =
          (product.categories || []).map((c) => c.name).join("، ") || "—";
        const link = product.permalink || "";

        doc
          .fontSize(13)
          .fillColor("#111111")
          .text(rtl(`نام محصول: ${product.name}`), { align: "right" });

        doc
          .fontSize(11)
          .fillColor("#333333")
          .text(rtl(`کد کالا: ${sku}`), { align: "right" })
          .text(rtl(`دسته‌بندی: ${categoryNames}`), { align: "right" })
          .text(rtl(`قیمت: ${priceText} تومان`), { align: "right" });

        if (link) {
          doc
            .fillColor("#1155cc")
            .text(link, { align: "left", link, underline: true })
            .fillColor("#333333");
        }

        doc.moveDown(0.4);
        doc
          .moveTo(40, doc.y)
          .lineTo(555, doc.y)
          .strokeColor("#dddddd")
          .stroke();
        doc.moveDown(0.6);
      }

      doc.end();

      stream.on("finish", () => resolve(outputPath));
      stream.on("error", (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

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

bot.hears("📄 دریافت لیست کامل محصولات", async (ctx) => {
  const telegramId = ctx.from.id;
  const userData = users.get(telegramId);
  const role = userData?.role === "hamkar" ? "hamkar" : "customer";

  let filePath = null;

  try {
    await ctx.reply("⏳ در حال آماده‌سازی فایل PDF...");

    filePath = path.join(
      __dirname,
      `takorg-products-${telegramId}-${Date.now()}.pdf`
    );

    await generateProductsPDF(role, filePath);

    await ctx.replyWithDocument({
      source: filePath,
      filename: "TAKORG-Products.pdf",
    });

    await ctx.reply("✅ فایل لیست محصولات آماده و ارسال شد.");
  } catch (err) {
    console.error("❌ PDF Generation Error:", err);

    return ctx.reply(
      "❌ خطا در ساخت فایل PDF. لطفاً دوباره تلاش کنید."
    );
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlink(filePath, (err) => {
        if (err) {
          console.error("⚠️ خطا در حذف فایل موقت PDF:", err.message);
        }
      });
    }
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
    "📄 دریافت لیست کامل محصولات",
    "🛒 سبد خرید",
    "📦 سفارش‌های من",
    "📞 پشتیبانی",
    "🔐 احراز هویت",
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

bot.launch().catch((err) => {
  console.error("❌ Launch Error:", err);
});

console.log("🤖 TAKORG Bot V4 is running...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));