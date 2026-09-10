require("dotenv").config();
const axios = require("axios");

// ====================================
// اتصال به ووکامرس TAKORG
// ====================================
const api = axios.create({
  baseURL: `${process.env.WC_URL}/wp-json/wc/v3`,
  auth: {
    username: process.env.WC_KEY,
    password: process.env.WC_SECRET,
  },
  timeout: 15000,
});

// ====================================
// دریافت دسته‌بندی‌های ووکامرس
// فقط زیر دسته‌ها (دسته‌های مادر حذف می‌شوند)
// ====================================
async function getCategories() {
  const { data } = await api.get("/products/categories", {
    params: {
      per_page: 100,
      hide_empty: true,
    },
  });

  // فقط زیر دسته‌ها
  return data.filter((cat) => cat.parent !== 0);
}
// ====================================
// دریافت محصولات یک دسته‌بندی
// ====================================
async function getProductsByCategory(categoryId) {
  const { data } = await api.get("/products", {
    params: {
      category: categoryId,
      per_page: 20,
      status: "publish",
      orderby: "date",
      order: "desc",
    },
  });

  return data;
}

// ====================================
// دریافت یک محصول با شناسه
// (برای مشخصات کامل محصول)
// ====================================
async function getProduct(productId) {
  const { data } = await api.get(`/products/${productId}`);

  return data;
}
// ====================================
// جستجوی محصولات (نام، مدل، SKU)
// ====================================
async function searchProducts(keyword) {
  // جستجو بر اساس نام محصول
  const { data } = await api.get("/products", {
    params: {
      search: keyword,
      per_page: 20,
      status: "publish",
    },
  });

  // اگر پیدا شد همان را برگردان
  if (data.length > 0) {
    return data;
  }

  // اگر پیدا نشد، بر اساس SKU جستجو کن
  const { data: skuData } = await api.get("/products", {
    params: {
      sku: keyword,
      status: "publish",
    },
  });

  return skuData;
}

// ====================================
// محصولات جدید فروشگاه
// ====================================
async function getLatestProducts() {
  const { data } = await api.get("/products", {
    params: {
      per_page: 10,
      status: "publish",
      orderby: "date",
      order: "desc",
    },
  });

  return data;
}
// ====================================
// محصولات تخفیف‌دار
// ====================================
async function getSaleProducts() {
  const { data } = await api.get("/products", {
    params: {
      on_sale: true,
      per_page: 10,
      status: "publish",
    },
  });

  return data;
}

// ====================================
// محصولات پرفروش
// ====================================
async function getBestSellingProducts() {
  const { data } = await api.get("/products", {
    params: {
      per_page: 10,
      status: "publish",
      orderby: "popularity",
      order: "desc",
    },
  });

  return data;
}

// ====================================
// خروجی توابع
// ====================================
module.exports = {
  getCategories,
  getProductsByCategory,
  getProduct,
  searchProducts,
  getLatestProducts,
  getSaleProducts,
  getBestSellingProducts,
};