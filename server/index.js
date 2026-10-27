import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { WebSocketServer } from "ws";
import WebSocket from "ws";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

const distDir = resolve(process.cwd(), "dist");
const hasBuiltFrontend = existsSync(resolve(distDir, "index.html"));
if (hasBuiltFrontend) app.use(express.static(distDir, { index: false, maxAge: "1h" }));

app.get("/health", (_req, res) => res.json({
  ok: true,
  service: "arena-do-brasil-3d",
  mode: "simulator-ready",
  frontendBuilt: hasBuiltFrontend,
  platformAdapter: tiktokStatus.provider,
  tiktok: { ...tiktokStatus }
}));

app.get("/api/tiktok/status", (_req, res) => res.json({ ...tiktokStatus }));

app.get("/", (_req, res) => {
  if (hasBuiltFrontend) return res.sendFile(resolve(distDir, "index.html"));
  return res.status(503).json({
    service: "Arena do Brasil 3D event gateway",
    error: "Frontend build not found. Run npm run build before starting production server."
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/events" });
const clients = new Set();
const recentIds = new Map();
const tiktokUsername = String(process.env.TIKTOK_USERNAME || "nandobr_ofc").trim().replace(/^@/, "");
const tiktoolApiKey = String(process.env.TIKTOOL_API_KEY || "").trim();
const tiktokStatus = {
  configured: Boolean(tiktokUsername && tiktoolApiKey),
  provider: "tiktool",
  username: tiktokUsername ? "@" + tiktokUsername : null,
  connected: false,
  state: !tiktoolApiKey ? "needs-api-key" : "connecting",
  message: !tiktoolApiKey ? "TikTool selecionado. Adicione TIKTOOL_API_KEY nas variáveis privadas do Render." : "Conectando ao TikTok LIVE…"
};
let tiktokSocket = null;
let reconnectTimer = null;
function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of clients) if (client.readyState === 1) client.send(message);
}
function updateTikTokStatus(state, message, connected = false) {
  Object.assign(tiktokStatus, { state, message, connected, updatedAt: new Date().toISOString() });
  broadcast({ type: "status", mode: connected ? "tiktok-live" : "simulator", tiktok: { ...tiktokStatus } });
  console.log("[TikTok LIVE / TikTool]", state, message);
}
function scheduleTikTokReconnect() {
  if (!tiktoolApiKey || !tiktokUsername || reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectTikTok(); }, 30000);
  reconnectTimer.unref?.();
}
async function connectTikTok() {
  if (!tiktokUsername || !tiktoolApiKey) {
    updateTikTokStatus("needs-api-key", "Adicione TIKTOOL_API_KEY nas variáveis privadas do Render para ativar os eventos reais.");
    return;
  }
  if (tiktokSocket && (tiktokSocket.readyState === WebSocket.OPEN || tiktokSocket.readyState === WebSocket.CONNECTING)) return;
  updateTikTokStatus("connecting", "Validando a chave e preparando conexão segura com TikTool…");
  try {
    // Official Tik.Tools JWT flow. The API key stays only in Render's environment.
    // If no username is configured, discover the first public live channel.
    let creator = tiktokUsername;
    if (!creator) {
      const channelsResponse = await fetch("https://api.tik.tools/api/live/top-channels");
      const channelsPayload = await channelsResponse.json();
      creator = String(channelsPayload?.channels?.[0]?.uniqueId || "").trim().replace(/^@/, "");
      if (!channelsResponse.ok || !creator) {
        updateTikTokStatus("error", "TikTool não retornou canais ao vivo para selecionar.");
        scheduleTikTokReconnect();
        return;
      }
    }
    const authResponse = await fetch("https://api.tik.tools/authentication/jwt?apiKey=" + encodeURIComponent(tiktoolApiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowed_creators: [creator], expire_after: 600, max_websockets: 1 })
    });
    const authText = await authResponse.text();
    let authPayload = {};
    try { authPayload = JSON.parse(authText); } catch {}
    const jwt = authPayload?.data?.token;
    if (!authResponse.ok || !jwt) {
      const detail = String(authPayload?.message || authPayload?.error || authPayload?.data?.message || authPayload?.detail || authText || ("HTTP " + authResponse.status))
        .replace(tiktoolApiKey, "[chave ocultada]").replace(/[\\r\\n\\t]+/g, " ").slice(0, 180);
      updateTikTokStatus("error", "TikTool JWT HTTP " + authResponse.status + ": " + detail);
      scheduleTikTokReconnect();
      return;
    }
    const url = "wss://api.tik.tools/?uniqueId=" + encodeURIComponent(creator) + "&jwtKey=" + encodeURIComponent(jwt);
    const socket = new WebSocket(url);
    tiktokSocket = socket;
    socket.on("open", () => updateTikTokStatus("connected", "Conectado ao fluxo TikTok LIVE pelo TikTool para @" + tiktokUsername, true));
    socket.on("message", raw => {
      let packet;
      try { packet = JSON.parse(raw.toString()); } catch { return; }
      const event = String(packet?.event || "").toLowerCase();
      const data = packet?.data || {};
      const viewer = String(data?.user?.uniqueId || data?.user_unique_id || data?.uniqueId || "Espectador").slice(0, 24);
      if (event === "chat") {
        const comment = String(data?.comment || "").slice(0, 500);
        const first = comment.trim().toLowerCase().split(/\\s+/)[0];
        const command = ["!verde", "!azul", "!ataque", "!defesa"].includes(first) ? first : null;
        broadcast({ type: "chat", viewer, comment, command, eventId: String(data?.msgId || data?.messageId || "") });
      } else if (event === "gift") {
        if (data?.repeatEnd === false) return;
        const giftName = String(data?.giftName || ("Presente " + (data?.giftId ?? ""))).slice(0, 80);
        const diamonds = Math.max(0, Number(data?.diamondCount ?? 0) || 0);
        const gift = diamonds >= 10 ? "special" : diamonds >= 2 ? "shield" : "confetti";
        broadcast({ type: "gift", gift, viewer, giftName, diamonds, eventId: String(data?.transactionId || data?.msgId || data?.giftId || "") + ":" + String(data?.repeatCount || 1) });
      } else if (event === "like") {
        const count = Math.max(1, Math.min(1000000, Math.floor(Number(data?.likeCount ?? data?.count ?? 1) || 1)));
        broadcast({ type: "likes", count, viewer });
      } else if (event === "social" || event === "follow" || event === "share") {
        const action = String(data?.event || data?.action || event).toLowerCase();
        if (action.includes("follow")) broadcast({ type: "social", event: "follow", viewer });
        else if (action.includes("share")) broadcast({ type: "social", event: "share", viewer });
      }
    });
    socket.on("error", err => {
      updateTikTokStatus("error", "TikTool WebSocket: " + String(err?.message || err || "erro de conexão").slice(0, 140));
    });
    socket.on("close", (code, reason) => {
      if (tiktokSocket === socket) tiktokSocket = null;
      updateTikTokStatus("disconnected", "TikTool encerrou a conexão (" + code + "). Nova tentativa em 30 segundos." + (reason?.length ? " " + reason.toString().slice(0, 80) : ""));
      scheduleTikTokReconnect();
    });
  } catch (err) {
    updateTikTokStatus("error", "Falha ao autenticar no TikTool: " + String(err?.message || err || "erro inesperado").slice(0, 140));
    scheduleTikTokReconnect();
  }
}

const allowedTypes = new Set(["chat", "gift", "likes"]);

wss.on("connection", socket => {
  clients.add(socket);
  socket.send(JSON.stringify({ type: "status", mode: tiktokStatus.connected ? "tiktok-live" : "simulator", tiktok: { ...tiktokStatus }, message: tiktokStatus.message }));
  socket.on("message", raw => {
    let event;
    try { event = JSON.parse(raw.toString()); } catch { return; }
    if (!event || !allowedTypes.has(event.type)) return;
    const viewer = String(event.viewer || "Espectador").trim().slice(0, 24) || "Espectador";
    const id = String(event.eventId || "").slice(0, 100);
    if (id && recentIds.has(id)) return;
    if (id) {
      recentIds.set(id, Date.now());
      if (recentIds.size > 2000) recentIds.delete(recentIds.keys().next().value);
    }
    let safe;
    if (event.type === "chat") {
      const command = String(event.command || "").trim().toLowerCase();
      if (!["!verde", "!azul", "!ataque", "!defesa"].includes(command)) return;
      safe = { type: "chat", command, viewer };
    } else if (event.type === "gift") {
      const gift = String(event.gift || "");
      if (!["confetti", "shield", "special"].includes(gift)) return;
      safe = { type: "gift", gift, viewer };
    } else {
      const count = Number(event.count);
      if (!Number.isFinite(count) || count < 1 || count > 1000000) return;
      safe = { type: "likes", count: Math.floor(count), viewer };
    }
    const payload = JSON.stringify(safe);
    for (const client of clients) if (client.readyState === 1) client.send(payload);
  });
  socket.on("close", () => clients.delete(socket));
});

const port = Number(process.env.PORT || 3001);
server.listen(port, "0.0.0.0", () => { console.log("Arena gateway listening on " + port); connectTikTok(); });