import express, { type Response } from "express";
import { env } from "./env.js";
import {
  buildAuthUrl,
  createOrRenewUserSubscription,
  ensureValidAccess,
  loginWithAuthCode,
} from "./rc.js";
import { allSubs, allTokens } from "./store.js";
import { fetchLookup } from "./streakSide.js";

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

app.get("/health", (_req, res) => res.send("ok"));

type Client = { id: number; res: Response; userId?: string };
let nextId = 1;
const clients = new Map<number, Client>();
const byUser = new Map<string, Set<number>>();
const globals = new Set<number>();

app.get("/events", (req, res) => {
  const uid = typeof req.query.uid === "string" ? req.query.uid.trim() : "";
  const userId = uid || undefined;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const id = nextId++;
  clients.set(id, { id, res, userId });
  if (userId) {
    const set = byUser.get(userId) || new Set<number>();
    set.add(id);
    byUser.set(userId, set);
  } else {
    globals.add(id);
  }

  res.write(`event: ping\ndata: {}\n\n`);
  req.on("close", () => {
    clients.delete(id);
    if (userId) {
      const set = byUser.get(userId);
      set?.delete(id);
      if (set && !set.size) byUser.delete(userId);
    } else {
      globals.delete(id);
    }
  });
});

function broadcast(type: string, data: any, userId?: string) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  const targets = userId ? byUser.get(userId) || new Set<number>() : clients.keys();

  const ids = userId ? Array.from(targets) : Array.from(targets);
  for (const id of ids) {
    const client = clients.get(id);
    if (!client) continue;
    try {
      client.res.write(payload);
    } catch {}
  }

  if (userId) {
    for (const id of globals) {
      const client = clients.get(id);
      if (!client) continue;
      try {
        client.res.write(payload);
      } catch {}
    }
  }
}

app.get("/rc/auth/start", (_req, res) => {
  const url = buildAuthUrl();
  res.redirect(url);
});

app.get(env.REDIRECT_PATH || "/rc/callback", async (req, res) => {
  try {
    const code = String(req.query.code || "");
    if (!code) return res.status(400).send("Missing code");
    const { userId, token } = await loginWithAuthCode(code);
    (global as any).__ringstreakSignedIn = true;
    const webhookUrl = `${env.APP_BASE_URL}/rc/webhook`;
    const sub = await createOrRenewUserSubscription(userId, webhookUrl);
    res
      .status(200)
      .send(
        `<html><body><h3>RingStreak: Signed in ✅</h3><p>User: ${userId}</p><pre>${JSON.stringify(
          { token: { userId: token.userId, expires_at: token.expires_at }, sub },
          null,
          2
        )}</pre>You can close this tab.</body></html>`
      );
  } catch (e: any) {
    res.status(500).send(`OAuth failed: ${e?.message || e}`);
  }
});

app.get("/rc/auth/status", (req, res) => {
  try {
    const uid = typeof req.query.uid === "string" ? req.query.uid.trim() : "";
    if (!uid) {
      const signedIn = (global as any).__ringstreakSignedIn === true;
      return res.json({ signedIn });
    }
    const token = allTokens().find((t) => t.userId === uid);
    if (!token) return res.json({ ok: true, signedIn: false, userId: uid });
    res.json({ ok: true, signedIn: true, userId: uid, expiresAt: token.expires_at });
  } catch (e: any) {
    res.status(500).json({ signedIn: false, error: e?.message || "status failed" });
  }
});

app.get("/rc/status", (_req, res) => {
  const tokens = allTokens();
  res.json({ authed: tokens.length > 0, users: tokens.map((t) => t.userId) });
});

const POP_TTL_MS = 15000;
const popped = new Map<string, number>();
function shouldPop(sessionId?: string) {
  if (!sessionId) return true;
  const now = Date.now();
  const last = popped.get(sessionId) || 0;
  if (now - last < POP_TTL_MS) return false;
  popped.set(sessionId, now);
  return true;
}

app.post("/rc/webhook", async (req, res) => {
  const validationToken = req.header("Validation-Token");
  if (validationToken) {
    res.setHeader("Validation-Token", validationToken);
    return res.sendStatus(200);
  }
  res.status(200).json({ ok: true });

  try {
    const payload: any = req.body;
    const body = payload?.body || payload;

    const subscriptionId =
      req.header("x-ringcentral-subscription-id") ||
      body?.subscriptionId ||
      body?.subscription?.id ||
      payload?.subscriptionId ||
      "";
    const owner = subscriptionId ? allSubs().find((s) => s.id === subscriptionId) : null;
    const userId = owner?.userId;

    const sessionId = body?.telephonySessionId || body?.id;
    const parties: any[] = Array.isArray(body?.parties) ? body.parties : [];
    const first = parties[0] || {};
    const direction: string = (first?.direction || body?.direction || "Inbound").toLowerCase();
    const status: string = (first?.status?.code || first?.status || body?.status || "").toLowerCase();

    const early = new Set(["setup", "proceeding", "ringing", "answered", "connected"]);
    if (!status || !early.has(status)) return;
    if (!shouldPop(sessionId)) return;

    const from = first?.from?.phoneNumber || body?.from?.phoneNumber || "";
    const to = first?.to?.phoneNumber || body?.to?.phoneNumber || "";

    const lookup: any = await fetchLookup(from, to, direction, sessionId);
    const person = lookup?.person;
    const hasBox = Boolean(lookup?.boxKey);
    const hasContact = Boolean(person);

    const contactPhones = Array.isArray(person?.phones)
      ? person.phones
      : person?.phone
      ? [person.phone]
      : [];

    const fallbackProject =
      person?.name || (contactPhones.length ? contactPhones.join(" · ") : lookup?.phone || "Known contact");

    const top =
      hasBox || hasContact
        ? {
            company: person?.organization || "",
            contact: person?.name || "",
            contactEmail: person?.email || "",
            contactPhones,
            project: hasBox ? lookup?.boxName || fallbackProject : fallbackProject,
            stage: hasBox ? lookup?.stageName || "" : "No linked box yet",
            link: lookup?.link || lookup?.contactLink || "",
            preview: hasBox ? lookup?.preview || null : null,
            lastEmailSubject: hasBox ? lookup?.lastEmailSubject || null : null,
            lastEmailAt: hasBox ? lookup?.lastEmailAt || null : null,
            contactOnly: !hasBox && hasContact,
          }
        : null;

    const others = Array.isArray(lookup?.others)
      ? lookup.others.map((o: any) => ({
          project: o?.boxName || "",
          stage: o?.stageName || "",
          link: o?.link || "",
        }))
      : [];

    broadcast("call", { direction, from, to, callId: sessionId, top, others, userId }, userId);

    if (top) {
      if (top.contactOnly) {
        console.log(`ℹ️ [${userId || "unknown"}] Contact match "${top.contact || fallbackProject}" — no box linked yet`);
      } else {
        const stageNote = top.stage ? ` · Stage: ${top.stage}` : "";
        console.log(`✅ [${userId || "unknown"}] ${top.project}${stageNote}`);
        if (top.link) console.log(`   ${top.link}`);
        if (top.lastEmailSubject) console.log(`   Last email: ${top.lastEmailSubject}`);
      }
    } else {
      console.log(`🕵️ [${userId || "unknown"}] No match for ${direction === "outbound" ? to : from}`);
    }

    console.log(
      `[RC] ${direction} ${status}  from=${from}  to=${to}  session=${sessionId}  subscription=${subscriptionId}  user=${userId}`
    );
  } catch (err: any) {
    console.error("Webhook processing error:", err?.message || err);
  }
});

app.get("/rc/bootstrap", async (req, res) => {
  try {
    const uid = typeof req.query.uid === "string" ? req.query.uid.trim() : "";
    if (!uid) return res.status(400).json({ error: "uid is required" });
    await ensureValidAccess(uid);
    const webhookUrl = `${env.APP_BASE_URL}/rc/webhook`;
    const sub = await createOrRenewUserSubscription(uid, webhookUrl);
    res.json({ ok: true, subscription: sub });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "bootstrap failed" });
  }
});

app.post("/rc/debug/simulate", async (req, res) => {
  try {
    const body = req.body ?? {};
    await fetch(`${env.APP_BASE_URL}/rc/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "simulate failed" });
  }
});

const port = Number(env.PORT || 8082);

const WEBHOOK_URL = `${env.APP_BASE_URL}/rc/webhook`;
setInterval(async () => {
  const tokens = allTokens();
  for (const t of tokens) {
    try {
      await ensureValidAccess(t.userId);
      await createOrRenewUserSubscription(t.userId, WEBHOOK_URL);
    } catch (e: any) {
      console.error(`[maint] ${t.userId}: ${(e as Error).message}`);
    }
  }
}, 5 * 60 * 1000);

app.listen(port, () => {
  console.log(`📞 RC side listening on ${env.APP_BASE_URL}`);
  console.log(`→ GET  ${env.APP_BASE_URL}/rc/auth/start (begin OAuth)`);
  console.log(`→ GET  ${env.APP_BASE_URL}${env.REDIRECT_PATH || "/rc/callback"} (OAuth redirect)`);
  console.log(`→ POST ${env.APP_BASE_URL}/rc/webhook (RingCentral calls this)`);
  console.log(`→ GET  ${env.APP_BASE_URL}/events (SSE to popup)`);
});
