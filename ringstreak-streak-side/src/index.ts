import express from "express";
import { env } from "./env.js";
import { normalizeToE164, variants } from "./normalize.js";
import { lookupByPhone } from "./match.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.send("ALL GOOD"));

const port = Number(env.PORT || 8081);

app.get("/debug/normalize", (req, res) => {
  const raw = String(req.query.phone || "");
  const norm = normalizeToE164(raw);
  res.json({ raw, norm, variants: norm ? variants(norm) : [] });
});
app.get("/lookup", async (req, res) => {
  try {
    const phone = String(req.query.phone || "");
    // Quick validation thats redundant at the moment but might grow later
    if (!phone) return res.status(400).json({ error: "Please provide a phone number :)" });
    const data = await lookupByPhone(phone);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Lookup failed" });
  }
});
app.post("/searchfor/call", async (req, res) => {
  try {
    if (env.SHARED_SECRET && req.header("x-ringstreak-secret") !== env.SHARED_SECRET) {
      return res.sendStatus(401);
    }
    const { from, to } = req.body || {};
    const phone = from || to;
    if (!phone) return res.status(400).json({ error: "from/to required" });
    const data = await lookupByPhone(String(phone));
    res.json({ ok: true, ...data });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "searchfor failed" });
  }
});

app.listen(port, () =>
  console.log(`Streak side listening on ${env.APP_BASE_URL} (env: ${env.NODE_ENV})`)
);
