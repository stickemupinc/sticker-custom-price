// server/cleanup.js
// -----------------------------------------------------------------------------
// Manual cleanup of temp variants created by the calculator.
// Deletes variants on your hidden host product whose SKUs start with "CUST-"
// and are older than TTL_HOURS (default 48h).
//
// Usage (safe preview / dry-run):
//   GET /ops/cleanup-manual
//   GET /ops/cleanup-manual?dry=1   (default)
// To actually delete:
//   GET /ops/cleanup-manual?dry=0
// -----------------------------------------------------------------------------

import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const HOST_PRODUCT_ID_RAW = process.env.HOST_PRODUCT_ID;
const TTL_HOURS = Number(process.env.CLEANUP_TTL_HOURS || 48);

// Ensure numeric product id
const HOST_PRODUCT_ID = Number(String(HOST_PRODUCT_ID_RAW || '').replace(/\D/g, '') || 0);

function requireEnv(name, val) {
  if (!val) throw new Error(`Missing env: ${name}`);
}

requireEnv('SHOPIFY_STORE_DOMAIN', SHOPIFY_STORE_DOMAIN);
requireEnv('SHOPIFY_ADMIN_ACCESS_TOKEN', SHOPIFY_ADMIN_ACCESS_TOKEN);
requireEnv('HOST_PRODUCT_ID', HOST_PRODUCT_ID);

async function listAllVariants(productId) {
  // Admin REST: GET /products/{product_id}/variants.json (may need pagination)
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/products/${productId}/variants.json?limit=250`;
  const headers = {
    'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
    'Accept': 'application/json'
  };
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`listAllVariants failed: ${res.status} ${res.statusText} ${text}`);
  }
  const data = JSON.parse(text);
  return data.variants || [];
}

async function deleteVariant(variantId) {
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/variants/${variantId}.json`;
  const headers = {
    'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
    'Accept': 'application/json'
  };
  const res = await fetch(url, { method: 'DELETE', headers });
  return res.status;
}

function hoursBetween(aIso, bIso) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return (b - a) / (1000 * 3600);
}

export function registerCleanupRoutes(app) {
  app.get('/ops/cleanup-manual', async (req, res) => {
    const dry = (req.query.dry ?? '1') !== '0'; // default dry-run
    try {
      const variants = await listAllVariants(HOST_PRODUCT_ID);

      const nowIso = new Date().toISOString();
      const toDelete = [];
      for (const v of variants) {
        const isTemp = typeof v.sku === 'string' && v.sku.startsWith('CUST-');
        const ageH = hoursBetween(v.created_at, nowIso);
        const oldEnough = ageH >= TTL_HOURS;

        if (isTemp && oldEnough) {
          toDelete.push({
            id: v.id,
            sku: v.sku,
            title: v.title,
            created_at: v.created_at,
            age_hours: Math.round(ageH)
          });
        }
      }

      const results = [];
      if (!dry) {
        for (const t of toDelete) {
          const status = await deleteVariant(t.id);
          results.push({ ...t, deleted: status === 200 || status === 204, status });
        }
      }

      return res.json({
        ok: true,
        dry_run: dry,
        host_product_id: HOST_PRODUCT_ID,
        ttl_hours: TTL_HOURS,
        total_variants: variants.length,
        candidates: toDelete.length,
        ...(dry ? { preview: toDelete } : { deleted: results })
      });
    } catch (err) {
      console.error('❌ cleanup-manual failed:', err);
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });
}
