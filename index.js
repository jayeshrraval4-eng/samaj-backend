const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

// ----------------------------
// CONFIG
// ----------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 4000;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("❌ Missing Supabase credentials in .env");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ----------------------------
// SERVER INIT
// ----------------------------
const app = express();
app.use(cors());
app.use(express.json());

// TEMP FOLDER FOR UPLOADS
const uploadDir = path.join(__dirname, "tmp");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    console.warn("unlink failed");
  }
}

// ----------------------------
// HEALTH CHECK
// ----------------------------
app.get("/health", (_req, res) => {
  res.json({ status: "ok", message: "Backend running" });
});

// ----------------------------
// GET ALL PROFILES
// ----------------------------
app.get("/profiles", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return res.status(400).json({ success: false, error });

    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Server error",
      details: err.message,
    });
  }
});

// ----------------------------
// CREATE PROFILE
// ----------------------------
app.post("/profiles", async (req, res) => {
  try {
    const form = req.body || {};
    form.created_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("profiles")
      .insert([form])
      .select("*")
      .single();

    if (error) return res.status(400).json({ success: false, error });

    return res.json({ success: true, message: "Profile Saved", data });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Server error",
      details: err.message,
    });
  }
});

// ----------------------------
// REGISTER USER
// ----------------------------
app.post("/register-user", async (req, res) => {
  try {
    const { name, phone, email, dob, gender,
 password } = req.body || {};

    if (!name || !phone || !password) {
      return res
        .status(400)
        .json({ success: false, error: "નામ, ફોન અને પાસવર્ડ જરૂરી છે" });
    }

    const { data: existing } = await supabase
      .from("profiles")
      .select("phone")
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return res
        .status(400)
        .json({ success: false, error: "આ ફોન નંબર પહેલેથી રજીસ્ટર્ડ છે" });
    }

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("profiles")
      .insert([
        {
          full_name: name,
          phone,
          email,
          password,
          birth_date: dob,
          created_at: now,
          updated_at: now,
        },
      ])
      .select("*")
      .single();

    if (error) return res.status(400).json({ success: false, error });

    return res.json({ success: true, user: data });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------
// LOGIN USER
// ----------------------------
app.post("/login-user", async (req, res) => {
  try {
    const { phone, password } = req.body || {};

    if (!phone || !password)
      return res.status(400).json({
        success: false,
        error: "Phone અને Password જરૂરી છે",
      });

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("phone", phone)
      .eq("password", password)
      .maybeSingle();

    if (error) return res.status(500).json({ success: false, error });

    if (!data)
      return res
        .status(400)
        .json({ success: false, error: "ખોટો ફોન નંબર અથવા પાસવર્ડ" });

    return res.json({ success: true, user: data });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ----------------------------------------------------
   MATCH REQUESTS
---------------------------------------------------- */

// Send Request
app.post("/send-request", async (req, res) => {
  try {
    const { from_user_id, to_user_id } = req.body || {};

    if (!from_user_id || !to_user_id)
      return res.status(400).json({
        success: false,
        error: "from_user_id & to_user_id required",
      });

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("match_requests")
      .insert([
        {
          from_user_id,
          to_user_id,
          status: "pending",
          created_at: now,
          updated_at: now,
        },
      ])
      .select("*")
      .single();

    if (error) return res.status(400).json({ success: false, error });

    return res.json({ success: true, message: "Request Sent", data });
  } catch (err) {
    console.error("send-request err", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Incoming Requests
app.get("/requests/incoming", async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId)
      return res.status(400).json({ success: false, error: "userId required" });

    const { data, error } = await supabase
      .from("match_requests")
      .select("*")
      .eq("to_user_id", userId)
      .order("created_at", { ascending: false });

    if (error) return res.status(400).json({ success: false, error });

    return res.json({ success: true, data });
  } catch (err) {
    console.error("incoming req err", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Outgoing Requests
app.get("/requests/outgoing", async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId)
      return res.status(400).json({ success: false, error: "userId required" });

    const { data, error } = await supabase
      .from("match_requests")
      .select("*")
      .eq("from_user_id", userId)
      .order("created_at", { ascending: false });

    if (error) return res.status(400).json({ success: false, error });

    return res.json({ success: true, data });
  } catch (err) {
    console.error("outgoing req err", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ----------------------------------------------------
   RESPOND TO REQUEST (ACCEPT / REJECT)
---------------------------------------------------- */
app.post("/requests/respond", async (req, res) => {
  try {
    const { requestId, action, currentUserId } = req.body || {};

    if (!requestId || !action || !currentUserId)
      return res.status(400).json({
        success: false,
        error: "requestId, action, currentUserId required",
      });

    const { data: reqRow, error: reqErr } = await supabase
      .from("match_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();

    if (reqErr || !reqRow)
      return res
        .status(404)
        .json({ success: false, error: "Request not found" });

    if (reqRow.to_user_id !== currentUserId)
      return res.status(403).json({ success: false, error: "Not allowed" });

    const newStatus = action === "accept" ? "accepted" : "rejected";

    const { data: updated, error: updErr } = await supabase
      .from("match_requests")
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .select("*")
      .single();

    if (updErr) return res.status(400).json({ success: false, error: updErr });

    let match = null;

    // If accepted → create match if not exists
    if (newStatus === "accepted") {
      const u1 = reqRow.from_user_id;
      const u2 = reqRow.to_user_id;

      const orQuery = `and(user1.eq.${u1},user2.eq.${u2}),and(user1.eq.${u2},user2.eq.${u1})`;

      const { data: exist } = await supabase
        .from("matches")
        .select("*")
        .or(orQuery);

      if (!exist || exist.length === 0) {
        const { data: created, error: createErr } = await supabase
          .from("matches")
          .insert([
            {
              user1: u1,
              user2: u2,
              created_at: new Date().toISOString(),
            },
          ])
          .select("*")
          .single();

        if (!createErr) match = created;
      } else {
        match = exist[0];
      }
    }

    return res.json({
      success: true,
      message:
        newStatus === "accepted"
          ? "Request Accepted & Match Created"
          : "Request Rejected",
      request: updated,
      match,
    });
  } catch (err) {
    console.error("respond req err", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ----------------------------------------------------
   CHECK MATCH
---------------------------------------------------- */
app.get("/check-match", async (req, res) => {
  try {
    const { user1, user2 } = req.query || {};

    if (!user1 || !user2)
      return res.status(400).json({
        success: false,
        error: "user1 & user2 required",
      });

    const orQuery = `and(user1.eq.${user1},user2.eq.${user2}),
                     and(user1.eq.${user2},user2.eq.${user1})`;

    const { data, error } = await supabase
      .from("matches")
      .select("*")
      .or(orQuery);

    if (error) return res.status(400).json({ success: false, error });

    if (!data || data.length === 0)
      return res.json({ success: true, matched: false });

    return res.json({
      success: true,
      matched: true,
      match_id: data[0].id,
      match: data[0],
    });
  } catch (err) {
    console.error("check-match err", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ----------------------------------------------------
   CHAT LIST
---------------------------------------------------- */
app.get("/chat-list", async (req, res) => {
  try {
    const userId = req.query.userId;

    if (!userId)
      return res.status(400).json({ success: false, error: "userId required" });

    const { data: matches, error: matchErr } = await supabase
      .from("matches")
      .select("*")
      .or(`user1.eq.${userId},user2.eq.${userId}`);

    if (matchErr) return res.status(400).json({ success: false, error: matchErr });

    const finalList = [];

    for (const m of matches || []) {
      const partnerId =
        String(m.user1) === String(userId) ? m.user2 : m.user1;

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, phone")
        .eq("phone", partnerId)
        .maybeSingle();

      const { data: lastMsg } = await supabase
        .from("messages")
        .select("*")
        .eq("match_id", m.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      finalList.push({
        match_id: m.id,
        user_id: partnerId,
        user_name: profile?.full_name || partnerId,
        user_avatar: profile?.avatar_url || null,
        last_message:
          lastMsg?.type === "audio"
            ? "🎤 ઓડિઓ સંદેશ"
            : lastMsg?.message || "કોઈ સંદેશ નથી",
        last_message_type: lastMsg?.type || "text",
        last_message_time: lastMsg?.created_at || null,
      });
    }

    return res.json({ success: true, data: finalList });
  } catch (err) {
    console.error("chat-list err", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ----------------------------------------------------
   PUBLIC CHAT
---------------------------------------------------- */
app.post("/public-chat/send", async (req, res) => {
  try {
    const { user_phone, message } = req.body || {};

    if (!user_phone || !message)
      return res
        .status(400)
        .json({ success: false, error: "Missing fields" });

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("public_chat")
      .insert([{ user_phone, message, created_at: now }])
      .select("*")
      .single();

    if (error) return res.status(400).json({ success: false, error });

    return res.json({ success: true, data });
  } catch (err) {
    console.error("public-chat send err", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/public-chat", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("public_chat")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) return res.status(400).json({ success: false, error });

    return res.json({ success: true, data });
  } catch (err) {
    console.error("public-chat get err", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ----------------------------------------------------
   PRIVATE CHAT MESSAGES
---------------------------------------------------- */
app.post("/send-message", async (req, res) => {
  try {
    const {
      match_id,
      sender_id,
      receiver_id,
      message,
      type = "text",
      image_url = null,
      audio_url = null,
      duration = null,
    } = req.body || {};

    if (!match_id || !sender_id || !receiver_id)
      return res.status(400).json({
        success: false,
        error: "match_id, sender_id, receiver_id required",
      });

    const row = {
      match_id,
      sender_id,
      receiver_id,
      message: message || "",
      type,
      image_url,
      audio_url,
      duration,
      delivered: false,
      seen: false,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("messages")
      .insert([row])
      .select("*")
      .single();

    if (error) return res.status(400).json({ success: false, error });

    return res.json({ success: true, data });
  } catch (err) {
    console.error("send-message err", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/messages/:match_id", async (req, res) => {
  try {
    const { match_id } = req.params;

    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("match_id", match_id)
      .order("created_at", { ascending: true });

    if (error) return res.status(400).json({ success: false, error });

    return res.json({ success: true, data });
  } catch (err) {
    console.error("get messages err", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ----------------------------------------------------
   DELIVERY RECEIPT + SEEN
---------------------------------------------------- */
app.post("/message-delivered", async (req, res) => {
  try {
    const { ids } = req.body || {};

    if (!ids || !Array.isArray(ids))
      return res.status(400).json({
        success: false,
        error: "ids array required",
      });

    const { data, error } = await supabase
      .from("messages")
      .update({ delivered: true })
      .in("id", ids)
      .select("*");

    if (error) return res.status(400).json({ success: false, error });

    return res.json({ success: true, data });
  } catch (err) {
    console.error("message delivered err", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/message-seen", async (req, res) => {
  try {
    const { ids } = req.body || {};

    if (!ids || !Array.isArray(ids))
      return res.status(400).json({
        success: false,
        error: "ids array required",
      });

    const { data, error } = await supabase
      .from("messages")
      .update({ seen: true, delivered: true })
      .in("id", ids)
      .select("*");

    if (error) return res.status(400).json({ success: false, error });

    return res.json({ success: true, data });
  } catch (err) {
    console.error("message seen err", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ----------------------------------------------------
   SUBSCRIPTIONS
---------------------------------------------------- */
app.post("/subscribe", async (req, res) => {
  try {
    const { user_phone, plan_name, price, duration } = req.body || {};

    if (!user_phone || !plan_name)
      return res.status(400).json({
        success: false,
        error: "Missing fields",
      });

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("subscriptions")
      .insert([{ user_phone, plan_name, price, duration, created_at: now }])
      .select("*")
      .single();

    if (error) return res.status(400).json({ success: false, error });

    return res.json({
      success: true,
      message: "Subscription Activated",
      data,
    });
  } catch (err) {
    console.error("subscribe err", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ----------------------------------------------------
   UPDATE PROFILE (by phone)
---------------------------------------------------- */
// POST /update-profile
// body: { phone: "...", full_name?, email?, birth_date?, avatar_base64?, avatar_url? }
app.post("/update-profile", async (req, res) => {
  try {
    const body = req.body || {};
    const phone = body.phone;

    if (!phone)
      return res.status(400).json({ success: false, error: "phone required" });

    // Build allowed update fields
    const allowed = [
      "full_name",
      "email",
      "birth_date",
      "avatar_base64",
      "avatar_url",
      "password",
    ];

    const upd = {};
    for (const k of allowed) {
      if (body[k] !== undefined) upd[k] = body[k];
    }

    upd.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("profiles")
      .update(upd)
      .eq("phone", phone)
      .select("*")
      .maybeSingle();

    if (error)
      return res.status(400).json({ success: false, error: error.message });

    if (!data)
      return res
        .status(404)
        .json({ success: false, error: "Profile not found" });

    return res.json({ success: true, data });
  } catch (err) {
    console.error("update-profile err", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ----------------------------------------------------
   UPLOAD AVATAR → Supabase Storage (bucket: avatars)
---------------------------------------------------- */
app.post("/upload-avatar", upload.single("image"), async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, error: "image file required" });

    const fileBuffer = fs.readFileSync(req.file.path);
    const ext = path.extname(req.file.originalname);
    const fileName = `avatar_${Date.now()}${ext}`;

    // Upload to bucket
    const { data, error } = await supabase.storage
      .from("avatars")
      .upload(fileName, fileBuffer, {
        cacheControl: "3600",
        upsert: false,
        contentType: req.file.mimetype,
      });

    safeUnlink(req.file.path);

    if (error) {
      console.error("Avatar Upload Error:", error);
      return res.status(400).json({ success: false, error });
    }

    // Get public URL
    const { data: publicUrl } = supabase.storage
      .from("avatars")
      .getPublicUrl(fileName);

    return res.json({
      success: true,
      url: publicUrl.publicUrl,
      fileName,
    });
  } catch (err) {
    console.error("upload-avatar err", err);
    if (req.file) safeUnlink(req.file.path);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ----------------------------
   PART–4: AI INTEGRATION (Full)
   - /ai-chat           -> text chat via Gemini (Generative Language)
   - /ai-speech-to-text -> upload audio -> (optional real STT) or mock
   - /ai-image          -> upload image -> (optional real Vision) or mock
   ---------------------------- */

const FormData = require("form-data"); // axios can use this for multipart if needed

// Helper: safe JSON extract
function safeGet(obj, path, fallback = undefined) {
  try {
    return path.split(".").reduce((a, k) => (a ? a[k] : undefined), obj) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * AI: TEXT CHAT
 * Frontend: POST { prompt: "..." }
 * Uses Google Generative Language (example endpoint). If GEMINI_API_KEY not set -> returns mock Gujarati reply.
 */
app.post("/ai-chat", async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ success: false, error: "prompt required" });

    // If no key configured -> return a helpful mock Gujarati reply
    if (!GEMINI_API_KEY) {
      const mock = `મોક જવાબ: "${String(prompt).substring(0, 240)}" — (Gemini API key not configured)`;
      return res.json({ success: true, reply: mock });
    }

    // NOTE:
    // This example uses the Google Generative Language REST shape (v1beta).
    // If your Google / Gemini account needs a different model or path, update the URL.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;

    // Keep the instruction in Gujarati so model replies in Gujarati
    const payload = {
      contents: [
        {
          parts: [
            {
              text: `હંમેશા ગુજરાતી માં, સંક્ષિપ્ત અને સહજ ભાષામાં જવાબ આપો. User: ${prompt}`
            }
          ]
        }
      ],
      // optional: adjust safety/tuning parameters here if needed
      // e.g. temperature / maxOutputTokens if supported by your model
    };

    const aiRes = await axios.post(url, payload, { timeout: 30000 });

    // try multiple shapes depending on provider shape
    const reply =
      safeGet(aiRes, "data.candidates.0.content.parts.0.text") ||
      safeGet(aiRes, "data.output.0.content.0.text") ||
      safeGet(aiRes, "data.output.0.text") ||
      safeGet(aiRes, "data.candidates.0.outputText") ||
      "માફ કરશો, જવાબ આપવા સમસ્યા આવી.";

    return res.json({ success: true, reply });
  } catch (err) {
    console.error("AI (chat) ERROR:", err?.response?.data || err?.message || err);
    // expose limited details for debugging if env DEBUG set
    if (process.env.DEBUG) {
      return res.status(500).json({ success: false, error: "AI_SERVER_ERROR", details: String(err?.response?.data || err?.message || err) });
    }
    return res.status(500).json({ success: false, error: "AI સર્વર ભૂલ" });
  }
});

/**
 * AI: SPEECH-TO-TEXT
 * - frontend uploads audio as form-data 'audio'
 * - If you configure a real STT provider, integrate below (Google Speech API / Whisper / AssemblyAI etc.)
 * - Otherwise this returns a mock transcript (Gujarati).
 */
app.post("/ai-speech-to-text", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "audio required" });

    // If you have a real STT provider, detect here and call it.
    // Example placeholders:
    // - If process.env.GOOGLE_SPEECH_KEY present -> call Google Speech-to-Text (requires base64 + REST)
    // - If process.env.WHISPER_URL present -> upload file to that endpoint
    //
    // For now: return a safe mock transcript in Gujarati so frontend UX works.

    // --- MOCK TRANSCRIPT (safe fallback) ---
    const mockTranscript = "હેલો, આ એક નમૂનો ટ્રાન્સક્રિપ્ટ છે — તમે જે કહ્યું તે અહીં દેખાશે.";

    // cleanup uploaded temp file
    safeUnlink(req.file.path);

    return res.json({ success: true, transcript: mockTranscript });
  } catch (err) {
    console.error("AI STT Error:", err);
    if (req.file) safeUnlink(req.file.path);
    return res.status(500).json({ success: false, error: err.message || "STT_ERROR" });
  }
});

/**
 * AI: IMAGE ANALYSIS / VISION
 * - frontend uploads image as form-data 'image' and optional 'prompt'
 * - If you have Gemini Vision or another Vision endpoint, set GEMINI_VISION_ENDPOINT env var (full URL)
 * - Otherwise this returns a mock analysis (safe fallback)
 */
app.post("/ai-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "image required" });

    const prompt = req.body.prompt || "";

    // If you configured a custom Gemini Vision endpoint, call it:
    // Example: process.env.GEMINI_VISION_ENDPOINT = "https://your-vision-endpoint/vision"
    if (process.env.GEMINI_VISION_ENDPOINT && GEMINI_API_KEY) {
      try {
        // read file as base64
        const b = fs.readFileSync(req.file.path);
        const base64 = b.toString("base64");

        // payload shape depends on your endpoint/provider
        const visionPayload = {
          image: { content: base64 },
          prompt: prompt,
          // add other params if your provider supports them
        };

        const visRes = await axios.post(process.env.GEMINI_VISION_ENDPOINT, visionPayload, {
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GEMINI_API_KEY}` },
          timeout: 30000,
        });

        const analysis = safeGet(visRes, "data.reply") || safeGet(visRes, "data.result") || JSON.stringify(visRes.data).substring(0, 1000);
        safeUnlink(req.file.path);
        return res.json({ success: true, reply: analysis });
      } catch (visErr) {
        console.error("Vision provider error:", visErr?.response?.data || visErr?.message || visErr);
        // fallback to mock below
      }
    }

    // Default mock analysis (useful for development)
    const mock = `મોક ઇમેજ વિશ્લેષણ: ફાઈલ ${req.file.originalname} - પ્રોમ્પ્ટ: "${String(prompt).substring(0,120)}"`;

    safeUnlink(req.file.path);
    return res.json({ success: true, reply: mock });
  } catch (err) {
    console.error("AI IMAGE ERROR:", err);
    if (req.file) safeUnlink(req.file.path);
    return res.status(500).json({ success: false, error: err.message || "IMAGE_ERROR" });
  }
});

// ----------------------------
// NOTIFICATIONS: fetch / mark-read / clear / create helper
// Paste this block BEFORE the "START SERVER" section
// ----------------------------

async function createNotification({ user_phone, type, title, body, data = {} }) {
  try {
    const now = new Date().toISOString();
    const { data: inserted, error } = await supabase
      .from("notifications")
      .insert([{ user_phone, type, title, body, data, created_at: now, updated_at: now }])
      .select("*")
      .single();
    if (error) {
      console.error("createNotification error:", error);
      return null;
    }
    return inserted;
  } catch (err) {
    console.error("createNotification exception:", err);
    return null;
  }
}

// GET /notifications?user=PHONE
app.get("/notifications", async (req, res) => {
  try {
    const user = req.query.user;
    if (!user) return res.status(400).json({ success: false, error: "user query param required" });

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_phone", user)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return res.status(400).json({ success: false, error });
    return res.json({ success: true, data });
  } catch (err) {
    console.error("GET /notifications err:", err);
    return res.status(500).json({ success: false, error: err.message || err });
  }
});

// POST /notifications/mark-read  body: { ids: [..] } OR { user_phone: "..." }
app.post("/notifications/mark-read", async (req, res) => {
  try {
    const { ids, user_phone } = req.body || {};
    if ((!ids || !Array.isArray(ids)) && !user_phone) {
      return res.status(400).json({ success: false, error: "ids array or user_phone required" });
    }

    let qb = supabase.from("notifications");
    if (ids && Array.isArray(ids)) {
      qb = qb.update({ read: true, updated_at: new Date().toISOString() }).in("id", ids);
    } else {
      qb = qb.update({ read: true, updated_at: new Date().toISOString() }).eq("user_phone", user_phone).eq("read", false);
    }

    const { data, error } = await qb.select("*");
    if (error) return res.status(400).json({ success: false, error });
    return res.json({ success: true, data });
  } catch (err) {
    console.error("POST /notifications/mark-read err:", err);
    return res.status(500).json({ success: false, error: err.message || err });
  }
});

// POST /notifications/clear  body: { ids:[..] } OR { user_phone: "..." }
app.post("/notifications/clear", async (req, res) => {
  try {
    const { ids, user_phone } = req.body || {};
    if ((!ids || !Array.isArray(ids)) && !user_phone) {
      return res.status(400).json({ success: false, error: "ids array or user_phone required" });
    }

    let qb;
    if (ids && Array.isArray(ids)) {
      qb = supabase.from("notifications").delete().in("id", ids);
    } else {
      qb = supabase.from("notifications").delete().eq("user_phone", user_phone);
    }

    const { data, error } = await qb;
    if (error) return res.status(400).json({ success: false, error });
    return res.json({ success: true, deleted: data?.length || 0 });
  } catch (err) {
    console.error("POST /notifications/clear err:", err);
    return res.status(500).json({ success: false, error: err.message || err });
  }
});

// ----------------------------
// TRUST: BALANCE, EVENTS, REGISTRATION, OPINIONS
// ----------------------------

// 1) GET TRUST BALANCE
app.get("/trust/balance", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("trust_balance")
      .select("balance")
      .single();

    if (error) return res.json({ success: false, error });

    return res.json({ success: true, balance: data.balance });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2) GET ALL EVENTS
app.get("/trust/events", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("trust_events")
      .select("*")
      .order("date", { ascending: true });

    if (error) return res.json({ success: false, error });

    return res.json({ success: true, events: data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3) REGISTER FOR EVENT
app.post("/trust/register", async (req, res) => {
  try {
    const { user_phone, event_id } = req.body;

    if (!user_phone || !event_id)
      return res.json({ success: false, error: "Missing fields" });

    await supabase.from("trust_registrations").insert([
      { user_phone, event_id }
    ]);

    // Increase attendees count
    await supabase.rpc("increment_event_attendees", { eventid: event_id });

    return res.json({ success: true, message: "Registration successful" });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4) POST OPINION / SUGGESTION
app.post("/trust/opinion", async (req, res) => {
  try {
    const { user_phone, message } = req.body;

    if (!message)
      return res.json({ success: false, error: "Message required" });

    await supabase.from("trust_opinions").insert([
      { user_phone, message }
    ]);

    return res.json({ success: true, message: "Opinion submitted" });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});


// ----------------------------
// START SERVER
// ----------------------------
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
