/**
 * WhatsApp Web.js Service
 * =======================
 * A lightweight HTTP server wrapping whatsapp-web.js.
 * Exposes two endpoints:
 *   POST /send    — send a text message  { chatId, text }
 *   GET  /groups  — list all WhatsApp groups
 *
 * Usage:
 *   npm install
 *   node whatsapp_service.js
 *   # Scan the QR code in the terminal on first run
 *   # Session is saved to .wwebjs_auth/ so you only scan once
 */

const http = require("http");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const PORT = parseInt(process.env.WA_SERVICE_PORT || "3001", 10);

// --- WhatsApp Client ---
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  },
});

let isReady = false;

client.on("qr", (qr) => {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║  Scan this QR code with WhatsApp:    ║");
  console.log("╚══════════════════════════════════════╝\n");
  qrcode.generate(qr, { small: true });
  console.log("\nOpen WhatsApp → Settings → Linked Devices → Link a Device\n");
});

client.on("authenticated", () => {
  console.log("[WhatsApp] Authenticated successfully");
});

client.on("auth_failure", (msg) => {
  console.error("[WhatsApp] Authentication failed:", msg);
});

client.on("ready", () => {
  isReady = true;
  console.log("[WhatsApp] Client is ready!");
  console.log(`[WhatsApp] HTTP server listening on http://localhost:${PORT}`);
});

client.on("disconnected", (reason) => {
  isReady = false;
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
      return jsonResponse(res, 200, { ready: isReady });
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
