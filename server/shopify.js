// -----------------------------------------------------------------------------
// server/shopify.js  (REST API version)
// -----------------------------------------------------------------------------

import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
  console.error('❌ Missing Shopify env vars');
}

// -----------------------------------------------------------------------------
// Create temporary variant on base product (REST API)
// -----------------------------------------------------------------------------
export async function createTempVariant(productId, variant) {
  console.log('🧩 createTempVariant payload:', JSON.stringify(variant, null, 2));

  try {
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/products/${productId}/variants.json`;

    const body = {
      variant: {
        title: variant.options?.[0] || 'Custom Variant',
        price: variant.price,
        sku: variant.sku,
        taxable: variant.taxable,
        inventory_policy: variant.inventory_policy,
        inventory_management: variant.inventory_management,
        metafields: variant.metafields
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    console.log('🧩 Shopify REST response:', text);

    const data = JSON.parse(text);
    if (data.errors) {
      console.error('❌ Shopify returned errors:', data.errors);
      throw new Error(JSON.stringify(data.errors));
    }

    return data.variant || data;
  } catch (err) {
    console.error('❌ createTempVariant failed:', err);
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Delete a variant (used by cleanup.js)
// -----------------------------------------------------------------------------
export async function deleteVariant(variantId) {
  try {
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/variants/${variantId}.json`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN }
    });

    console.log('🗑️ deleteVariant status:', res.status);
    return res.status;
  } catch (err) {
    console.error('❌ deleteVariant failed:', err);
  }
}

// -----------------------------------------------------------------------------
// Get all variants for a product (used by cleanup.js)
// -----------------------------------------------------------------------------
export async function getProductVariants(productId) {
  try {
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/products/${productId}/variants.json`;
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN }
    });

    const text = await res.text();
    console.log('🧾 getProductVariants response:', text);
    return JSON.parse(text);
  } catch (err) {
    console.error('❌ getProductVariants failed:', err);
  }
}
