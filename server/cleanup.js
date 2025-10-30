// server/cleanup.js
// -----------------------------------------------------------------------------
// Exposes a GET /ops/cleanup route handler that:
// - Lists variants on the hidden host product
// - Picks "temporary" variants older than a TTL (defaults 168h = 7 days)
// - If dry_run=1 -> returns a preview only
// - If dry_run=0 -> deletes those variants and returns a summary
//
// Query params:
//   ttl_hours: number (optional, default 168)
//   dry_run:   1|0 (optional; default 1)
//
// Notes:
// - We consider variants with SKU starting with "CUST-" as ephemeral
// - We also skip any variant that looks like your base/seed (no CUST- prefix)
// -----------------------------------------------------------------------------

import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const HOST_PRODUCT_ID = Number(String(process.env.HOST_PRODUCT_ID || '').replace(/\D/g, '') || 0);

function assertEnv() {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN || !HOST_PRODUCT_ID) {
    throw new Error('Missing env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN, or HOST_PRODUCT_ID');
  }
}

async function jsonOrThrow(res, context = '') {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`${context || 'request'}: invalid JSON (${res.status}) — ${text}`);
  }
  if (!res.ok) {
    const msg = data?.errors ? JSON.stringify(data.errors) : text || res.statusText;
    throw new Error(`${context || 'request'} failed: ${msg}`);
  }
  return data;
}

async function listProductVariants(productId) {
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/products/${productId}/variants.json?limit=250`;
  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
      'Accept': 'application/json',
    }
  });
  const data = await jsonOrThrow(res, 'listProductVariants');
  return Array.isArray(data?.variants) ? data.variants : [];
}

async function deleteVariant(variantId) {
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/variants/${variantId}.json`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
      'Accept': 'application/json',
    }
  });
  // Shopify returns empty body on success; treat 200/204 as OK
  if (res.status === 200 || res.status === 204) return true;
  // If not OK, try to surface JSON error if present
  try {
    await jsonOrThrow(res, 'deleteVariant');
  } catch (e) {
    throw e;
  }
  return true;
}

function pickCandidates(variants, ttlHours) {
  const now = Date.now();
  const ageMs = (iso) => (now - new Date(iso).getTime());
  const ttlMs = (Number(ttlHours) || 168) * 3600 * 1000;

  return variants
    .filter(v => typeof v?.id === 'number')
    // ephemeral heuristic: our created items have SKU like "CUST-xxxxx"
    .filter(v => typeof v?.sku === 'string' && v.sku.startsWith('CUST-'))
    // ensure they’re old enough
    .filter(v => v?.created_at && ageMs(v.created_at) >= ttlMs)
    .map(v => ({
      id: v.id,
      sku: v.sku,
      title: v.title,
      created_at: v.created_at,
      age_hours: Math.floor(ageMs(v.created_at) / 3600000)
    }));
}

// -----------------------------------------------------------------------------
// Exported express handler
// -----------------------------------------------------------------------------
export async function nightlyCleanup(req, res) {
  try {
    assertEnv();

    const ttlHours = Number(req.query.ttl_hours ?? req.query.ttl ?? 168) || 168;
    const dryRun = (String(req.query.dry_run ?? '1') === '1');

    const variants = await listProductVariants(HOST_PRODUCT_ID);
    const candidates = pickCandidates(variants, ttlHours);

    if (dryRun) {
      return res.json({
        ok: true,
        dry_run: true,
        host_product_id: HOST_PRODUCT_ID,
        ttl_hours: ttlHours,
        total_variants: variants.length,
        candidates: candidates.length,
        preview: candidates
      });
    }

    // destructive mode
    const results = [];
    for (const c of candidates) {
      try {
        await deleteVariant(c.id);
        results.push({ ...c, deleted: true });
      } catch (e) {
        results.push({ ...c, deleted: false, error: String(e.message || e) });
      }
    }

    return res.json({
      ok: true,
      dry_run: false,
      host_product_id: HOST_PRODUCT_ID,
      ttl_hours: ttlHours,
      deleted_count: results.filter(r => r.deleted).length,
      results
    });
  } catch (err) {
    console.error('❌ nightlyCleanup error:', err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}

// Optional webhook stubs so app.js can import them if needed
export function handleOrdersCreate(_req, res) { res.status(200).send('ok'); }
export function handleCheckoutsUpdate(_req, res) { res.status(200).send('ok'); }
