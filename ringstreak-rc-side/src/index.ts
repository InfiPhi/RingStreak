import crypto from "crypto";
import express, { type Request, type Response } from "express";
import { env } from "./env.js";
import {
  buildAuthUrl,
  createOrRenewSubscription,
  getAuthedPlatform,
  loginWithAuthCode,
} from "./rc.js";
import { fetchLookup } from "./streakSide.js";

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any)._rawBody = Buffer.from(buf);
    },
  })
);

app.get("/health", (_req, res) => res.send("ok"));

type Client = { id: number; res: Response };
let nextId = 1;
const clients = new Map<number, Client>();

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders?.();
  const id = nextId++;
  clients.set(id, { id, res });
  res.write(`event: ping\ndata: {}\n\n`);
  req.on("close", () => clients.delete(id));
});

function broadcast(type: string, data: any) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const { res } of clients.values()) {
    try {
      res.write(payload);
    } catch {}
  }
}

function getRawBody(req: Request): Buffer {
  return ((req as any)._rawBody as Buffer) || Buffer.alloc(0);
}

function verifyWebhookSignature(req: Request): boolean {
  const header =
    req.header("x-ringcentral-signature-v2") ||
    req.header("x-ringcentral-signature") ||
    req.header("validation-signature") ||
    "";
  if (!env.RC_WEBHOOK_SECRET) return true;
  const normalized = header.startsWith("sha256=") ? header.slice(7) : header;
  if (!normalized) return false;
  const body = getRawBody(req);
  const expectedBase64 = crypto.createHmac("sha256", env.RC_WEBHOOK_SECRET).update(body).digest("base64");
  const expected = Buffer.from(expectedBase64, "base64");
  const provided = Buffer.from(normalized, "base64");
  if (!expected.length || expected.length !== provided.length) return false;
  try {
    return crypto.timingSafeEqual(expected, provided);
  } catch {
    return false;
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
    await loginWithAuthCode(code);
    const webhookUrl = `${env.APP_BASE_URL}/rc/webhook`;
    const sub = await createOrRenewSubscription(webhookUrl);
    res.status(200).send(
      `<html><body><h3>RingStreak: Signed in ✅</h3><pre>${JSON.stringify(sub, null, 2)}</pre>You can close this tab.</body></html>`
    );
  } catch (e: any) {
    res.status(500).send(`OAuth failed: ${e?.message || e}`);
  }
});

app.get("/rc/status", async (_req, res) => {
  const platform = await getAuthedPlatform();
  res.json({ authed: !!platform });
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
  if (!verifyWebhookSignature(req)) {
    return res.status(401).json({ error: "Invalid webhook signature" });
  }
  res.status(200).json({ ok: true });

  try {
    const payload: any = req.body;
    const body = payload?.body || payload;

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

    broadcast("call", { direction, from, to, callId: sessionId, top, others });

    if (top) {
      if (top.contactOnly) {
        console.log(`ℹ️ Contact match "${top.contact || fallbackProject}" — no box linked yet`);
      } else {
        const stageNote = top.stage ? ` · Stage: ${top.stage}` : "";
        console.log(`✅ ${top.project}${stageNote}`);
        if (top.link) console.log(`   ${top.link}`);
        if (top.lastEmailSubject) console.log(`   Last email: ${top.lastEmailSubject}`);
      }
    } else {
      console.log(`🕵️ No match for ${direction === "outbound" ? to : from}`);
    }

    console.log(`[RC] ${direction} ${status}  from=${from}  to=${to}  session=${sessionId}`);
  } catch (err: any) {
    console.error("Webhook processing error:", err?.message || err);
  }
});

app.get("/rc/bootstrap", async (_req, res) => {
  try {
    const platform = await getAuthedPlatform();
    if (!platform) return res.status(401).json({ error: "Not signed in. Visit /rc/auth/start" });
    const webhookUrl = `${env.APP_BASE_URL}/rc/webhook`;
    const sub = await createOrRenewSubscription(webhookUrl, platform);
    res.json({ ok: true, subscription: sub });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "bootstrap failed" });
  }
});

app.post("/rc/debug/simulate", async (req, res) => {
  try {
    const body = req.body;
    const serialized = JSON.stringify(body ?? {});
    const signature = crypto.createHmac("sha256", env.RC_WEBHOOK_SECRET || "").update(serialized).digest("base64");
    await fetch(`${env.APP_BASE_URL}/rc/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ringcentral-signature-v2": signature,
      },
      body: serialized,
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "simulate failed" });
  }
});

const port = Number(env.PORT || 8082);
app.listen(port, () => {
  console.log(`📞 RC side listening on ${env.APP_BASE_URL}`);
  console.log(`→ GET  ${env.APP_BASE_URL}/rc/auth/start (begin OAuth)`);
  console.log(`→ GET  ${env.APP_BASE_URL}${env.REDIRECT_PATH || "/rc/callback"} (OAuth redirect)`);
  console.log(`→ POST ${env.APP_BASE_URL}/rc/webhook (RingCentral calls this)`);
  console.log(`→ GET  ${env.APP_BASE_URL}/events (SSE to popup)`);
});
