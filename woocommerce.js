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
  return text.replace(/<[^>]*>/g, "").toLowerCase();
}

// ===============================
// دریافت دسته‌بندی‌ها
// فقط دسته‌های نهایی که محصول دارند
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
      },
    });

    return data;
  } catch (err) {
    console.error("Products Error:", err.response?.data || err.message);
    return [];
  }
}

// ===============================
// جستجوی محصول (فارسی + انگلیسی + SKU)
// ===============================
async function searchProducts(keyword) {
  try {
    const q = keyword.trim().toLowerCase();

    // جستجوی مستقیم ووکامرس
    let { data } = await api.get("/products", {
      params: {
        search: keyword,
        per_page: 20,
        status: "publish",
      },
    });

    if (data.length > 0) return data;

    // اگر چیزی پیدا نشد، همه محصولات را بگیر و دستی فیلتر کن
    const res = await api.get("/products", {
      params: {
        per_page: 100,
        status: "publish",
      },
    });

    data = res.data.filter((product) => {
      const name = clean(product.name);
      const desc = clean(product.description);
      const shortDesc = clean(product.short_description);
      const sku = (product.sku || "").toLowerCase();

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
// محصولات جدید
// ===============================
async function getLatestProducts() {
  try {
    const { data } = await api.get("/products", {
      params: {
        per_page: 10,
        status: "publish",
        orderby: "date",
        order: "desc",
      },
    });

    return data;
  } catch (err) {
    console.error("Latest Error:", err.response?.data || err.message);
    return [];
  }
}

// ===============================
// محصولات تخفیف‌دار
// ===============================
async function getSaleProducts() {
  try {
    const { data } = await api.get("/products", {
      params: {
        on_sale: true,
        per_page: 10,
        status: "publish",
      },
    });

    return data;
  } catch (err) {
    console.error("Sale Error:", err.response?.data || err.message);
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
};