// server/app.js
// -----------------------------------------------------------------------------
// Install deps in package.json:
//   express body-parser cors crypto dotenv node-fetch
// -----------------------------------------------------------------------------

import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { createTempVariant } from './shopify.js';
import { registerCleanupRoutes } from './cleanup.js';

dotenv.config();

const app = express();

// CORS: your store + preview
app.use(cors({
  origin: [
    'https://stickemupshop.myshopify.com',
    'https://p0mfabzpasrjdwhq-79229288684.shopifypreview.com',
    /\.shopifypreview\.com$/,
    /\.myshopify\.com$/
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

app.use(bodyParser.json());

function requireEnv(name) {
  const v = process.env[name];
  if (!v) console.error(`❌ Missing env: ${name}`);
  return v;
}

app.get('/health', (_req, res) => res.json({ ok: true }));

// Create temp variant for the hidden host product
app.post('/api/custom-sticker', async (req, res) => {
  try {
    const { title, price, width, height, qty, finish, vinyl, skuPrefix = 'CUST' } = req.body || {};

    if (!price || !qty || !width || !height || !vinyl) {
      return res.status(400).json({ error: 'Missing required fields: price, qty, width, height, vinyl' });
    }

    const nowIso = new Date().toISOString();
    const hash = crypto.createHash('sha1')
      .update(`${vinyl}|${finish}|${width}|${height}|${qty}|${price}|${nowIso}`)
      .digest('hex')
      .slice(0, 10);

    const variant = {
      options: [ `${width}x${height} in · ${qty} qty` ],
      price: Number(price).toFixed(2),
      sku: `${skuPrefix}-${hash}`,
      taxable: true,
      weight: 0,
      requires_shipping: true,
      inventory_management: null,
      inventory_policy: 'continue'
    };

    const productIdRaw = requireEnv('HOST_PRODUCT_ID');
    const productIdNum = Number(String(productIdRaw).replace(/\D/g, '')); // numeric only
    if (!productIdNum) {
      return res.status(500).json({ error: 'HOST_PRODUCT_ID must be a numeric product ID' });
    }

    const created = await createTempVariant(productIdNum, variant);

    return res.json({
      variant_id: created?.id,
      sku: created?.sku || variant.sku,
      message: 'Variant created'
    });
  } catch (err) {
    console.error('❌ /api/custom-sticker failed:', err);
    return res.status(500).json({ error: 'Server error creating custom variant' });
  }
});

// Register manual cleanup route
registerCleanupRoutes(app);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Custom price app listening on ${PORT}`);
});
