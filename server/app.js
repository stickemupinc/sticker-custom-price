
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.options('*', cors());
app.use(bodyParser.json());

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

app.get('/', (req, res) => { res.send('Sticker Calculator Backend - Pricing Logic V2'); });

app.post('/api/create-checkout', async (req, res) => {
    console.log("📝 Received Checkout Request");

    if (!SHOP || !TOKEN) return res.status(500).json({ error: 'Server Misconfigured: Missing ENV' });

    const { items } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'No items in cart' });

    const line_items = items.map(item => {
        let finalUnitPrice = 0;

        // CHECK FOR CUSTOM PRICE (Passed as Total Line Cost)
        if (item.properties && item.properties['_RealPrice']) {
            const lineTotal = parseFloat(item.properties['_RealPrice']);
            const qty = item.quantity;

            // Reverse calculate Unit Price
            // Example: Total $168.00 / 350 stickers = $0.48 each.
            if (qty > 0) {
                finalUnitPrice = (lineTotal / qty).toFixed(4); // Use 4 decimals for precision
            } else {
                finalUnitPrice = 0;
            }
        } else {
            // Regular Retail Item (T-Shirt) - Use Shopify Price
            finalUnitPrice = (item.price / 100).toFixed(2);
        }

        return {
            title: item.product_title + (item.variant_title ? ` - ${item.variant_title}` : ''),
            quantity: item.quantity,
            price: finalUnitPrice,
            properties: Object.entries(item.properties || {}).map(([name, value]) => ({ name, value }))
        };
    });

    try {
        const draftOrderPayload = {
            draft_order: {
                line_items: line_items,
                tags: "Custom Calculator Order"
            }
        };

        console.log("🚀 Creating Draft Order...", JSON.stringify(draftOrderPayload, null, 2));

        const response = await fetch(`https://${SHOP}/admin/api/2023-10/draft_orders.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
            body: JSON.stringify(draftOrderPayload)
        });

        const data = await response.json();
        if (!response.ok) {
            console.error("Shopify API Error:", data);
            const msg = data.errors ? JSON.stringify(data.errors) : 'Unknown Shopify Error';
            return res.status(500).json({ error: 'Shopify Refused Order', details: msg });
        }

        console.log("✅ Invoice Created:", data.draft_order.invoice_url);
        return res.json({ invoice_url: data.draft_order.invoice_url });

    } catch (err) {
        console.error("❌ Server Error:", err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
