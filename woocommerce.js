const axios = require("axios");
require("dotenv").config();

// ===============================
// اتصال به ووکامرس
// ===============================
const api = axios.create({
  baseURL: `${process.env.WC_URL}/wp-json/wc/v3`,
  auth: {
    username: process.env.WC_KEY,
    password: process.env.WC_SECRET,
  },
  timeout: 20000,
});

// حذف تگ‌های HTML
function clean(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, "")
    .toLowerCase()
    .trim();
}

// ===============================
// دریافت دسته‌بندی‌ها
// فقط دسته‌های نهایی که محصول موجود دارند
// ===============================
async function getCategories() {
  try {
    const { data } = await api.get("/products/categories", {
      params: {
        per_page: 100,
        hide_empty: true,
      },
    });

    return data.filter((cat) => {
      const hasChild = data.some((item) => item.parent === cat.id);
      return !hasChild && cat.count > 0;
    });
  } catch (err) {
    console.error("Category Error:", err.response?.data || err.message);
    return [];
  }
}

// ===============================
// دریافت محصولات یک دسته
// فقط محصولات موجود
// ===============================
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
        stock_status: "instock", // فقط موجود
      },
    });

    return data.filter(
      (product) =>
        product.stock_status === "instock" &&
        product.catalog_visibility !== "hidden"
    );
  } catch (err) {
    console.error("Products Error:", err.response?.data || err.message);
    return [];
  }
}

// ===============================
// جستجوی محصول
// فقط محصولات موجود
// ===============================
async function searchProducts(keyword) {
  try {
    const q = clean(keyword);

    // جستجوی مستقیم ووکامرس
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

    // اگر پیدا نشد، جستجوی دستی بین محصولات موجود
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
    console.error("Search Error:", err.response?.data || err.message);
    return [];
  }
}

// ===============================
// محصولات جدید (فقط موجود)
// ===============================
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
    console.error("Latest Error:", err.response?.data || err.message);
    return [];
  }
}

// ===============================
// محصولات تخفیف‌دار (فقط موجود)
// ===============================
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
    console.error("Sale Error:", err.response?.data || err.message);
    return [];
  }
}

// ===============================
// محصولات پرفروش (فقط موجود)
// ===============================
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
    console.error("Best Seller Error:", err.response?.data || err.message);
    return [];
  }
}

// ===============================
// خروجی توابع
// ===============================
module.exports = {
  getCategories,
  getProductsByCategory,
  searchProducts,
  getLatestProducts,
  getSaleProducts,
  getBestSellingProducts,
};