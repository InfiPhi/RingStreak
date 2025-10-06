import express from "express";
import { env } from "./env.js";
import { ensureAuth, createOrRenewSubscription } from "./rc.js";
import { fetchLookup } from "./streakSide.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.send("ok"));

type Client = { id: number; res: express.Response };
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
    try { res.write(payload); } catch {}
  }
}

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

    const sessionId = body?.telephonySessionId || body?.id;
    const parties: any[] = Array.isArray(body?.parties) ? body.parties : [];
    const first = parties[0] || {};
    const direction: string = (first?.direction || body?.direction || "Inbound").toLowerCase();
    const status: string = (first?.status?.code || first?.status || body?.status || "").toLowerCase();

    const early = new Set(["setup","proceeding","ringing","answered","connected"]);
    if (!status || !early.has(status)) return;

    const from = first?.from?.phoneNumber || body?.from?.phoneNumber || "";
    const to   = first?.to?.phoneNumber   || body?.to?.phoneNumber   || "";

    type LookupResult = {
      person?: {
        name?: string;
        email?: string;
        organization?: string;
        phones?: string[];
        phone?: string;
      };
      boxKey?: string;
      boxName?: string;
      stageName?: string;
      link?: string;
      preview?: any;
      lastEmailSubject?: string;
      lastEmailAt?: string;
      others?: Array<{
        boxName?: string;
        stageName?: string;
        link?: string;
      }>;
    };

    const lookup: LookupResult = await fetchLookup(from, to, direction, sessionId) as LookupResult;

      const contactPhones = Array.isArray(lookup?.person?.phones)
        ? lookup.person.phones
        : (lookup?.person?.phone ? [lookup.person.phone] : []);

      const top = lookup?.boxKey ? {
        company: lookup?.person?.organization || "",
        contact: lookup?.person?.name || "",
        contactEmail: lookup?.person?.email || "",
        contactPhones,
        project: lookup?.boxName || "",
        stage: (lookup as any)?.stageName || "",
        link: lookup?.link || "",
        preview: lookup?.preview || null,
        lastEmailSubject: lookup?.lastEmailSubject || null,
        lastEmailAt: lookup?.lastEmailAt || null
      } : null;

      const others = Array.isArray(lookup?.others) ? lookup.others.map((o: any) => ({
        project: o?.boxName || "",
        stage: o?.stageName || "",
        link: o?.link || ""
      })) : [];

      broadcast("call", { direction, from, to, callId: sessionId, top, others });

      if (top) {
        const stageNote = top.stage ? ` · Stage: ${top.stage}` : "";
        console.log(`✅ ${top.project}${stageNote}`);
        if (top.link) console.log(`   ${top.link}`);
        if (top.lastEmailSubject) console.log(`   Last email: ${top.lastEmailSubject}`);
      } else if (lookup?.person?.name) {
        console.log(`ℹ️ Found contact "${lookup.person.name}" — no box linked yet`);
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
    await ensureAuth();
    const webhookUrl = `${env.APP_BASE_URL}/rc/webhook`;
    const sub = await createOrRenewSubscription(webhookUrl);
    res.json({ ok: true, subscription: sub });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "bootstrap failed" });
  }
});

app.post("/rc/debug/simulate", async (req, res) => {
  try {
    const body = req.body;
    await fetch(`${env.APP_BASE_URL}/rc/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "simulate failed" });
  }
});

const port = Number(env.PORT || 8082);
app.listen(port, () => {
  console.log(`📞 RC side listening on ${env.APP_BASE_URL}`);
  console.log(`→ POST ${env.APP_BASE_URL}/rc/webhook`);
  console.log(`→ GET  ${env.APP_BASE_URL}/rc/bootstrap`);
  console.log(`→ GET  ${env.APP_BASE_URL}/events`);
});
