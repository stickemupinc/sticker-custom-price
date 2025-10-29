// server/app.js
// -----------------------------------------------------------------------------
// Requires (already in package.json): express, body-parser, cors, crypto, dotenv
// -----------------------------------------------------------------------------

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";
import { createTempVariant } from "./shopify.js";

dotenv.config();

const app = express();

// --- Helpers -----------------------------------------------------------------
function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Missing env: ${name}`);
  }
  return v;
}

// Accept either a plain numeric product id or a Shopify GID and return Number
function productIdAsNumber(id) {
  return Number(String(id).replace(/\D/g, ""));
}

// --- CORS --------------------------------------------------------------------
app.use(
  cors({
    origin: [
      "https://stickemupshop.myshopify.com",
      "https://p0mfabzpasrjdwhq-79229288684.shopifypreview.com",
      /\.shopifypreview\.com$/,
      /\.myshopify\.com$/,
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
  })
);

app.use(bodyParser.json());

// --- Health check ------------------------------------------------------------
app.get("/health", (_req, res) => res.json({ ok: true }));

// --- API: create a temporary variant and return its id -----------------------
app.post("/api/custom-sticker", async (req, res) => {
  try {
    const { title, price, width, height, qty, finish, vinyl, skuPrefix = "CUST" } =
      req.body || {};

    // Basic validation
    if (!price || !qty || !width || !height || !vinyl) {
      return res
        .status(400)
        .json({ error: "Missing required fields: price, qty, width, height, vinyl" });
    }

    // Build a traceable SKU hash
    const nowIso = new Date().toISOString();
    const hash = crypto
      .createHash("sha1")
      .update(`${vinyl}|${finish}|${width}|${height}|${qty}|${price}|${nowIso}`)
      .digest("hex")
      .slice(0, 10);

    // Minimal variant payload (metafields can be added later if desired)
    const variant = {
      options: [`${width}x${height} in · ${qty} qty`],
      price: Number(price).toFixed(2),
      sku: `${skuPrefix}-${hash}`,
      taxable: true,
      weight: 0,
      requires_shipping: true,
      inventory_management: null,
      inventory_policy: "continue",
    };

    // Ensure we pass a NUMERIC product_id to Shopify REST
    const hostProductEnv = requireEnv("HOST_PRODUCT_ID");
    const productIdNum = productIdAsNumber(hostProductEnv);
    if (!productIdNum) {
      return res
        .status(500)
        .json({ error: "HOST_PRODUCT_ID must be set to a valid product id (numeric or GID)" });
    }

    const created = await createTempVariant(productIdNum, variant);

    return res.json({
      variant_id: created?.id,
      sku: created?.sku || variant.sku,
      message: "Variant created",
    });
  } catch (err) {
    console.error("❌ /api/custom-sticker failed:", err);
    return res.status(500).json({ error: "Server error creating custom variant" });
  }
});

// --- Start server ------------------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Custom price app listening on ${PORT}`);
});
