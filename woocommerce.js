const axios = require("axios");
require("dotenv").config();

// =====================================
// اتصال به ووکامرس
// =====================================

const api = axios.create({
  baseURL: `${process.env.WC_URL}/wp-json/wc/v3`,
  auth: {
    username: process.env.WC_KEY,
    password: process.env.WC_SECRET,
  },
  timeout: 20000,
});

// =====================================
// ابزارها
// =====================================

function clean(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, "")
    .toLowerCase()
    .trim();
}

// =====================================
// نرمال‌سازی شماره موبایل
// همه فرمت‌های ورودی (09123456789 / 989123456789 /
// +989123456789 / 9123456789) به فرمت یکسان
// "9123456789" (بدون صفر و بدون کد کشور) تبدیل می‌شوند
// تا مقایسه‌ها همیشه درست انجام شود.
// =====================================

function normalizePhone(phone = "") {
  let value = String(phone).replace(/[^\d+]/g, "");

  if (value.startsWith("+98")) {
    value = value.slice(3);
  } else if (value.startsWith("0098")) {
    value = value.slice(4);
  } else if (value.startsWith("98") && value.length === 12) {
    value = value.slice(2);
  } else if (value.startsWith("0")) {
    value = value.slice(1);
  }

  return value;
}

function getMeta(product, keys = []) {
  const meta = product.meta_data || [];

  for (const key of keys) {
    const item = meta.find((m) => m.key === key);

    if (
      item &&
      item.value !== null &&
      item.value !== undefined &&
      String(item.value).trim() !== ""
    ) {
      return String(item.value);
    }
  }

  return null;
}

// =====================================
// لیست دستی شماره‌های همکار
// برای همکارهایی که هنوز روی سایت حساب کاربری
// نساخته‌اند (یا نقششان درست ثبت نشده) ولی باید
// قیمت همکاری ببینند. شماره‌ها را در متغیر محیطی
// HAMKAR_PHONES با کاما از هم جدا کن، مثلاً:
// HAMKAR_PHONES=09121111111,09122222222,+989123334455
// =====================================

const HAMKAR_PHONES = (process.env.HAMKAR_PHONES || "")
  .split(",")
  .map((p) => normalizePhone(p.trim()))
  .filter(Boolean);

function isManualHamkar(normalizedPhone) {
  return HAMKAR_PHONES.includes(normalizedPhone);
}

// =====================================
// دریافت دسته‌بندی‌ها
// =====================================

async function getCategories() {
  try {
    const { data } = await api.get("/products/categories", {
      params: {
        per_page: 100,
        hide_empty: true,
      },
    });

    return data.filter((cat) => {
      const hasChild = data.some(
        (item) => item.parent === cat.id
      );

      return !hasChild && cat.count > 0;
    });
  } catch (err) {
    console.error(
      "Category Error:",
      err.response?.data || err.message
    );

    return [];
  }
}

// =====================================
// دریافت محصولات یک دسته
// =====================================

async function getProductsByCategory(categoryName) {
  try {
    const categories = await getCategories();

    const category = categories.find(
      (cat) => clean(cat.name) === clean(categoryName)
    );

    if (!category) return [];

    const { data } = await api.get("/products", {
      params: {
        category: category.id,
        per_page: 20,
        status: "publish",
        stock_status: "instock",
      },
    });

    return data.filter(
      (product) =>
        product.stock_status === "instock" &&
        product.catalog_visibility !== "hidden"
    );
  } catch (err) {
    console.error(
      "Products Error:",
      err.response?.data || err.message
    );

    return [];
  }
}

// =====================================
// جستجوی محصول
// =====================================

async function searchProducts(keyword) {
  try {
    const q = clean(keyword);

    let { data } = await api.get("/products", {
      params: {
        search: keyword,
        per_page: 50,
        status: "publish",
        stock_status: "instock",
      },
    });

    data = data.filter(
      (product) =>
        product.stock_status === "instock" &&
        product.catalog_visibility !== "hidden"
    );

    if (data.length > 0) return data;

    const res = await api.get("/products", {
      params: {
        per_page: 100,
        status: "publish",
        stock_status: "instock",
      },
    });

    data = res.data.filter((product) => {
      if (product.stock_status !== "instock") return false;

      const name = clean(product.name);
      const desc = clean(product.description);
      const shortDesc = clean(product.short_description);
      const sku = clean(product.sku);

      return (
        name.includes(q) ||
        desc.includes(q) ||
        shortDesc.includes(q) ||
        sku.includes(q)
      );
    });

    return data;
  } catch (err) {
    console.error(
      "Search Error:",
      err.response?.data || err.message
    );

    return [];
  }
}

// =====================================
// محصولات جدید
// =====================================

async function getLatestProducts() {
  try {
    const { data } = await api.get("/products", {
      params: {
        per_page: 10,
        status: "publish",
        stock_status: "instock",
        orderby: "date",
        order: "desc",
      },
    });

    return data.filter((p) => p.stock_status === "instock");
  } catch (err) {
    console.error(
      "Latest Error:",
      err.response?.data || err.message
    );

    return [];
  }
}

// =====================================
// محصولات تخفیف‌دار
// =====================================

async function getSaleProducts() {
  try {
    const { data } = await api.get("/products", {
      params: {
        on_sale: true,
        per_page: 10,
        status: "publish",
        stock_status: "instock",
      },
    });

    return data.filter((p) => p.stock_status === "instock");
  } catch (err) {
    console.error(
      "Sale Error:",
      err.response?.data || err.message
    );

    return [];
  }
}

// =====================================
// محصولات پرفروش
// =====================================

async function getBestSellingProducts() {
  try {
    const { data } = await api.get("/products", {
      params: {
        per_page: 10,
        status: "publish",
        stock_status: "instock",
        orderby: "popularity",
        order: "desc",
      },
    });

    return data.filter((p) => p.stock_status === "instock");
  } catch (err) {
    console.error(
      "Best Seller Error:",
      err.response?.data || err.message
    );

    return [];
  }
}

// =====================================
// دریافت کاربران ووکامرس (همه صفحات)
// =====================================

// =====================================
// دریافت همهٔ محصولات (صفحه‌بندی‌شده)
// برای استفاده در ابزار ممیزی قیمت
// =====================================

async function getAllProducts(extraParams = {}) {
  try {
    let page = 1;
    let allProducts = [];

    while (true) {
      const { data } = await api.get("/products", {
        params: {
          per_page: 100,
          page,
          status: "publish",
          ...extraParams,
        },
      });

      allProducts.push(...data);

      if (data.length < 100) break;
      page++;
    }

    return allProducts;
  } catch (err) {
    console.error(
      "Products Error:",
      err.response?.data || err.message
    );
    return [];
  }
}

async function getAllCustomers() {
  try {
    let page = 1;
    let allUsers = [];

    while (true) {
      const { data } = await api.get("/customers", {
        params: {
          per_page: 100,
          page,
          // پیش‌فرض ووکامرس فقط role=customer رو برمی‌گردونه؛
          // با role=all کاربرهایی با نقش‌های دیگه (مثل همکار،
          // wholesale_customer، shop_manager و ...) هم لحاظ می‌شن.
          role: "all",
        },
      });

      allUsers.push(...data);

      if (data.length < 100) break;
      page++;
    }

    console.log(`👥 [WooCommerce] تعداد کل کاربران دریافت‌شده (role=all): ${allUsers.length}`);

    return allUsers;
  } catch (err) {
    console.error(
      "Users Error:",
      err.response?.data || err.message
    );
    return [];
  }
}

// =====================================
// جستجوی شماره در سفارش‌ها (شامل سفارش‌های مهمان/guest)
// این تابع وقتی اجرا می‌شود که شماره در بین کاربران
// ثبت‌نام‌شده (/customers) پیدا نشود؛ چون کسی که فقط
// «مهمان» سفارش داده باشد اصلاً در /customers نیست ولی
// شماره‌اش در billing سفارش ثبت شده.
// =====================================

// =====================================
// برچسب فارسی وضعیت سفارش
// =====================================

const ORDER_STATUS_LABELS = {
  pending: "⏳ در انتظار پرداخت",
  processing: "🔄 در حال پردازش",
  "on-hold": "⏸ در انتظار (نگه‌داشته‌شده)",
  completed: "✅ تکمیل و ارسال‌شده",
  cancelled: "❌ لغو شده",
  refunded: "↩️ مسترد شده",
  failed: "⚠️ پرداخت ناموفق",
  trash: "🗑 حذف‌شده",
  checkout_draft: "📝 پیش‌نویس (ثبت نشده)",
};

function getOrderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] || status;
}

// =====================================
// پیدا کردن یک سفارش خاص با شماره سفارش،
// مشروط به تطبیق شماره موبایل (برای امنیت،
// تا کسی نتونه فقط با حدس زدن کد، سفارش
// دیگران رو ببینه)
// =====================================

async function getOrderByIdAndPhone(orderId, normalizedPhone) {
  try {
    const { data: order } = await api.get(`/orders/${orderId}`);

    const orderPhone = normalizePhone(order.billing?.phone || "");

    if (orderPhone !== normalizedPhone) {
      return null;
    }

    return order;
  } catch (err) {
    if (err.response?.status === 404) {
      return null;
    }

    console.error(
      "Order Lookup Error:",
      err.response?.data || err.message
    );
    return null;
  }
}

async function findOrderByPhone(normalizedPhone) {
  try {
    let page = 1;
    const maxPages = 5; // حداکثر ۵۰۰ سفارش اخیر بررسی می‌شود

    while (page <= maxPages) {
      const { data } = await api.get("/orders", {
        params: {
          per_page: 100,
          page,
          orderby: "date",
          order: "desc",
        },
      });

      if (!data.length) break;

      const order = data.find(
        (o) => normalizePhone(o.billing?.phone || "") === normalizedPhone
      );

      if (order) return order;

      if (data.length < 100) break;
      page++;
    }

    return null;
  } catch (err) {
    console.error(
      "Order Search Error:",
      err.response?.data || err.message
    );
    return null;
  }
}

// =====================================
// پیدا کردن کاربر بر اساس شماره موبایل
// (billing.phone و shipping.phone هر دو بررسی می‌شوند)
// =====================================

async function findUserByPhone(phone) {
  try {
    console.log(`📥 [Auth] شماره ورودی خام: ${phone}`);

    const normalized = normalizePhone(phone);

    console.log(`🔍 [Auth] شماره نرمال‌شده جهت جستجو: ${normalized}`);

    if (!normalized) {
      console.log("⚠️ [Auth] شماره ورودی نامعتبر بود (خالی پس از نرمال‌سازی).");
      return null;
    }

    const users = await getAllCustomers();

    console.log(
      `📊 [Auth] تعداد کاربران دریافت‌شده از ووکامرس: ${users.length}`
    );

    let matchedRawPhone = null;
    let matchedField = null;

    const user = users.find((u) => {
      // ترتیب اولویت بررسی شماره:
      // 1) billing.phone  2) shipping.phone
      // 3) متادیتای mobile / phone / billing_phone / shipping_phone / digits_phone(_no)
      const fieldsToCheck = [
        ["billing.phone", u.billing?.phone],
        ["shipping.phone", u.shipping?.phone],
        ["meta:mobile", getMeta(u, ["mobile"])],
        ["meta:phone", getMeta(u, ["phone"])],
        ["meta:billing_phone", getMeta(u, ["billing_phone"])],
        ["meta:shipping_phone", getMeta(u, ["shipping_phone"])],
        ["meta:digits_phone", getMeta(u, ["digits_phone"])],
        ["meta:digits_phone_no", getMeta(u, ["digits_phone_no"])],
      ];

      for (const [fieldName, rawValue] of fieldsToCheck) {
        if (rawValue && normalizePhone(rawValue) === normalized) {
          matchedRawPhone = rawValue;
          matchedField = fieldName;
          return true;
        }
      }

      return false;
    });

    if (user) {
      console.log(
        `✅ [Auth] کاربر پیدا شد (از /customers) → ID: ${user.id} | نام: ${
          user.first_name || ""
        } ${user.last_name || ""} | نقش: ${
          user.role || "customer"
        } | فیلد منطبق: ${matchedField} | شماره یافت‌شده: ${matchedRawPhone}`
      );

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role || "customer",
        firstName: user.first_name,
        lastName: user.last_name,
        phone: normalized,
      };
    }

    console.log(
      `⚠️ [Auth] شماره ${normalized} در بین ${users.length} کاربر ثبت‌نام‌شده پیدا نشد؛ حالا لیست دستی همکارها بررسی می‌شود...`
    );

    // فالبک ۱: لیست دستی همکارهایی که هنوز حساب کاربری نساخته‌اند
    if (isManualHamkar(normalized)) {
      console.log(
        `✅ [Auth] شماره ${normalized} توی لیست دستی همکارها (HAMKAR_PHONES) پیدا شد.`
      );

      return {
        id: null,
        username: null,
        email: null,
        role: "hamkar",
        firstName: null,
        lastName: null,
        phone: normalized,
      };
    }

    console.log(
      `⚠️ [Auth] شماره ${normalized} توی لیست دستی همکارها هم نبود؛ حالا سفارش‌ها (شامل مهمان) بررسی می‌شود...`
    );

    // فالبک ۲: شاید کاربر حساب کاربری نساخته و فقط به‌صورت
    // مهمان (guest) سفارش ثبت کرده — این حالت در /customers نیست
    const order = await findOrderByPhone(normalized);

    if (!order) {
      console.log(
        `❌ [Auth] شماره ${normalized} نه در کاربران ثبت‌نام‌شده و نه در سفارش‌های اخیر پیدا نشد.`
      );
      return null;
    }

    console.log(
      `✅ [Auth] کاربر از طریق سفارش مهمان پیدا شد → Order ID: ${order.id} | نام: ${
        order.billing?.first_name || ""
      } ${order.billing?.last_name || ""} | شماره: ${order.billing?.phone}`
    );

    return {
      id: order.customer_id || null,
      username: null,
      email: order.billing?.email || null,
      role: "customer",
      firstName: order.billing?.first_name || null,
      lastName: order.billing?.last_name || null,
      phone: normalized,
    };
  } catch (err) {
    console.error(
      "Find User Error:",
      err.response?.data || err.message
    );

    return null;
  }
}

// =====================================
// تشخیص نقش کاربر (همکار / مشتری)
// =====================================

function getUserRole(user) {
  if (!user) return "guest";

  const role = String(user.role || "").toLowerCase();

  const hamkarRoles = [
    "hamkar",
    "wholesale_customer",
    "shop_manager",
    "partner",
    "b2b_customer",
    "reseller",
    "dealer",
  ];

  if (hamkarRoles.includes(role)) {
    return "hamkar";
  }

  return "customer";
}

// =====================================
// دریافت قیمت بر اساس نقش
// ترتیب اولویت کلیدهای Meta برای قیمت همکار
// =====================================

const HAMKAR_PRICE_KEYS = [
  // کلیدهای واقعی که با Inspect روی خود سایت TAKORG پیدا شدن
  "_tak_partner_sale_price", // قیمت فروش ویژه همکاری (در صورت وجود، اولویت داره)
  "_tak_partner_price", // قیمت همکاری
  // کلیدهای احتمالی قدیمی (برای اطمینان، اگه جایی استفاده شده باشن)
  "_hamkar_price",
  "_wholesale_price",
  "_price_role_hamkar",
  "wholesale_customer_wholesale_price",
  "wholesale_price",
  "_employee_price",
];

function getProductPrice(product, role = "customer") {
  let price = product.price;

  if (role === "hamkar") {
    const hamkarPrice = getMeta(product, HAMKAR_PRICE_KEYS);

    if (hamkarPrice) {
      price = hamkarPrice;
    }
  }

  return Number(price || 0);
}

// =====================================
// فرمت قیمت
// =====================================

function formatPrice(price) {
  return Number(price || 0).toLocaleString("fa-IR");
}

// =====================================
// خروجی
// =====================================

module.exports = {
  getCategories,
  getProductsByCategory,
  searchProducts,
  getLatestProducts,
  getSaleProducts,
  getBestSellingProducts,
  getAllProducts,
  getMeta,
  HAMKAR_PRICE_KEYS,
  findUserByPhone,
  getUserRole,
  getProductPrice,
  formatPrice,
  normalizePhone,
  getOrderByIdAndPhone,
  getOrderStatusLabel,
};