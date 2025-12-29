// server/app.js - DRAFT ORDER VERSION (Clean Install)
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const app = express();

app.use(cors({
  origin: [
    'https://stickemupshop.myshopify.com', 
    /\.shopifypreview\.com$/, 
    /\.myshopify\.com$/
  ],
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(bodyParser.json());

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

// 1. Create Draft Order Helper
async function createDraftOrder(items) {
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/draft_orders.json`;
  
  const line_items = items.map(item => ({
    title: item.title,
    quantity: parseInt(item.quantity) || 1,
    // If it's the Custom Sticker, use the Custom Price from properties
    price: item.properties && item.properties['_RealPrice'] 
           ? item.properties['_RealPrice'].replace('$','') 
           : item.price, 
    properties: item.properties || []
  }));

  const payload = {
    draft_order: {
      line_items: line_items,
      use_customer_default_address: true 
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_TOKEN
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.draft_order;
}

// 2. Main Checkout Route
app.post('/api/create-checkout', async (req, res) => {
  try {
    const { items } = req.body;
    if (!items) return res.status(400).json({ error: "No items" });

    const draft = await createDraftOrder(items);
    return res.json({ ok: true, invoice_url: draft.invoice_url });
  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: "Failed to create order" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Backend running on ${PORT}`));
