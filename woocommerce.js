
const axios = require("axios");
require("dotenv").config();

const api = axios.create({
  baseURL: `${process.env.WC_URL}/wp-json/wc/v3`,
  auth: {
    username: process.env.WC_KEY,
    password: process.env.WC_SECRET,
  },
});

// ===============================
// دریافت دسته‌بندی‌های نهایی
// ===============================
async function getCategories() {
  const { data } = await api.get("/products/categories", {
    params: {
      per_page: 100,
      hide_empty: true,
      orderby: "name",
      order: "asc",
    },
  });

  // پیدا کردن دسته‌هایی که زیرمجموعه دارند
  const parentIds = new Set(
    data
      .filter((category) => category.parent !== 0)
      .map((category) => category.parent)
  );

  // فقط دسته‌های نهایی نمایش داده شوند
  return data.filter(
    (category) =>
      category.parent !== 0 &&
      !parentIds.has(category.id) &&
      category.count > 0
  );
}

// ===============================
// دریافت محصولات یک دسته
// ===============================
async function getProductsByCategory(categoryId) {
  const { data } = await api.get("/products", {
    params: {
      category: categoryId,
      per_page: 50,
      status: "publish",
      stock_status: "instock",
      orderby: "date",
      order: "desc",
    },
  });

  return data;
}

// ===============================
// نرمال‌سازی متن فارسی
// ===============================
function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ى/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ۀ/g, "ه")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/إ/g, "ا")
    .replace(/أ/g, "ا")
    .replace(/آ/g, "ا")
    .replace(/ـ/g, "")
    .replace(/[\u200c\u200d]/g, " ")
    .replace(/[ًٌٍَُِّْ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ===============================
// جستجوی محصولات
// ===============================
async function searchProducts(searchText) {
  const query = normalizeText(searchText);

  if (!query) {
    return [];
  }

  const { data } = await api.get("/products", {
    params: {
      search: searchText,
      per_page: 50,
      status: "publish",
      stock_status: "instock",
    },
  });

  const results = data
    .map((product) => {
      const name = normalizeText(product.name);
      const sku = normalizeText(product.sku);
      const slug = normalizeText(product.slug);

      let score = 0;

      // اسم دقیق محصول
      if (name === query) {
        score += 100;
      }

      // اسم محصول با عبارت شروع شود
      if (name.startsWith(query)) {
        score += 60;
      }

      // عبارت داخل اسم محصول باشد
      if (name.includes(query)) {
        score += 40;
      }

      // SKU
      if (sku === query) {
        score += 100;
      } else if (sku && sku.includes(query)) {
        score += 50;
      }

      // Slug
      if (slug && slug.includes(query)) {
        score += 20;
      }

      // بررسی تک تک کلمات
      const words = query.split(" ").filter(Boolean);

      for (const word of words) {
        if (name.includes(word)) {
          score += 15;
        }
      }

      return {
        product,
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return results.map((item) => item.product);
}

// ===============================
// خروجی توابع
// ===============================
module.exports = {
  getCategories,
  getProductsByCategory,
  searchProducts,
};

