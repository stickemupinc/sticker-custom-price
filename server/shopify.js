// -----------------------------------------------------------------------------
// server/shopify.js  (REST API)
// -----------------------------------------------------------------------------

import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const SHOPIFY_STORE_DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
const SHOPIFY_ADMIN_ACCESS_TOKEN = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();

if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
  console.error('❌ Missing env SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN');
}

function adminUrl(path) {
  return `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01${path}`;
}

function last4(s) {
  return (s || '').slice(-4);
}

async function readJson(res, context = '') {
  const text = await res.text();
  if (!text) {
    throw new Error(`Empty response from Shopify — status ${res.status}${context ? ` (${context})` : ''}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error('❌ JSON parse failed', { context, status: res.status, text });
    throw e;
  }
  if (!res.ok || data?.errors) {
    console.error('❌ Shopify returned errors:', data?.errors || text, { context, status: res.status });
    throw new Error(typeof data?.errors === 'string' ? data.errors : 'Shopify error');
  }
  return data;
}

async function postJson(url, body, context) {
  console.log('➡️  POST', url, 'body:', JSON.stringify(body, null, 2));
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
    },
    body: JSON.stringify(body),
  });
  console.log('⬅️ ', context, 'status:', res.status, res.statusText);
  return readJson(res, context);
}

// -----------------------------------------------------------------------------
// Create variant (try product-scoped, then global), then add metafields
// -----------------------------------------------------------------------------
export async function createTempVariant(productId, variant, meta = {}) {
  const pid = Number(productId);
  if (!Number.isFinite(pid)) {
    throw new Error(`productId is not numeric: ${productId}`);
  }

  // Log basic env so we can verify we're hitting the right shop
  console.log('🛠️  createTempVariant env:', {
    SHOPIFY_STORE_DOMAIN,
    token_last4: last4(SHOPIFY_ADMIN_ACCESS_TOKEN),
    productId: pid,
  });

  // Minimal variant payload (same fields for both attempts)
  const variantBody = {
    price: variant.price,
    sku: variant.sku,
    taxable: !!variant.taxable,
    inventory_policy: variant.inventory_policy || 'continue',
    inventory_management: variant.inventory_management ?? null,
    requires_shipping: !!variant.requires_shipping,
    grams: 0,
    option1: variant.options?.[0] || 'Custom',
  };

  // 1) Preferred: product-scoped endpoint
  let created;
  try {
    const url1 = adminUrl(`/products/${pid}/variants.json`);
    const body1 = { variant: variantBody };
    const data1 = await postJson(url1, body1, 'createVariant(product-scoped)');
    created = data1.variant;
  } catch (e) {
    // Only fallback on 404 (Not Found). Otherwise, surface the error.
    const msg = String(e.message || e);
    if (!/not found/i.test(msg) && !/404/.test(msg)) {
      throw e;
    }
    console.warn('⚠️  product-scoped endpoint 404 — falling back to global /variants.json');

    const url2 = adminUrl('/variants.json');
    const body2 = { variant: { ...variantBody, product_id: pid } };
    const data2 = await postJson(url2, body2, 'createVariant(global)');
    created = data2.variant;
  }

  // 2) Add metafields on the variant via nested endpoint (most reliable)
  if (created?.id) {
    const metas = [
      { namespace: 'custom', key: 'ephemeral',  type: 'boolean',               value: String(!!meta.ephemeral) },
      { namespace: 'custom', key: 'hash',       type: 'single_line_text_field', value: String(meta.hash || '') },
      { namespace: 'custom', key: 'expires_at', type: 'single_line_text_field', value: String(meta.expires_at || '') },
      { namespace: 'custom', key: 'config',     type: 'json',                   value: JSON.stringify(meta.config || {}) },
    ];

    for (const m of metas) {
      // Skip empty values to avoid 422s
      if (m.value === '' || m.value === 'null' || m.value === 'undefined') continue;

      const mfUrl = adminUrl(`/variants/${created.id}/metafields.json`);
      try {
        await postJson(mfUrl, { metafield: m }, `metafield ${m.namespace}.${m.key}`);
      } catch (err) {
        console.error('❌ Metafield create failed:', m, err.message || err);
        // Non-fatal: keep the variant even if a metafield fails
      }
    }
  }

  return created;
}

// -----------------------------------------------------------------------------
// Helpers (optional)
// -----------------------------------------------------------------------------
export async function deleteVariant(variantId) {
  const res = await fetch(adminUrl(`/variants/${variantId}.json`), {
    method: 'DELETE',
    headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN },
  });
  console.log('🗑️  deleteVariant status:', res.status);
  return res.status;
}

export async function getProductVariants(productId) {
  const url = adminUrl(`/products/${productId}/variants.json`);
  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
      'Accept': 'application/json',
    },
  });
  return readJson(res, 'getProductVariants'); // -> { variants: [...] }
}
