const axios = require("axios");
require("dotenv").config();

const api = axios.create({
  baseURL: `${process.env.WC_URL}/wp-json/wc/v3`,
  auth: {
    username: process.env.WC_KEY,
    password: process.env.WC_SECRET,
  },
});

async function getCategories() {
  const { data } = await api.get("/products/categories", {
    params: {
      per_page: 50,
      hide_empty: true,
    },
  });

  return data;
}

async function getProductsByCategory(categoryName) {
  const { data: categories } = await api.get("/products/categories", {
    params: {
      search: categoryName,
    },
  });

  if (!categories.length) return [];

  const categoryId = categories[0].id;

  const { data: products } = await api.get("/products", {
    params: {
      category: categoryId,
      per_page: 10,
      status: "publish",
      stock_status: "instock", // فقط محصولات موجود
    },
  });

  return products;
}

module.exports = {
  getCategories,
  getProductsByCategory,
};