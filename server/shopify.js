// Create temporary variant on base product (REST API)
export async function createTempVariant(productId, variant) {
  console.log('🧩 createTempVariant payload:', JSON.stringify(variant, null, 2));

  try {
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/variants.json`;

    const body = {
      variant: {
        product_id: Number(productId),                       // e.g. 9055083823340
        option1: variant.options?.[0] || 'Custom',           // variant “title”
        price: variant.price,
        sku: variant.sku,
        taxable: !!variant.taxable,
        inventory_policy: variant.inventory_policy || 'continue',
        inventory_management: variant.inventory_management   // usually null
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    console.log('🧩 Shopify REST status:', response.status, response.statusText);
    console.log('🧩 Shopify REST headers:', JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));
    console.log('🧩 Shopify REST raw response:', text || '(empty)');

    if (!text) throw new Error(`Empty response from Shopify — status ${response.status}`);

    let data;
    try { data = JSON.parse(text); }
    catch (err) {
      console.error('❌ JSON parse failed. Raw text was:', text);
      throw err;
    }

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
