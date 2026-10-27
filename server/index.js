import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { WebSocketServer } from "ws";
import { TikTokLiveClient, EventType } from "piratetok-live-js";

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
  if (tiktokSocket) {
    const old = tiktokSocket;
    tiktokSocket = null;
    try { old.disconnect(); } catch {}
  }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  updateTikTokStatus("connecting", "Solicitando conexão à LIVE de " + requested + " pelo PirateTok Live JS…");
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
const tiktokStatus = {
  configured: Boolean(tiktokUsername),
  provider: "piratetok-live-js",
  username: tiktokUsername || null,
  connected: false,
  state: "connecting",
  message: "Conectando ao PirateTok Live JS…"
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
  console.log("[PirateTok LIVE]", state, message);
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
async function connectTikTok() {
  if (!tiktokUsername) {
    updateTikTokStatus("needs-username", "Informe o usuário da LIVE para conectar.");
    return;
  }
  if (tiktokSocket) return;
  updateTikTokStatus("connecting", "Conectando à LIVE de " + tiktokUsername + " pelo PirateTok Live JS…");
  let live;
  try {
    live = new TikTokLiveClient(tiktokUsername).timeout(15000).maxRetries(10).region("BR");
    tiktokSocket = live;
    live.on(EventType.chat, data => {
      const comment = String(data?.content || "").slice(0, 500);
      const command = comment.trim().toLowerCase().split(/\s+/)[0];
      const accepted = ["!verde", "!azul", "!ataque", "!defesa"].includes(command) ? command : null;
      broadcast({ type: "chat", viewer: getViewerName(data), comment, command: accepted, eventId: String(data?.msgId || data?.messageId || "") });
    });
    live.on(EventType.gift, data => {
      if (data?.isStreakOver === false || data?.isCombo === true && data?.repeatEnd === false) return;
      const diamonds = getDiamonds(data);
      const giftName = String(data?.gift?.name || data?.gift?.giftName || "Presente").slice(0, 80);
      const gift = diamonds >= 10 ? "special" : diamonds >= 2 ? "shield" : "confetti";
      broadcast({ type: "gift", gift, viewer: getViewerName(data), giftName, diamonds, eventId: String(data?.msgId || data?.gift?.id || giftName) + ":" + String(data?.repeatCount || 1) });
    });
    live.on(EventType.like, data => {
      const count = Math.max(1, Math.min(1000000, Math.floor(Number(data?.count ?? data?.total ?? 1) || 1)));
      broadcast({ type: "likes", count, viewer: getViewerName(data) });
    });
    live.on(EventType.follow, data => broadcast({ type: "social", event: "follow", viewer: getViewerName(data) }));
    live.on(EventType.share, data => broadcast({ type: "social", event: "share", viewer: getViewerName(data) }));
    live.on(EventType.join, data => broadcast({ type: "social", event: "member", viewer: getViewerName(data) }));
    live.on(EventType.liveEnded, () => {
      if (tiktokSocket === live) tiktokSocket = null;
      updateTikTokStatus("waiting-for-live", "A LIVE de " + tiktokUsername + " terminou; aguardando nova transmissão.");
      scheduleTikTokReconnect();
    });
    live.on("reconnecting", info => {
      console.warn("[PirateTok LIVE] reconectando", info || "");
      if (tiktokStatus.connected) updateTikTokStatus("reconnecting", "Conexão instável; PirateTok está tentando reconectar.");
    });
    live.on("disconnected", () => {
      if (tiktokSocket === live) tiktokSocket = null;
      if (tiktokStatus.connected) updateTikTokStatus("disconnected", "A conexão com a LIVE foi encerrada; tentando novamente.");
      scheduleTikTokReconnect();
    });
    const roomId = await live.connect();
    if (tiktokSocket === live) updateTikTokStatus("connected", "Conectado à LIVE de " + tiktokUsername + " (sala " + String(roomId) + "); aguardando eventos reais.", true);
    live.on(EventType.roomUserSeq, data => {
      const count = Number(data?.viewerCount ?? data?.userCount ?? data?.total);
      if (Number.isFinite(count) && count >= 0) broadcast({ type: "viewer_count", viewerCount: Math.floor(count) });
    });
  } catch (err) {
    if (tiktokSocket === live) tiktokSocket = null;
    const detail = String(err?.message || err || "erro inesperado").slice(0, 220);
    const waitingForLive = /not currently live|isn't live|not live|no active live|live room.*not found|useroffline|not online/i.test(detail);
    if (waitingForLive) updateTikTokStatus("waiting-for-live", "Não foi possível encontrar uma LIVE pública ativa de " + tiktokUsername + "; nova tentativa em 30 segundos.", false);
    else updateTikTokStatus("connection-error", "Falha no PirateTok Live JS: " + detail, false);
    console.error("[PirateTok LIVE]", detail);
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
server.listen(port, "0.0.0.0", () => {
  console.log("Arena gateway listening on " + port);
  connectTikTok();
});
