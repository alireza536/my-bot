const axios = require("axios");
require("dotenv").config();

const api = axios.create({
  baseURL: `${process.env.WC_URL}/wp-json/wc/v3`,
  auth: {
    username: process.env.WC_KEY,
    password: process.env.WC_SECRET,
  },
});

// دریافت دسته‌بندی‌ها
async function getCategories() {
  const { data } = await api.get("/products/categories", {
    params: {
      per_page: 50,
    },
  });

  return data;
}

// دریافت محصولات یک دسته
async function getProducts(categoryId = "") {
  const { data } = await api.get("/products", {
    params: {
      per_page: 10,
      category: categoryId,
      status: "publish",
    },
  });

  return data;
}

module.exports = { getCategories, getProducts };