/**
 * WhatsApp Web.js Service
 * =======================
 * A lightweight HTTP server wrapping whatsapp-web.js.
 * Exposes endpoints:
 *   POST /send    — send a text message  { chatId, text }
 *   GET  /groups  — list all WhatsApp groups
 *   GET  /status  — { ready, state }
 *   GET  /qr      — { qr: "data:image/png;base64,..." } or { qr: null }
 *
 * Usage:
 *   npm install
 *   node whatsapp_service.js
 *   # QR code is exposed via /qr endpoint for the web UI
 *   # Session is saved to .wwebjs_auth/ so you only scan once
 */

const http = require("http");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode");

const PORT = parseInt(process.env.WA_SERVICE_PORT || "3002", 10);

// --- WhatsApp Client ---
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
  puppeteer: {
    headless: true,
    protocolTimeout: 120000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-software-rasterizer",
    ],
  },
});

let isReady = false;
let clientState = "initializing"; // initializing | qr | authenticated | ready | disconnected
let currentQR = null; // base64 data URL of QR code

client.on("qr", async (qr) => {
  clientState = "qr";
  console.log("\n[WhatsApp] QR code received. Scan via web UI or terminal:\n");
  qrcodeTerminal.generate(qr, { small: true });

  // Generate base64 data URL for the web UI
  try {
    currentQR = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
  } catch (err) {
    console.error("[WhatsApp] Failed to generate QR data URL:", err.message);
    currentQR = null;
  }
});

client.on("authenticated", () => {
  clientState = "authenticated";
  currentQR = null; // QR no longer needed
  console.log("[WhatsApp] Authenticated successfully");
});

client.on("auth_failure", (msg) => {
  clientState = "disconnected";
  currentQR = null;
  console.error("[WhatsApp] Authentication failed:", msg);
});

client.on("ready", () => {
  isReady = true;
  clientState = "ready";
  currentQR = null;
  console.log("[WhatsApp] Client is ready!");
  console.log(`[WhatsApp] HTTP server listening on http://localhost:${PORT}`);
});

client.on("disconnected", (reason) => {
  isReady = false;
  clientState = "disconnected";
  currentQR = null;
  console.warn("[WhatsApp] Disconnected:", reason);
  console.log("[WhatsApp] Attempting to reconnect...");
  client.initialize();
});

// --- HTTP Server ---
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function jsonResponse(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  try {
    // --- POST /send ---
    if (req.method === "POST" && req.url === "/send") {
      if (!isReady) {
        return jsonResponse(res, 503, {
          error: "WhatsApp client not ready. Scan QR code first.",
        });
      }

      const body = await parseBody(req);
      const { chatId, text } = body || {};

      if (!chatId || !text) {
        return jsonResponse(res, 400, {
          error: "Missing required fields: chatId, text",
        });
      }

      const msg = await client.sendMessage(chatId, text);
      return jsonResponse(res, 200, {
        success: true,
        messageId: msg.id._serialized,
      });
    }

    // --- GET /groups ---
    if (req.method === "GET" && req.url === "/groups") {
      if (!isReady) {
        return jsonResponse(res, 503, {
          error: "WhatsApp client not ready. Scan QR code first.",
        });
      }

      const chats = await client.getChats();
      const groups = chats
        .filter((c) => c.isGroup)
        .map((c) => ({ id: c.id._serialized, name: c.name }));

      return jsonResponse(res, 200, groups);
    }

    // --- GET /status ---
    if (req.method === "GET" && req.url === "/status") {
      return jsonResponse(res, 200, { ready: isReady, state: clientState });
    }

    // --- GET /qr ---
    if (req.method === "GET" && req.url === "/qr") {
      return jsonResponse(res, 200, { qr: currentQR, state: clientState });
    }

    // --- POST /disconnect ---
    if (req.method === "POST" && req.url === "/disconnect") {
      try {
        await client.logout();
        isReady = false;
        clientState = "disconnected";
        currentQR = null;
        console.log("[WhatsApp] Logged out. Will show QR on next initialize.");
        // Re-initialize to get a new QR code
        setTimeout(() => {
          clientState = "initializing";
          client.initialize();
        }, 2000);
        return jsonResponse(res, 200, { status: "disconnected" });
      } catch (err) {
        console.error("[WhatsApp] Disconnect error:", err.message);
        return jsonResponse(res, 500, { error: err.message });
      }
    }

    // --- 404 ---
    jsonResponse(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("[HTTP] Error:", err.message);
    jsonResponse(res, 500, { error: err.message });
  }
});

// --- Start ---
server.listen(PORT, () => {
  console.log(`[Server] Starting on port ${PORT}...`);
  console.log("[WhatsApp] Initializing client (this may take a moment)...");
  client.initialize();
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n[Server] Shutting down...");
  await client.destroy();
  server.close();
  process.exit(0);
});
