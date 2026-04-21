"use strict";
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const axios = require("axios");

const app = express();
app.use(express.json());

// ========== CORS (FIX 1) ==========
app.use(cors({
  origin: [
    "https://puppy-pathfinder-quiz.lovable.app",
    "https://ezwhelp-quiz-staging.myshopify.com",
    "https://ezwhelp.vercel.app",
    "http://localhost:8080"
  ],
  methods: ["GET", "POST"],
  credentials: false,
}));

const PORT = process.env.PORT || 3000;

// ========== Neon DB Setup ==========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.connect((err, client, release) => {
  if (err) {
    console.error("❌ Database connection failed:", err.stack);
  } else {
    console.log("✅ Connected to Neon DB");
    release();
  }
});

async function initTables() {
  const createQuizTable = `
    CREATE TABLE IF NOT EXISTS quiz_submissions (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      breed TEXT NOT NULL,
      dam_size TEXT NOT NULL,
      zones INTEGER NOT NULL,
      feature TEXT NOT NULL,
      bundle TEXT NOT NULL,
      shopify_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  const createPath2Table = `
    CREATE TABLE IF NOT EXISTS path2_submissions (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      breed TEXT NOT NULL,
      box_size INTEGER NOT NULL,
      box_height TEXT NOT NULL,
      has_window TEXT NOT NULL,
      stage TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(createQuizTable);
    await pool.query(createPath2Table);
    console.log("✅ Tables ensured: quiz_submissions, path2_submissions");
  } catch (err) {
    console.error("❌ Error creating tables:", err);
  }
}
initTables();

// ========== Klaviyo Helper ==========
const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;
const KLAVIYO_LIST_ID = process.env.KLAVIYO_LIST_ID;

async function syncToKlaviyo(email, properties, listId = KLAVIYO_LIST_ID) {
  if (!KLAVIYO_API_KEY) {
    console.warn("⚠️ KLAVIYO_API_KEY not set – skipping Klaviyo sync");
    return;
  }
  if (!email || !email.includes("@")) {
    console.warn("⚠️ No valid email – skipping Klaviyo sync");
    return;
  }

  const headers = {
    "Authorization": `Bearer ${KLAVIYO_API_KEY}`,
    "Content-Type": "application/json",
    "revision": "2024-07-15",
  };

  try {
    // 1. Create or update profile (upsert by email)
    const profilePayload = {
      data: {
        type: "profile",
        attributes: {
          email: email,
          properties: properties,
        },
      },
    };
    const profileRes = await axios.post("https://a.klaviyo.com/api/profiles/", profilePayload, { headers });
    const profileId = profileRes.data?.data?.id;
    console.log(`✅ Klaviyo profile upserted for ${email}, id=${profileId}`);

    // 2. Add profile to list (if list ID is provided)
    if (listId && profileId) {
      const listPayload = {
        data: [
          {
            type: "profile",
            id: profileId,
          },
        ],
      };
      await axios.post(
        `https://a.klaviyo.com/api/lists/${listId}/relationships/profiles/`,
        listPayload,
        { headers }
      );
      console.log(`✅ Profile ${profileId} added to list ${listId}`);
    } else if (listId && !profileId) {
      console.warn("⚠️ Could not add to list – profile ID missing");
    }
  } catch (err) {
    console.error("❌ Klaviyo API error:", err.response?.data || err.message);
  }
}

// ========== Helper functions (Fixes 3,4,7,9) ==========
function normalizeDamSize(dam_size) {
  const map = {
    "under_16": "small", "16_40": "medium", "40_90": "large", "over_90": "xl",
    "small": "small", "medium": "medium", "large": "large", "xl": "xl",
  };
  return map[dam_size] || null;
}

function booleanFeatureToKey(zones, feature) {
  if (typeof feature === "boolean") {
    if (feature === false) return "none";
    if (zones === 1) return "tools";
    if (zones === 2) return "monitoring";
    if (zones === 3) return "heat";
  }
  if (typeof feature === "string") return feature;
  return null;
}

function normalizeStage(stage) {
  const map = {
    "preparing": "A", "born_0_3": "B", "1_2_weeks": "C", "3_plus_weeks": "D",
    "A": "A", "B": "B", "C": "C", "D": "D"
  };
  return map[stage] || null;
}

function normalizeBoxHeight(box_height) {
  const map = { "18": "standard", "28": "tall", "standard": "standard", "tall": "tall" };
  return map[box_height] || null;
}

// ========== Bundle & URL Data (Fixes 10-16) ==========
const BUNDLE_MAP = {
  "1:none": "Starter", "1:tools": "Essential", "2:none": "Pro",
  "2:monitoring": "Elite", "3:none": "Play Yard", "3:heat": "Condo",
};

const SHOPIFY_URLS = {
  Starter: {
    small: "https://ezwhelp-quiz-staging.myshopify.com/products/bundles-ezclassic-starter-set",
    medium: "https://ezwhelp-quiz-staging.myshopify.com/products/bundles-ezclassic-starter-set?variant=48801777778931",
    large: "https://ezwhelp-quiz-staging.myshopify.com/products/bundles-ezclassic-starter-set?variant=48801777910003",
  },
  Essential: {
    small: "https://ezwhelp-quiz-staging.myshopify.com/products/bundles-ezclassic-basic-set",
    medium: "https://ezwhelp-quiz-staging.myshopify.com/products/bundles-ezclassic-basic-set?variant=48801777418483",
    large: "https://ezwhelp-quiz-staging.myshopify.com/products/bundles-ezclassic-basic-set?variant=48801777549555",
  },
  Pro: {
    small: "https://ezwhelp-quiz-staging.myshopify.com/products/copy-of-bundles-ezclassic-pro-set",
    medium: "https://ezwhelp-quiz-staging.myshopify.com/products/copy-of-bundles-ezclassic-pro-set?variant=48801778139379",
    large: "https://ezwhelp-quiz-staging.myshopify.com/products/copy-of-bundles-ezclassic-pro-set?variant=48801778270451",
  },
  Elite: {
    small: "https://ezwhelp-quiz-staging.myshopify.com/products/bundles-ezclassic-elite-set",
    medium: "https://ezwhelp-quiz-staging.myshopify.com/products/bundles-ezclassic-elite-set?variant=48801778499827",
    large: "https://ezwhelp-quiz-staging.myshopify.com/products/bundles-ezclassic-elite-set?variant=48801778630899",
  },
  "Play Yard": {
    small: "https://ezwhelp-quiz-staging.myshopify.com/products/bundles-ezclassic-play-yard-set?variant=48801778893043",
    medium: "https://ezwhelp-quiz-staging.myshopify.com/products/bundles-ezclassic-play-yard-set?variant=48801778925811",
    large: "https://ezwhelp-quiz-staging.myshopify.com/products/bundles-ezclassic-play-yard-set?variant=48801778958579",
  },
  Condo: {
    small: "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-condo-bundle?variant=48801780105459",
    medium: "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-condo-bundle?variant=48801780138227",
    large: "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-condo-bundle?variant=48801780170995",
    xl: "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-tall-48x76-condo-bundle",
  },
};

// Add‑on data (abbreviated for brevity – keep your existing full definitions)
const TRACTION_PAD_URLS = {
  small: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-traction-pad",
  medium: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-traction-pad?variant=48801776500979",
  large: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-traction-pad?variant=48801776533747",
  xl: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-traction-pad?variant=48801776533747",
};

const QUICK_DRY_PAD_URLS = {
  small: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-reusable-quick-dry-pad-2-pack",
  medium: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-reusable-quick-dry-pad-2-pack?variant=48801809465587",
  large: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-reusable-quick-dry-pad-2-pack?variant=48801809498355",
  xl: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-reusable-quick-dry-pad-2-pack?variant=48801809531123",
};

const SLIP_RESISTANT_PAD_URLS = {
  small: "https://ezwhelp-quiz-staging.myshopify.com/products/black-white-slip-resistant-paw-print-pad-mat-2-pack",
  medium: "https://ezwhelp-quiz-staging.myshopify.com/products/black-white-slip-resistant-paw-print-pad-mat-2-pack?variant=48801809596659",
  large: "https://ezwhelp-quiz-staging.myshopify.com/products/black-white-slip-resistant-paw-print-pad-mat-2-pack?variant=48801809629427",
  xl: "https://ezwhelp-quiz-staging.myshopify.com/products/black-white-slip-resistant-paw-print-pad-mat-2-pack?variant=48801809662195",
};

const ADD_ON_ROOM_URLS = {
  small: "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-add-on-room",
  medium: "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-add-on-room?variant=48801809793267",
  large: "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-add-on-room?variant=48801809826035",
  xl: "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-add-on-room?variant=48801809826035",
};

const SUBMIT_STATIC = {
  whelpingKit: { name: "Whelping Kit", url: "https://ezwhelp-quiz-staging.myshopify.com/products/whelping-kit" },
  puppyCollarSet: { name: "Puppy Collar Set", url: "https://ezwhelp-quiz-staging.myshopify.com/products/newborn-puppy-collar-set-24-pack" },
  cornerSeat: { name: "Corner Seat", url: "https://ezwhelp-quiz-staging.myshopify.com/products/corner-seat-staging" },
  smartCamera: { name: "Smart WiFi Camera", url: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-smart-wifi-camera" },
  puppyFeedingStation: { name: "Puppy Feeding Station", url: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-puppy-feeding-station-modular-2-pack" },
  acrylicDoor: { name: "Acrylic Glass Door", url: "https://ezwhelp-quiz-staging.myshopify.com/products/acrylic-door-18-staging" },
};

function getSuggestedAddons(bundle, dam_size) {
  const tractionPad = { name: "Traction Pad", url: TRACTION_PAD_URLS[dam_size] };
  const quickDryPads = { name: "Reusable Quick Dry Pads", url: QUICK_DRY_PAD_URLS[dam_size] };
  const slipResistantPads = { name: "Reusable Slip Resistant Pads", url: SLIP_RESISTANT_PAD_URLS[dam_size] };
  const addOnRoom = { name: "Add-On Room", url: ADD_ON_ROOM_URLS[dam_size] };

  switch (bundle) {
    case "Starter":
      return [SUBMIT_STATIC.whelpingKit, SUBMIT_STATIC.puppyCollarSet, SUBMIT_STATIC.cornerSeat, SUBMIT_STATIC.puppyFeedingStation, SUBMIT_STATIC.smartCamera, tractionPad, quickDryPads, slipResistantPads];
    case "Essential":
      return [SUBMIT_STATIC.puppyFeedingStation, SUBMIT_STATIC.smartCamera, tractionPad, SUBMIT_STATIC.acrylicDoor, quickDryPads, slipResistantPads];
    case "Pro":
      return [SUBMIT_STATIC.acrylicDoor, tractionPad, SUBMIT_STATIC.smartCamera, SUBMIT_STATIC.puppyFeedingStation, quickDryPads, slipResistantPads];
    case "Elite":
      return [addOnRoom, quickDryPads, slipResistantPads];
    case "Condo":
      return [SUBMIT_STATIC.smartCamera, tractionPad, SUBMIT_STATIC.puppyFeedingStation, SUBMIT_STATIC.cornerSeat, quickDryPads, slipResistantPads];
    case "Play Yard":
      return [SUBMIT_STATIC.smartCamera, tractionPad, SUBMIT_STATIC.puppyFeedingStation, quickDryPads, slipResistantPads];
    default:
      return [];
  }
}

// ========== Health Check ==========
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ========== Missing endpoints (dummy implementations) ==========
app.post("/api/quiz/start-quiz", (req, res) => {
  console.log("📦 /start-quiz body:", req.body);
  res.json({ attempt_id: "dummy-session-" + Date.now() });
});

app.post("/api/quiz/save-answer", (req, res) => {
  console.log("📝 /save-answer body:", req.body);
  res.json({ status: "ok" });
});

app.post("/api/quiz/submit-quiz", (req, res) => {
  console.log("🏁 /submit-quiz body:", req.body);
  res.json({ status: "ok" });
});

app.post("/api/quiz/product-click", (req, res) => {
  console.log("🖱️ /product-click body:", req.body);
  res.json({ status: "ok" });
});

app.post("/api/quiz/add-to-cart", (req, res) => {
  console.log("🛒 /add-to-cart body:", req.body);
  res.json({ status: "ok" });
});

app.post("/api/quiz/checkout-initiated", (req, res) => {
  console.log("💳 /checkout-initiated body:", req.body);
  res.json({ status: "ok" });
});

// ========== POST /api/quiz/submit (with Neon DB & Klaviyo) ==========
app.post("/api/quiz/submit", async (req, res) => {
  console.log("📨 /submit payload:", JSON.stringify(req.body, null, 2));
  const { email, breed, dam_size, zones, feature, timeline } = req.body || {};
  let userEmail = email || req.body.userEmail || req.body.contactEmail;

  // Temporary fallback for testing (remove in production)
  if (!userEmail || userEmail === "") {
    console.warn("⚠️ No email provided – using fallback for testing");
    userEmail = "test@example.com";
  }

  if (!userEmail || !userEmail.includes("@")) {
    return res.status(400).json({ error: "Invalid or missing email" });
  }
  if (!breed) return res.status(400).json({ error: "Missing breed" });

  const normalizedDamSize = normalizeDamSize(dam_size);
  if (!normalizedDamSize) return res.status(400).json({ error: "Invalid dam_size" });

  if (!Number.isInteger(zones) || zones < 1 || zones > 3) {
    return res.status(400).json({ error: "zones must be 1-3" });
  }

  const featureKey = booleanFeatureToKey(zones, feature);
  if (!featureKey) return res.status(400).json({ error: "Invalid feature" });

  const bundleKey = `${zones}:${featureKey}`;
  const bundle = BUNDLE_MAP[bundleKey];
  if (!bundle) return res.status(422).json({ error: "No bundle found" });

  let shopify_url = null;
  let responseData = {};
  let suggested_addons = [];

  // XL routing logic (Fixes 5 & 6)
  if (normalizedDamSize === "xl") {
    if (bundle === "Condo") {
      shopify_url = "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-tall-48x76-condo-bundle";
      responseData = {
        bundle: "Condo",
        shopify_cart_url: shopify_url,
        suggested_addons: [],
        support_followup: true,
        message: "Because you have an XL/Giant dam, our support team will reach out within 24 hours to help you with recommended accessories and any custom setup needs.",
      };
    } else {
      responseData = {
        bundle,
        shopify_cart_url: "",
        suggested_addons: [],
        requires_custom_inquiry: true,
        message: `XL sizing for the ${bundle} Bundle is not yet available in our standard catalog. Our team will reach out within 24 hours to help you build a custom setup.`,
      };
    }
  } else {
    shopify_url = SHOPIFY_URLS[bundle]?.[normalizedDamSize];
    if (!shopify_url) return res.status(500).json({ error: "Shopify URL not found" });
    suggested_addons = getSuggestedAddons(bundle, normalizedDamSize);
    responseData = { bundle, shopify_cart_url: shopify_url, suggested_addons };
  }

  // Insert into Neon DB (non-blocking)
  try {
    await pool.query(
      `INSERT INTO quiz_submissions (email, breed, dam_size, zones, feature, bundle, shopify_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userEmail, breed, normalizedDamSize, zones, featureKey, bundle, shopify_url]
    );
    console.log(`✅ DB insert successful for ${userEmail}`);
  } catch (dbErr) {
    console.error("❌ DB insert error:", dbErr);
  }

  // ========== Klaviyo sync (fire-and-forget) ==========
  const timelineStage = timeline || null;
  const klaviyoProperties = {
    bundle_type: bundle,
    dam_size: normalizedDamSize,
    timeline_stage: timelineStage,
    breed: breed,
  };
  syncToKlaviyo(userEmail, klaviyoProperties).catch(err => console.error("Klaviyo sync error (ignored):", err));

  res.json(responseData);
});

// ========== Path 2 helpers ==========
function getSizeKey(box_size, box_height) {
  if (box_size === 28) return "small";
  if (box_size === 38) return "medium";
  return box_height === "tall" ? "xl" : "large";
}

function getHeatComboUrl(box_size) {
  if (box_size === 48) return "https://ezwhelp-quiz-staging.myshopify.com/products/heat-combo-staging?variant=48836136075507";
  return "https://ezwhelp-quiz-staging.myshopify.com/products/heat-combo-staging";
}

function getSmartAddOnRoomUrl(box_size, box_height, has_window) {
  if (box_height === "tall" && has_window === "yes") {
    if (box_size === 48) return "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-windowed-add-on-room-tall-staging?variant=48836135911667";
    return "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-windowed-add-on-room-tall-staging";
  }
  if (box_height === "tall" && has_window === "no") {
    if (box_size === 48) return "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-add-on-room-tall-staging?variant=48836135846131";
    return "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-add-on-room-tall-staging";
  }
  if (box_height === "standard" && has_window === "yes") {
    if (box_size === 28) return "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-windowed-add-on-room";
    if (box_size === 38) return "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-windowed-add-on-room?variant=48801779155187";
    return "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-windowed-add-on-room?variant=48801779187955";
  }
  // standard + no
  if (box_size === 28) return "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-add-on-room";
  if (box_size === 38) return "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-add-on-room?variant=48801809793267";
  return "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-add-on-room?variant=48801809826035";
}

const STANDARD_ADD_ON_ROOM_URLS = {
  small: "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-add-on-room",
  medium: "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-add-on-room?variant=48801809793267",
  large: "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-add-on-room?variant=48801809826035",
  xl: "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-add-on-room?variant=48801809826035",
};

function getMessHallUrl(box_size) {
  const variants = {
    28: "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-mess-hall-add-on-room-set-standard-18-height?variant=48801779876083",
    38: "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-mess-hall-add-on-room-set-standard-18-height?variant=48801779908851",
    48: "https://ezwhelp-quiz-staging.myshopify.com/products/ezclassic-mess-hall-add-on-room-set-standard-18-height?variant=48801779941619",
  };
  return variants[box_size] || variants[38];
}

function getTallMessHallUrl(box_size) {
  if (box_size === 48) return "https://ezwhelp-quiz-staging.myshopify.com/products/tall-ezclassic-mess-hall-add-on-room-set-tall-28-height?variant=48801780039923";
  return "https://ezwhelp-quiz-staging.myshopify.com/products/tall-ezclassic-mess-hall-add-on-room-set-tall-28-height";
}

const P2_TRACTION_PAD_URLS = {
  small: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-traction-pad",
  medium: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-traction-pad?variant=48801776500979",
  large: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-traction-pad?variant=48801776533747",
  xl: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-traction-pad?variant=48801776533747",
};

const P2_QUICK_DRY_PAD_URLS = {
  small: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-reusable-quick-dry-pad-2-pack",
  medium: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-reusable-quick-dry-pad-2-pack?variant=48801809465587",
  large: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-reusable-quick-dry-pad-2-pack?variant=48801809498355",
  xl: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-reusable-quick-dry-pad-2-pack?variant=48801809531123",
};

const P2_SLIP_RESISTANT_PAD_URLS = {
  small: "https://ezwhelp-quiz-staging.myshopify.com/products/black-white-slip-resistant-paw-print-pad-mat-2-pack",
  medium: "https://ezwhelp-quiz-staging.myshopify.com/products/black-white-slip-resistant-paw-print-pad-mat-2-pack?variant=48801809596659",
  large: "https://ezwhelp-quiz-staging.myshopify.com/products/black-white-slip-resistant-paw-print-pad-mat-2-pack?variant=48801809629427",
  xl: "https://ezwhelp-quiz-staging.myshopify.com/products/black-white-slip-resistant-paw-print-pad-mat-2-pack?variant=48801809662195",
};

const P2_STATIC = {
  whelpingKit: { name: "Whelping Kit", url: "https://ezwhelp-quiz-staging.myshopify.com/products/whelping-kit" },
  cornerSeat: { name: "Corner Seat", url: "https://ezwhelp-quiz-staging.myshopify.com/products/corner-seat-staging" },
  acrylicDoor: { name: "Acrylic Glass Door", url: "https://ezwhelp-quiz-staging.myshopify.com/products/acrylic-door-18-staging" },
  wifiMonitor: { name: "WiFi Monitor", url: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-smart-wifi-camera" },
  feedingStation: { name: "Feeding Station", url: "https://ezwhelp-quiz-staging.myshopify.com/products/ezwhelp-puppy-feeding-station-modular-2-pack" },
};

function getRecommendedProducts(stage, box_size, box_height, has_window, sizeKey) {
  const heatCombo = { name: "Heat Combo", url: getHeatComboUrl(box_size) };
  const tractionPad = { name: "Traction Pad", url: P2_TRACTION_PAD_URLS[sizeKey] };
  const quickDryPads = { name: "Reusable Quick Dry Pads", url: P2_QUICK_DRY_PAD_URLS[sizeKey] };
  const slipResistantPads = { name: "Reusable Slip Resistant Pads", url: P2_SLIP_RESISTANT_PAD_URLS[sizeKey] };
  const smartAddOnRoom = { name: "Add-On Room", url: getSmartAddOnRoomUrl(box_size, box_height, has_window) };
  const standardAddOnRoom = { name: "Add-On Room", url: STANDARD_ADD_ON_ROOM_URLS[sizeKey] };
  const messHall = box_height === "tall"
    ? { name: "Mess Hall (Tall)", url: getTallMessHallUrl(box_size) }
    : { name: "Mess Hall", url: getMessHallUrl(box_size) };

  switch (stage) {
    case "A": {
      const products = [heatCombo, P2_STATIC.whelpingKit, P2_STATIC.cornerSeat, quickDryPads, slipResistantPads];
      if (has_window === "no") products.push(P2_STATIC.acrylicDoor);
      return products;
    }
    case "B": {
      const products = [heatCombo, P2_STATIC.wifiMonitor, smartAddOnRoom, quickDryPads];
      if (has_window === "no") products.push(P2_STATIC.acrylicDoor);
      return products;
    }
    case "C":
      return [tractionPad, smartAddOnRoom, quickDryPads, slipResistantPads];
    case "D": {
      const addOnRooms = [
        standardAddOnRoom,
        { name: "Windowed Add-On Room", url: getSmartAddOnRoomUrl(box_size, box_height, "yes") },
      ];
      if (has_window === "no") addOnRooms.reverse();
      return [
        ...addOnRooms,
        P2_STATIC.feedingStation,
        messHall,
        quickDryPads,
        slipResistantPads,
      ];
    }
    default:
      return [];
  }
}

// ========== POST /api/quiz/path2 (with Neon DB & Klaviyo) ==========
app.post("/api/quiz/path2", async (req, res) => {
  let { email, breed, box_size, box_height, has_window, stage } = req.body || {};
  let userEmail = email || req.body.userEmail || req.body.contactEmail;

  if (!userEmail || !userEmail.includes("@")) {
    return res.status(400).json({ error: "Invalid or missing email" });
  }
  if (!breed) return res.status(400).json({ error: "Missing breed" });

  const normalizedStage = normalizeStage(stage);
  if (!normalizedStage) {
    return res.status(400).json({ error: "stage must be one of: preparing, born_0_3, 1_2_weeks, 3_plus_weeks" });
  }

  let normalizedBoxSize = typeof box_size === "string" ? parseInt(box_size, 10) : box_size;
  if (box_size === "unsure") normalizedBoxSize = 38;
  if (![28, 38, 48].includes(normalizedBoxSize)) {
    return res.status(400).json({ error: "box_size must be 28, 38, 48, or unsure" });
  }

  const normalizedBoxHeight = normalizeBoxHeight(box_height);
  if (!normalizedBoxHeight) {
    return res.status(400).json({ error: "box_height must be 18 or 28" });
  }
  if (!["yes", "no"].includes(has_window)) {
    return res.status(400).json({ error: "has_window must be yes or no" });
  }

  const sizeKey = getSizeKey(normalizedBoxSize, normalizedBoxHeight);
  const recommended_products = getRecommendedProducts(normalizedStage, normalizedBoxSize, normalizedBoxHeight, has_window, sizeKey);

  // Insert into path2_submissions
  try {
    await pool.query(
      `INSERT INTO path2_submissions (email, breed, box_size, box_height, has_window, stage)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userEmail, breed, normalizedBoxSize, normalizedBoxHeight, has_window, normalizedStage]
    );
  } catch (dbErr) {
    console.error("DB insert error (path2):", dbErr);
  }

  // Klaviyo sync for existing customer path
  const klaviyoProperties = {
    bundle_type: null,
    dam_size: null,
    timeline_stage: stage,
    breed: breed,
  };
  syncToKlaviyo(userEmail, klaviyoProperties).catch(err => console.error("Klaviyo sync error (ignored):", err));

  res.json({ recommended_products });
});

// ========== Start Server ==========

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`✅ EZWhelp quiz server running on port ${PORT}`);
});