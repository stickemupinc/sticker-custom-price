// 1) server/app.js
// -----------------------------------------------------------------------------

// Install deps: npm i express body-parser node-fetch crypto dotenv

import express from 'express';
import bodyParser from 'body-parser';
import crypto from 'crypto';
import { createTempVariant } from './shopify.js';
import { handleOrdersCreate, handleCheckoutsUpdate, nightlyCleanup } from './cleanup.js';

const app = express();
import cors from 'cors';

app.use(cors({
  origin: [
    'https://stickemupshop.myshopify.com',
    'https://p0mfabzpasrjdwhq-79229288684.shopifypreview.com'
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(bodyParser.json());

// ENV required
// SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
// SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_...
// HOST_PRODUCT_ID=gid://shopify/Product/1234567890  OR  numeric ID (we normalize)
// CLEANUP_TTL_HOURS=48  (how long to keep temp variants if not purchased)

function normalizeGid(id) {
  return String(id).startsWith('gid://') ? id : `gid://shopify/Product/${id}`;
}

app.post('/api/custom-sticker', async (req, res) => {
  try {
    const { title, price, width, height, qty, finish, vinyl, skuPrefix = 'CUST' } = req.body || {};

    // Basic validation
    if (!price || !qty || !width || !height || !vinyl) {
      return res.status(400).json({ error: 'Missing required fields: price, qty, width, height, vinyl' });
    }

    const nowIso = new Date().toISOString();
    const hash = crypto.createHash('sha1').update(`${vinyl}|${finish}|${width}|${height}|${qty}|${price}|${nowIso}`).digest('hex').slice(0, 10);

    // Build variant payload
    const variant = {
      options: [ `${width}x${height} in · ${qty} qty` ],
      price: Number(price).toFixed(2),
      sku: `${skuPrefix}-${hash}`,
      taxable: true,
      weight: 0,
      requires_shipping: true,
      inventory_management: null,
      inventory_policy: 'continue',
      metafields: [
        { namespace: 'custom', key: 'ephemeral', type: 'boolean', value: 'true' },
        { namespace: 'custom', key: 'hash', type: 'single_line_text_field', value: hash },
        { namespace: 'custom', key: 'expires_at', type: 'single_line_text_field', value: new Date(Date.now() + (Number(process.env.CLEANUP_TTL_HOURS || 48) * 3600 * 1000)).toISOString() },
        { namespace: 'custom', key: 'config', type: 'json', value: JSON.stringify({ title, price, width, height, qty, finish, vinyl }) },
      ]
    };

    const productId = normalizeGid(process.env.HOST_PRODUCT_ID);
    const created = await createTempVariant(productId, variant);

    return res.json({ variant_id: created.id, gid: created.admin_graphql_api_id, sku: created.sku });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error creating custom variant' });
  }
});

// Webhooks (optional but recommended)
app.post('/webhooks/orders/create', handleOrdersCreate);
app.post('/webhooks/checkouts/update', handleCheckoutsUpdate);

// Nightly cleanup (attach to your scheduler)
app.get('/ops/cleanup', nightlyCleanup);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Custom price app listening on ${PORT}`));

// -----------------------------------------------------------------------------
