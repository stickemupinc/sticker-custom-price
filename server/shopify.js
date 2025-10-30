// -----------------------------------------------------------------------------
// server/shopify.js  (REST API)
// -----------------------------------------------------------------------------

import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
  console.error('❌ Missing Shopify env vars SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN');
}

function adminUrl(path) {
  return `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01${path}`;
}

async function jsonOrThrow(res, context = '') {
  const text = await res.text();
  if (!text) {
    throw new Error(`Empty response from Shopify — status ${res.status}${context ? ` (${context})` : ''}`);
  }
  let data;
  try { data = JSON.parse(text); }
  catch (e) {
    console.error('❌ JSON parse failed', { context, status: res.status, text });
    throw e;
  }
  if (!res.ok || data?.errors) {
    console.error('❌ Shopify returned errors:', data?.errors || text, { context, status: res.status });
    throw new Error(typeof data?.errors === 'string' ? JSON.stringify(data.errors) : 'Shopify error');
  }
  return data;
}

// -----------------------------------------------------------------------------
// Create variant, then add metafields to it (nested endpoint)
// -----------------------------------------------------------------------------
export async function createTempVariant(productId, variant, meta) {
  // 1) Create the variant
  const createRes = await fetch(adminUrl('/variants.json'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      variant: {
        product_id: Number(productId),
        option1: variant.options?.[0] || 'Custom',
        price: variant.price,
        sku: variant.sku,
        taxable: !!variant.taxable,
        inventory_policy: variant.inventory_policy || 'continue',
        inventory_management: variant.inventory_management ?? null,
        requires_shipping: !!variant.requires_shipping,
        grams: 0,
      },
    }),
  });

  const created = (await jsonOrThrow(createRes, 'createVariant')).variant; // { id, ... }

  // 2) Add metafields via nested endpoint
  if (meta && created?.id) {
    const metas = [
      { namespace: 'custom', key: 'ephemeral',  type: 'boolean',               value: String(!!meta.ephemeral) },
      { namespace: 'custom', key: 'hash',       type: 'single_line_text_field', value: meta.hash || '' },
      { namespace: 'custom', key: 'expires_at', type: 'single_line_text_field', value: meta.expires_at || '' },
      { namespace: 'custom', key: 'config',     type: 'json',                   value: JSON.stringify(meta.config || {}) },
    ];

    for (const m of metas) {
      const path = `/variants/${created.id}/metafields.json`;
      const mfRes = await fetch(adminUrl(path), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({ metafield: m }),
      });
      await jsonOrThrow(mfRes, `metafield ${m.namespace}.${m.key}`);
    }
  }

  return created;
}

// -----------------------------------------------------------------------------
// Utilities (optional)
// -----------------------------------------------------------------------------
export async function deleteVariant(variantId) {
  const res = await fetch(adminUrl(`/variants/${variantId}.json`), {
    method: 'DELETE',
    headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN },
  });
  return res.status;
}

export async function getProductVariants(productId) {
  const res = await fetch(adminUrl(`/products/${productId}/variants.json`), {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
      'Accept': 'application/json',
    },
  });
  return jsonOrThrow(res, 'getProductVariants'); // → { variants: [...] }
}
