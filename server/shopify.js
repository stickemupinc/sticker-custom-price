// -----------------------------------------------------------------------------
// server/shopify.js
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
// Create temporary variant on base product
// -----------------------------------------------------------------------------
export async function createTempVariant(productId, variant) {
  console.log('🧩 createTempVariant payload:', JSON.stringify(variant, null, 2));

  try {
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/graphql.json`;

    const mutation = `
      mutation createVariant($input: ProductVariantInput!) {
        productVariantCreate(input: $input) {
          productVariant {
            id
            sku
            price
            title
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        productId,
        price: variant.price,
        sku: variant.sku,
        title: variant.options?.[0] || 'Custom Variant',
        taxable: variant.taxable,
        inventoryPolicy: variant.inventory_policy,
        inventoryManagement: variant.inventory_management,
        metafields: variant.metafields,
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN
      },
      body: JSON.stringify({ query: mutation, variables })
    });

    const text = await response.text();
    console.log('🧩 Shopify response:', text);

    const data = JSON.parse(text);
    const userErrors = data?.data?.productVariantCreate?.userErrors || [];

    if (userErrors.length > 0) {
      console.error('❌ Shopify userErrors:', userErrors);
      throw new Error(userErrors.map(e => e.message).join(', '));
    }

    return data.data.productVariantCreate.productVariant;

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
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/graphql.json`;
    const mutation = `
      mutation deleteVariant($id: ID!) {
        productVariantDelete(id: $id) {
          deletedProductVariantId
          userErrors { field message }
        }
      }
    `;
    const variables = { id: variantId };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN
      },
      body: JSON.stringify({ query: mutation, variables })
    });

    const text = await res.text();
    console.log('🗑️ deleteVariant response:', text);
    return text;
  } catch (err) {
    console.error('❌ deleteVariant failed:', err);
  }
}

// -----------------------------------------------------------------------------
// Get all variants for a product (used by cleanup.js)
// -----------------------------------------------------------------------------
export async function getProductVariants(productId) {
  try {
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/graphql.json`;
    const query = `
      query getProductVariants($id: ID!) {
        product(id: $id) {
          variants(first: 50) {
            nodes {
              id
              sku
              title
            }
          }
        }
      }
    `;
    const variables = { id: productId };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN
      },
      body: JSON.stringify({ query, variables })
    });

    const text = await res.text();
    console.log('🧾 getProductVariants response:', text);
    return JSON.parse(text);
  } catch (err) {
    console.error('❌ getProductVariants failed:', err);
  }
}
