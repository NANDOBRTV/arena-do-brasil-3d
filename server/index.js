import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { WebSocketServer } from "ws";
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from "tiktok-live-connector";

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
  platformAdapter: tiktokStatus.configured ? "tiktok-live-connector" : "not-configured",
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
const tiktokStatus = { configured: Boolean(tiktokUsername), username: tiktokUsername ? "@" + tiktokUsername : null, connected: false, state: tiktokUsername ? "connecting" : "not-configured", message: tiktokUsername ? "Conectando ao TikTok LIVE…" : "Defina TIKTOK_USERNAME no ambiente do servidor." };
let tiktokConnection = null;
let reconnectTimer = null;
function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of clients) if (client.readyState === 1) client.send(message);
}
function updateTikTokStatus(state, message, connected = false) {
  Object.assign(tiktokStatus, { state, message, connected, updatedAt: new Date().toISOString() });
  broadcast({ type: "status", mode: connected ? "tiktok-live" : "simulator", tiktok: { ...tiktokStatus } });
  console.log("[TikTok LIVE]", state, message);
}
function scheduleTikTokReconnect() {
  if (!tiktokUsername || reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectTikTok(); }, 30000);
  reconnectTimer.unref?.();
}
function connectTikTok() {
  if (!tiktokUsername) return;
  if (tiktokConnection?.isConnected || tiktokConnection?.isConnecting) return;
  updateTikTokStatus("connecting", "Tentando conectar ao @" + tiktokUsername + "…");
  const connection = new TikTokLiveConnection(tiktokUsername, { enableExtendedGiftInfo: true });
  tiktokConnection = connection;
  connection.on(ControlEvent.CONNECTED, () => updateTikTokStatus("connected", "Conectado à live de @" + tiktokUsername, true));
  connection.on(ControlEvent.DISCONNECTED, () => { updateTikTokStatus("disconnected", "Conexão TikTok encerrada; nova tentativa em 30 segundos."); scheduleTikTokReconnect(); });
  connection.on(ControlEvent.STREAM_END, () => { updateTikTokStatus("offline", "A live terminou ou está offline; nova tentativa em 30 segundos."); scheduleTikTokReconnect(); });
  connection.on(ControlEvent.ERROR, err => { updateTikTokStatus("error", "Falha na conexão TikTok: " + String(err?.message || err).slice(0, 180)); });
  connection.on(WebcastEvent.CHAT, data => {
    const viewer = String(data?.user?.uniqueId || data?.uniqueId || "Espectador").slice(0, 24);
    const comment = String(data?.comment || "").slice(0, 500);
    const first = comment.trim().toLowerCase().split(/\s+/)[0];
    const command = ["!verde", "!azul", "!ataque", "!defesa"].includes(first) ? first : null;
    broadcast({ type: "chat", viewer, comment, command, eventId: String(data?.msgId || data?.messageId || "") });
  });
  connection.on(WebcastEvent.GIFT, data => {
    if (data?.repeatEnd === false) return;
    const viewer = String(data?.user?.uniqueId || data?.uniqueId || "Espectador").slice(0, 24);
    const giftName = String(data?.giftName || data?.extendedGiftInfo?.name || ("Presente " + (data?.giftId ?? ""))).slice(0, 80);
    const diamonds = Math.max(0, Number(data?.diamondCount ?? data?.extendedGiftInfo?.diamond_count ?? 0) || 0);
    const gift = diamonds >= 10 ? "special" : diamonds >= 2 ? "shield" : "confetti";
    broadcast({ type: "gift", gift, viewer, giftName, diamonds, eventId: String(data?.msgId || data?.giftId || "") + ":" + String(data?.repeatCount || 1) });
  });
  connection.on(WebcastEvent.LIKE, data => {
    const count = Math.max(1, Math.min(1000000, Math.floor(Number(data?.likeCount ?? data?.count ?? 1) || 1)));
    broadcast({ type: "likes", count, viewer: String(data?.user?.uniqueId || data?.uniqueId || "Espectador").slice(0, 24) });
  });
  connection.on(WebcastEvent.FOLLOW, data => broadcast({ type: "social", event: "follow", viewer: String(data?.user?.uniqueId || data?.uniqueId || "Alguém").slice(0, 24) }));
  connection.on(WebcastEvent.SHARE, data => broadcast({ type: "social", event: "share", viewer: String(data?.user?.uniqueId || data?.uniqueId || "Alguém").slice(0, 24) }));
  connection.connect().catch(err => {
    updateTikTokStatus("error", "Não foi possível conectar: " + String(err?.message || err).slice(0, 180));
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
server.listen(port, "0.0.0.0", () => { console.log("Arena gateway listening on " + port); connectTikTok(); });