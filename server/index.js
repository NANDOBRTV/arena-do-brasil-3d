import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
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
  platformAdapter: tiktokStatus.provider,
  tiktok: { ...tiktokStatus }
}));

app.get("/api/tiktok/status", (_req, res) => res.json({ ...tiktokStatus }));

app.post("/api/tiktok/connect", (req, res) => {
  const requested = String(req.body?.username || "").trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{2,24}$/.test(requested)) return res.status(400).json({ ok: false, message: "Informe um usuário TikTok válido, sem espaços." });
  tiktokUsername = requested;
  tiktokStatus.username = requested;
  tiktokStatus.configured = Boolean(requested);
  if (tiktokSocket) { try { tiktokSocket.disconnect(); } catch {} tiktokSocket = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  updateTikTokStatus("connecting", "Solicitando conexão à LIVE de " + requested + " pelo TikTok LIVE Connector…");
  connectTikTok();
  return res.json({ ok: true, username: requested, configured: true, state: tiktokStatus.state, message: tiktokStatus.message });
});

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
let tiktokUsername = String(process.env.TIKTOK_USERNAME || "nandobr_ofc").trim().replace(/^@/, "");
const eulerStreamApiKey = String(process.env.EULERSTREAM_API_KEY || "").trim();
const tiktokStatus = {
  configured: Boolean(tiktokUsername),
  provider: "tiktok-live-connector",
  username: tiktokUsername ? tiktokUsername : null,
  connected: false,
  state: "connecting",
  message: "Conectando ao TikTok LIVE Connector…"
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
  console.log("[TikTok LIVE Connector]", state, message);
}
function scheduleTikTokReconnect() {
  if (!tiktokUsername || reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectTikTok(); }, 30000);
  reconnectTimer.unref?.();
}
async function connectTikTok() {
  if (!tiktokUsername) {
    updateTikTokStatus("needs-username", "Informe o usuário da LIVE para conectar.");
    return;
  }
  if (tiktokSocket) return;

  updateTikTokStatus("connecting", "Conectando à LIVE de " + tiktokUsername + " pelo TikTok LIVE Connector…");
  let live;
  try {
    live = new TikTokLiveConnection(tiktokUsername, {
      ...(eulerStreamApiKey ? { signApiKey: eulerStreamApiKey } : {}),
      fetchRoomInfoOnConnect: true,
      enableExtendedGiftInfo: true
    });
    tiktokSocket = live;

    const viewerName = event => String(event?.user?.uniqueId || event?.user?.nickname || event?.uniqueId || "Espectador").slice(0, 24);

    live.on(ControlEvent.CONNECTED, () => {
      updateTikTokStatus("connected", "Conectado à LIVE de " + tiktokUsername + "; recebendo eventos reais.", true);
    });

    live.on(WebcastEvent.ROOM_USER, event => {
      const count = Number(event?.viewerCount ?? event?.userCount ?? event?.total ?? 0);
      if (Number.isFinite(count) && count >= 0) broadcast({ type: "viewer_count", viewerCount: Math.floor(count) });
    });

    live.on(WebcastEvent.CHAT, event => {
      const comment = String(event?.comment || "").slice(0, 500);
      const first = comment.trim().toLowerCase().split(/\\s+/)[0];
      const command = ["!verde", "!azul", "!ataque", "!defesa"].includes(first) ? first : null;
      broadcast({ type: "chat", viewer: viewerName(event), comment, command, eventId: String(event?.msgId || event?.messageId || "") });
    });

    live.on(WebcastEvent.GIFT, event => {
      if (event?.repeatEnd === false) return;
      const giftName = String(event?.extendedGiftInfo?.name || event?.giftDetails?.giftName || event?.giftName || ("Presente " + (event?.giftId ?? ""))).slice(0, 80);
      const diamonds = Math.max(0, Number(event?.diamondCount ?? event?.extendedGiftInfo?.diamondCount ?? event?.giftDetails?.diamondCount ?? 0) || 0);
      const gift = diamonds >= 10 ? "special" : diamonds >= 2 ? "shield" : "confetti";
      broadcast({ type: "gift", gift, viewer: viewerName(event), giftName, diamonds, eventId: String(event?.msgId || event?.giftId || "") + ":" + String(event?.repeatCount || 1) });
    });

    live.on(WebcastEvent.LIKE, event => {
      const count = Math.max(1, Math.min(1000000, Math.floor(Number(event?.likeCount ?? event?.count ?? 1) || 1)));
      broadcast({ type: "likes", count, viewer: viewerName(event) });
    });

    live.on(WebcastEvent.FOLLOW, event => broadcast({ type: "social", event: "follow", viewer: viewerName(event) }));
    live.on(WebcastEvent.SHARE, event => broadcast({ type: "social", event: "share", viewer: viewerName(event) }));
    live.on(WebcastEvent.MEMBER, event => broadcast({ type: "social", event: "member", viewer: viewerName(event) }));

    live.on(ControlEvent.DISCONNECTED, () => {
      if (tiktokSocket === live) tiktokSocket = null;
      if (tiktokStatus.connected) updateTikTokStatus("disconnected", "A conexão com a LIVE foi encerrada; tentando reconectar.");
      scheduleTikTokReconnect();
    });

    live.on(ControlEvent.ERROR, err => {
      const detail = String(err?.message || err || "erro de conexão").slice(0, 180);
      updateTikTokStatus("error", "TikTok LIVE Connector: " + detail);
      console.error("[TikTok LIVE Connector]", detail);
    });

    await live.connect();
  } catch (err) {
    if (tiktokSocket === live) tiktokSocket = null;
    const detail = String(err?.message || err || "erro inesperado").slice(0, 180);
    const waitingForLive = /not currently live|isn't live|not live|no active live|live room.*not found|useroffline/i.test(detail);
    if (waitingForLive) {
      updateTikTokStatus("waiting-for-live", "O conector não encontrou uma LIVE pública ativa para " + tiktokUsername + ". A tentativa será repetida automaticamente.", false);
    } else {
      updateTikTokStatus("connection-error", "Falha no TikTok LIVE Connector: " + detail, false);
      console.error("[TikTok LIVE Connector]", detail);
    }
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