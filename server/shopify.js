// 2) server/shopify.js
// -----------------------------------------------------------------------------

import fetch from 'node-fetch';

const ADMIN = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07`;
const headers = {
  'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
  'Content-Type': 'application/json'
};

export async function createTempVariant(productGid, variant) {
  // REST: POST /products/{product_id}/variants.json
  const productId = productGid.split('/').pop();
  const r = await fetch(`${ADMIN}/products/${productId}/variants.json`, {
    method: 'POST', headers, body: JSON.stringify({ variant })
  });
  if (!r.ok) throw new Error(`Create variant failed: ${r.status}`);
  const data = await r.json();
  return data.variant; // returns { id, admin_graphql_api_id, ... }
}

export async function deleteVariant(variantId) {
  const r = await fetch(`${ADMIN}/variants/${variantId}.json`, { method: 'DELETE', headers });
  if (!r.ok) throw new Error(`Delete variant failed: ${r.status}`);
  return true;
}

export async function getProductVariants(productId) {
  const r = await fetch(`${ADMIN}/products/${productId}/variants.json?limit=250`, { headers });
  if (!r.ok) throw new Error('List variants failed');
  const data = await r.json();
  return data.variants || [];
}

export async function listMetafields(ownerId) {
  const r = await fetch(`${ADMIN}/metafields.json?metafield[owner_id]=${ownerId}`, { headers });
  if (!r.ok) return [];
  const data = await r.json();
  return data.metafields || [];
}

// -----------------------------------------------------------------------------