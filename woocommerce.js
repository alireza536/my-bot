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

function normalizePhone(phone = "") {
  let value = String(phone).replace(/[^\d+]/g, "");

  if (value.startsWith("+98")) {
    value = "0" + value.slice(3);
  }

  if (value.startsWith("0098")) {
    value = "0" + value.slice(4);
  }

  if (value.startsWith("98") && value.length === 12) {
    value = "0" + value.slice(2);
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
// دریافت کاربران ووکامرس (اصلاح‌شده: همه نقش‌ها)
// =====================================

async function getAllCustomers() {
  try {
    let page = 1;
    let allUsers = [];

    while (true) {
      const { data } = await api.get("/customers", {
        params: {
          per_page: 100,
          page,
          role: "all", // <-- بدون این، فقط نقش customer برمی‌گرده
        },
      });

      allUsers.push(...data);

      if (data.length < 100) break;

      page++;
    }

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
// پیدا کردن کاربر بر اساس شماره موبایل
// =====================================

async function findUserByPhone(phone) {
  try {
    const normalized = normalizePhone(phone);

    if (!normalized) return null;

    const users = await getAllCustomers();

    const user = users.find((user) => {
      const billingPhone = normalizePhone(
        user.billing?.phone || ""
      );

      const shippingPhone = normalizePhone(
        user.shipping?.phone || ""
      );

      return (
        billingPhone === normalized ||
        shippingPhone === normalized
      );
    });

    if (!user) return null;

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role || "customer",
      firstName: user.first_name,
      lastName: user.last_name,
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
// تشخیص نقش کاربر
// =====================================

function getUserRole(user) {
  if (!user) return "guest";

  const role = String(user.role || "").toLowerCase();

  if (
    role === "shop_manager" ||
    role === "wholesale_customer" ||
    role === "b2b_customer" ||
    role === "partner" ||
    role === "hamkar"
  ) {
    return "hamkar";
  }

  if (role === "customer") {
    return "customer";
  }

  return "customer";
}

// =====================================
// دریافت قیمت بر اساس نقش
// =====================================

function getProductPrice(product, role = "guest") {
  let price = product.price;

  if (role === "hamkar") {
    price = getMeta(product, [
      "_price_role_hamkar",
      "_hamkar_price",
      "_wholesale_price",
      "_employee_price",
    ]);
  }

  if (role === "customer") {
    price = getMeta(product, [
      "_price_role_customer",
      "_customer_price",
    ]);
  }

  if (!price) {
    price = product.price;
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
  findUserByPhone,
  getUserRole,
  getProductPrice,
  formatPrice,
  normalizePhone,
};