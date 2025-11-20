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

// -----------------------------------------------------------------------------
// Read JSON with ACTUAL error message extraction
// -----------------------------------------------------------------------------
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

  // If Shopify returned ANY kind of error
  if (!res.ok || data?.errors) {
    console.error('❌ Shopify returned errors:', data?.errors || text, { context, status: res.status });

    // Extract real error text
    let errMsg = 'Shopify error';

    if (typeof data?.errors === 'string') {
      errMsg = data.errors;
    } else if (Array.isArray(data?.errors)) {
      errMsg = data.errors.join(', ');
    } else if (data?.errors && typeof data.errors === 'object') {
      try {
        errMsg = JSON.stringify(data.errors);
      } catch {
        // ignore
      }
    }

    const err = new Error(errMsg);
    err.status = res.status;
    throw err;
  }

  return data;
}

// -----------------------------------------------------------------------------
// POST helper
// -----------------------------------------------------------------------------
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
// GET variants for a product
// -----------------------------------------------------------------------------
export async function getProductVariants(productId) {
  const url = adminUrl(`/products/${productId}/variants.json`);
  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
      'Accept': 'application/json',
    },
  });
  return readJson(res, 'getProductVariants');
}

// -----------------------------------------------------------------------------
// DELETE a variant
// -----------------------------------------------------------------------------
export async function deleteVariant(variantId) {
  const res = await fetch(adminUrl(`/variants/${variantId}.json`), {
    method: 'DELETE',
    headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN },
  });
  console.log('🗑️  deleteVariant status:', res.status);
  return res.status;
}

// -----------------------------------------------------------------------------
// Create variant — OR reuse existing if Shopify says "already exists"
// -----------------------------------------------------------------------------
export async function createTempVariant(productId, variant, meta = {}) {
  const pid = Number(productId);
  if (!Number.isFinite(pid)) {
    throw new Error(`productId is not numeric: ${productId}`);
  }

  console.log('🛠️  createTempVariant env:', {
    SHOPIFY_STORE_DOMAIN,
    token_last4: last4(SHOPIFY_ADMIN_ACCESS_TOKEN),
    productId: pid,
  });

  // Base payload for Shopify
  const variantBody = {
    price: variant.price,
    sku: variant.sku,
    taxable: !!variant.taxable,
    inventory_policy: variant.inventory_policy || 'continue',
    inventory_management: variant.inventory_management ?? null,
    requires_shipping: !!variant.requires_shipping,
    grams: 0,
    option1: variant?.options?.[0] || `Custom ${Date.now()}`,
  };

  let created;

  // ---------------------------------------------------------------------------
  // 1) Try product-scoped endpoint
  // ---------------------------------------------------------------------------
  try {
    const url1 = adminUrl(`/products/${pid}/variants.json`);
    const data1 = await postJson(url1, { variant: variantBody }, 'createVariant(product-scoped)');
    created = data1.variant;
  } catch (e) {
    const msg = String(e.message || e);

    // -------------------------------------------------------------------------
    // NEW: Handle "variant already exists"
    // -------------------------------------------------------------------------
    if (/already exists/i.test(msg)) {
      console.warn('⚠️  Variant already exists — reusing existing variant.');

      try {
        const { variants } = await getProductVariants(pid);
        const existing = variants?.find(v => v.option1 === variantBody.option1);

        if (existing) {
          created = existing; // return existing variant instead of failing
        } else {
          console.error('❌ Shopify said variant exists, but we could not find it in product variants.', {
            option1: variantBody.option1,
          });
          throw e;
        }
      } catch (lookupErr) {
        console.error('❌ Failed to lookup existing variant after "already exists" error:', lookupErr);
        throw e;
      }
    }

    // -------------------------------------------------------------------------
    // Fall back from 404 → use global /variants.json
    // -------------------------------------------------------------------------
    else if (/not found/i.test(msg) || /404/.test(msg)) {
      console.warn('⚠️  product-scoped endpoint 404 — falling back to global /variants.json');

      const url2 = adminUrl('/variants.json');
      const data2 = await postJson(url2, { variant: { ...variantBody, product_id: pid } }, 'createVariant(global)');
      created = data2.variant;
    }

    // -------------------------------------------------------------------------
    // Any OTHER Shopify error → throw it normally
    // -------------------------------------------------------------------------
    else {
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // 2) Add metafields (best effort)
  // ---------------------------------------------------------------------------
  if (created?.id) {
    const metas = [
      { namespace: 'custom', key: 'ephemeral',  type: 'boolean',               value: String(!!meta.ephemeral) },
      { namespace: 'custom', key: 'hash',       type: 'single_line_text_field', value: String(meta.hash || '') },
      { namespace: 'custom', key: 'expires_at', type: 'single_line_text_field', value: String(meta.expires_at || '') },
      { namespace: 'custom', key: 'config',     type: 'json',                   value: JSON.stringify(meta.config || {}) },
    ];

    for (const m of metas) {
      if (!m.value || m.value === 'null' || m.value === 'undefined') continue;

      const mfUrl = adminUrl(`/variants/${created.id}/metafields.json`);
      try {
        await postJson(mfUrl, { metafield: m }, `metafield ${m.namespace}.${m.key}`);
      } catch (err) {
        console.error('❌ Metafield create failed:', m, err.message || err);
      }
    }
  }

  return created;
}
