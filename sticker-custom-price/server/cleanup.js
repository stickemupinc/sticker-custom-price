// 3) server/cleanup.js
// -----------------------------------------------------------------------------

import { deleteVariant, getProductVariants } from './shopify.js';

// On order creation: mark variants that were purchased. (Optional: delete immediately.)
export async function handleOrdersCreate(req, res) {
  try {
    const order = req.body;
    // Extract SKUs matching our skuPrefix and mark them for immediate deletion
    const tempVariantIds = (order.line_items || [])
      .filter(li => (li.sku || '').startsWith('CUST-'))
      .map(li => li.variant_id)
      .filter(Boolean);

    for (const id of tempVariantIds) {
      try { await deleteVariant(id); } catch (e) { console.warn('Delete after order failed', id, e.message); }
    }
    res.status(200).send('ok');
  } catch (e) {
    res.status(200).send('ok');
  }
}

// On checkout updates (abandoned carts): optional logging/flagging
export async function handleCheckoutsUpdate(req, res) {
  // You may store checkout tokens and temp SKUs here to help later cleanup
  res.status(200).send('ok');
}

// Nightly cleanup: remove stale temp variants whose expires_at is in the past
export async function nightlyCleanup(req, res) {
  try {
    const productId = (process.env.HOST_PRODUCT_ID || '').toString().split('/').pop();
    const variants = await getProductVariants(productId);
    const now = Date.now();

    // Lightweight heuristic: delete variants with SKU prefix CUST- older than TTL
    const deletions = [];
    for (const v of variants) {
      const created = new Date(v.created_at).getTime();
      const ageHrs = (now - created) / 3600000;
      if ((v.sku || '').startsWith('CUST-') && ageHrs > Number(process.env.CLEANUP_TTL_HOURS || 48)) {
        try { await deleteVariant(v.id); deletions.push(v.id); } catch (_) {}
      }
    }
    res.json({ deleted: deletions.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// -----------------------------------------------------------------------------