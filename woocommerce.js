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
  timeout: 15000,
});

// ===============================
// دریافت دسته‌بندی‌ها
// فقط دسته‌های نهایی (Leaf Categories)
// ===============================
async function getCategories() {
  try {
    const { data } = await api.get("/products/categories", {
      params: {
        per_page: 100,
        hide_empty: true,
      },
    });

    // فقط دسته‌هایی که زیرشاخه ندارند
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
// categoryName = اسم دسته (مثلاً AUX)
// ===============================
async function getProductsByCategory(categoryName) {
  try {
    // پیدا کردن شناسه دسته
    const categories = await getCategories();

    const category = categories.find(
      (cat) =>
        cat.name.toLowerCase() === categoryName.toLowerCase()
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
// جستجوی محصول
// ===============================
async function searchProducts(keyword) {
  try {
    const { data } = await api.get("/products", {
      params: {
        search: keyword,
        per_page: 20,
        status: "publish",
      },
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
// خروجی توابع
// ===============================
module.exports = {
  getCategories,
  getProductsByCategory,
  searchProducts,
  getLatestProducts,
};