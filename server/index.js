import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";

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

app.post("/api/tiktok/connect", (req, res) => {
  const requested = String(req.body?.username || "").trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{2,24}$/.test(requested)) return res.status(400).json({ ok: false, message: "Informe um usuário TikTok válido, sem espaços." });
  tiktokUsername = requested;
  tiktokStatus.username = requested;
  tiktokStatus.configured = true;
  connectionGeneration++;
  if (tiktokSocket) {
    const old = tiktokSocket;
    tiktokSocket = null;
    try { old.close(); } catch {}
  }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  updateTikTokStatus("connecting", "Solicitando conexão à LIVE de " + requested + " pelo EulerStream WebSocket…");
  connectTikTok();
  return res.json({ ok: true, username: requested, configured: true, state: tiktokStatus.state, message: tiktokStatus.message });
});

app.get("/", (_req, res) => {
  if (hasBuiltFrontend) return res.sendFile(resolve(distDir, "index.html"));
  return res.status(503).json({ service: "Arena do Brasil 3D event gateway", error: "Frontend build not found. Run npm run build before starting production server." });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/events" });
const clients = new Set();
const recentIds = new Map();
let tiktokUsername = String(process.env.TIKTOK_USERNAME || "nandobr_ofc").trim().replace(/^@/, "");
const eulerApiKey = String(process.env.EULERSTREAM_API_KEY || "").trim();
const tiktokStatus = {
  configured: Boolean(tiktokUsername),
  provider: "eulerstream-websocket",
  username: tiktokUsername || null,
  connected: false,
  state: "connecting",
  message: eulerApiKey ? "Preparando conexão EulerStream…" : "Falta configurar EULERSTREAM_API_KEY no Render."
};
let tiktokSocket = null;
let connectionGeneration = 0;
let reconnectTimer = null;

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of clients) if (client.readyState === 1) client.send(message);
}
function updateTikTokStatus(state, message, connected = false) {
  Object.assign(tiktokStatus, { state, message, connected, updatedAt: new Date().toISOString() });
  broadcast({ type: "status", mode: connected ? "tiktok-live" : "simulator", tiktok: { ...tiktokStatus } });
  console.log("[EulerStream LIVE]", state, message);
}
function scheduleTikTokReconnect() {
  if (!tiktokUsername || reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectTikTok(); }, 30000);
  reconnectTimer.unref?.();
}
function getViewerName(data) {
  return String(data?.user?.uniqueId || data?.user?.nickname || data?.user?.displayId || "Espectador").slice(0, 24);
}
function getDiamonds(data) {
  return Math.max(0, Number(data?.gift?.diamondCount ?? data?.diamondCount ?? 0) || 0);
}
function pick(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}
function normalizeEulerMessage(raw) {
  const root = raw?.data && typeof raw.data === "object" ? raw.data : raw;
  const type = String(pick(root, ["type", "event", "eventType", "method", "messageType", "msgType"]) || pick(raw, ["type", "event", "eventType", "method", "messageType", "msgType"]) || "").toLowerCase();
  const user = root?.user || root?.sender || root?.from || root?.common?.user || {};
  const viewer = String(pick(user, ["uniqueId", "unique_id", "nickname", "displayId", "display_id"]) || pick(root, ["uniqueId", "nickname", "username"]) || "Espectador").slice(0, 24);
  const content = pick(root, ["content", "comment", "text", "message"]);
  const giftObj = root?.gift || root?.giftDetails || root?.gift_details || {};
  const giftName = String(pick(giftObj, ["name", "giftName", "gift_name"]) || pick(root, ["giftName", "gift_name"]) || "Presente").slice(0, 80);
  const diamonds = Math.max(0, Number(pick(giftObj, ["diamondCount", "diamond_count", "value"]) ?? pick(root, ["diamondCount", "diamond_count", "giftValue"]) ?? 0) || 0);
  const id = String(pick(root, ["msgId", "messageId", "message_id", "eventId", "event_id"]) || "");
  if (/chat|comment|immessage/.test(type) || typeof content === "string" && /chat|comment/.test(JSON.stringify(raw).slice(0, 250).toLowerCase())) {
    const comment = String(content ?? "").slice(0, 500);
    const command = comment.trim().toLowerCase().split(/\s+/)[0];
    return { type: "chat", viewer, comment, command: ["!verde", "!azul", "!ataque", "!defesa"].includes(command) ? command : null, eventId: id };
  }
  if (/gift|diamondsent/.test(type) || root?.gift) {
    if (root?.isStreakOver === false || root?.repeatEnd === false) return null;
    return { type: "gift", gift: diamonds >= 10 ? "special" : diamonds >= 2 ? "shield" : "confetti", viewer, giftName, diamonds, eventId: id || giftName + ":" + String(root?.repeatCount || 1) };
  }
  if (/like|digg/.test(type)) {
    return { type: "likes", count: Math.max(1, Math.min(1000000, Math.floor(Number(pick(root, ["count", "total", "likeCount", "like_count"]) || 1)))), viewer };
  }
  if (/follow/.test(type)) return { type: "social", event: "follow", viewer };
  if (/share/.test(type)) return { type: "social", event: "share", viewer };
  if (/member|join|enter/.test(type)) return { type: "social", event: "member", viewer };
  const count = Number(pick(root, ["viewerCount", "viewer_count", "userCount"]));
  if (/roomuser|viewer|roomstats/.test(type) && Number.isFinite(count)) return { type: "viewer_count", viewerCount: Math.max(0, Math.floor(count)) };
  return null;
}
function handleEulerFrame(frame) {
  let parsed;
  try { parsed = JSON.parse(Buffer.isBuffer(frame) ? frame.toString("utf8") : String(frame)); }
  catch { return; }
  const messages = Array.isArray(parsed?.messages) ? parsed.messages : Array.isArray(parsed) ? parsed : [parsed];
  for (const raw of messages) {
    const event = normalizeEulerMessage(raw);
    if (!event) continue;
    if (event.type === "chat") {
      broadcast({ type: "chat", viewer: event.viewer, comment: event.comment, command: event.command, eventId: event.eventId });
    } else if (event.type === "gift") {
      broadcast({ type: "gift", gift: event.gift, viewer: event.viewer, giftName: event.giftName, diamonds: event.diamonds, eventId: event.eventId });
    } else if (event.type === "likes") {
      broadcast(event);
    } else {
      broadcast(event);
    }
  }
}
function connectTikTok() {
  if (!tiktokUsername) {
    updateTikTokStatus("needs-username", "Informe o usuário da LIVE para conectar.");
    return;
  }
  if (!eulerApiKey) {
    updateTikTokStatus("needs-api-key", "Configure EULERSTREAM_API_KEY nas variáveis do Render.");
    return;
  }
  if (tiktokSocket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(tiktokSocket.readyState)) return;
  const generation = ++connectionGeneration;
  const url = new URL("wss://ws.eulerstream.com");
  url.searchParams.set("uniqueId", tiktokUsername);
  url.searchParams.set("apiKey", eulerApiKey);
  url.searchParams.set("features.bundleEvents", "true");
  url.searchParams.set("features.normalizeUniqueId", "true");
  url.searchParams.set("features.syntheticPresence", "true");
  url.searchParams.set("schemaVersion", "v1");
  updateTikTokStatus("connecting", "Conectando à LIVE de " + tiktokUsername + " pelo EulerStream WebSocket…");
  const socket = new WebSocket(url.toString(), { handshakeTimeout: 15000 });
  tiktokSocket = socket;
  socket.on("open", () => {
    if (generation !== connectionGeneration) return;
    updateTikTokStatus("connected", "WebSocket EulerStream conectado para " + tiktokUsername + "; aguardando eventos reais.", true);
  });
  socket.on("message", frame => {
    if (generation === connectionGeneration) handleEulerFrame(frame);
  });
  socket.on("error", err => {
    if (generation !== connectionGeneration) return;
    const detail = String(err?.message || "erro de WebSocket").slice(0, 180);
    console.error("[EulerStream LIVE] erro:", detail);
    updateTikTokStatus("connection-error", "EulerStream: " + detail, false);
  });
  socket.on("close", (code, reason) => {
    if (generation !== connectionGeneration) return;
    tiktokSocket = null;
    const detail = Buffer.isBuffer(reason) ? reason.toString("utf8") : String(reason || "");
    const offline = code === 4404 || /not live|offline/i.test(detail);
    updateTikTokStatus(offline ? "waiting-for-live" : "disconnected", offline ? "A LIVE de " + tiktokUsername + " não está ativa; nova tentativa em 30 segundos." : "EulerStream encerrou a conexão (" + code + "); tentando novamente.", false);
    scheduleTikTokReconnect();
  });
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
server.listen(port, "0.0.0.0", () => {
  console.log("Arena gateway listening on " + port);
  connectTikTok();
});
