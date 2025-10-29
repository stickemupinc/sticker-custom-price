// server/app.js
// -----------------------------------------------------------------------------
// Install deps (already in package.json):
// npm i express body-parser cors crypto dotenv
// -----------------------------------------------------------------------------

import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { createTempVariant } from './shopify.js';

dotenv.config();

const app = express();

// CORS: your store + preview domains
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

// ENV needed:
// - SHOPIFY_STORE_DOMAIN=stickemupshop.myshopify.com
// - SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_...
// - HOST_PRODUCT_ID=9055083823340   <-- USE NUMERIC ID (not a gid)

function requireEnv(name) {
  const v = process.env[name];
  if (!v) console.error(`❌ Missing env: ${name}`);
  return v;
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/api/custom-sticker', async (req, res) => {
  try {
    const { title, price, width, height, qty, finish, vinyl, skuPrefix = 'CUST' } = req.body || {};

    // Basic validation
    if (!price || !qty || !width || !height || !vinyl) {
      return res.status(400).json({ error: 'Missing required fields: price, qty, width, height, vinyl' });
    }

    // Build stable-ish SKU for traceability
    const nowIso = new Date().toISOString();
    const hash = crypto
      .createHash('sha1')
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
      // (metafields will be added later after create succeeds)
    };

    const productIdRaw = requireEnv('HOST_PRODUCT_ID');
    const productIdNum = Number(String(productIdRaw).replace(/\D/g, '')); // ensure numeric
    if (!productIdNum) {
      return res.status(500).json({ error: 'HOST_PRODUCT_ID must be a numeric product ID' });
    }

    const created = await createTempVariant(productIdNum, variant);

    // Respond with the new variant id for /cart/add.js
    return res.json({
      variant_id: created?.id,
      sku: created?.sku || variant.sku
    });
  } catch (err) {
    console.error('❌ /api/custom-sticker failed:', err);
    return res.status(500).json({ error: 'Server error creating custom variant' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Custom price app listening on ${PORT}`);
});
