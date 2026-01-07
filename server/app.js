
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 1. CRITICAL: CORS must be valid.
// Allowing all origins for simplicity (User is non-technical).
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Pre-flight handling
app.options('*', cors());

app.use(bodyParser.json());

// ENV CHECK
const SHOP = process.env.SHOPIFY_STORE_DOMAIN; // e.g. stickemupshop.myshopify.com
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

// --- ROUTES ---

app.get('/', (req, res) => {
    res.send('Sticker Calculator Backend is Running v2.');
});

app.post('/api/create-checkout', async (req, res) => {
    console.log("📝 Received Checkout Request");

    if (!SHOP || !TOKEN) {
        console.error("❌ Missing Env Vars");
        return res.status(500).json({ error: 'Server Misconfigured: Missing ENV' });
    }

    const { items } = req.body;
    if (!items || !items.length) {
        return res.status(400).json({ error: 'No items in cart' });
    }

    // Transform Cart Items -> Draft Order Line Items
    const line_items = items.map(item => {
        // 1. Check for Custom Price Property
        // Frontend sends properties['_RealPrice'] or similar.
        // Note: Line Item properties come in as an object in the payload usually, 
        // or array depending on how cart.js formats it. 
        // Usually item.properties is an object { "Shape": "Diecut", "_RealPrice": "12.50" }

        let customPrice = null;
        if (item.properties && item.properties['_RealPrice']) {
            customPrice = item.properties['_RealPrice'];
        }

        // Default to item price if no custom price found (fallback)
        // Shopify cart item.price is in cents usually? No, cart.js returns cents.
        // Draft Order API expects string "12.50".

        const finalPrice = customPrice ? customPrice : (item.price / 100).toFixed(2);

        return {
            title: item.product_title + (item.variant_title ? ` - ${item.variant_title}` : ''),
            quantity: item.quantity,
            price: finalPrice,
            properties: Object.entries(item.properties || {}).map(([name, value]) => ({ name, value }))
        };
    });

    try {
        const draftOrderPayload = {
            draft_order: {
                line_items: line_items,
                use_customer_default_address: true
            }
        };

        console.log("🚀 Creating Draft Order...", JSON.stringify(draftOrderPayload, null, 2));

        const response = await fetch(`https://${SHOP}/admin/api/2023-10/draft_orders.json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': TOKEN
            },
            body: JSON.stringify(draftOrderPayload)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Shopify API Error:", data);
            return res.status(500).json({ error: 'Shopify Refused Order', details: data });
        }

        // Success! Return the invoice URL (The secure checkout link)
        console.log("✅ Order Created:", data.draft_order.invoice_url);
        return res.json({ invoice_url: data.draft_order.invoice_url });

    } catch (err) {
        console.error("❌ Server Error:", err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
