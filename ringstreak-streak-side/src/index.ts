import express from "express";
import { env } from "./env.js";
import { normalizeToE164, variants } from "./normalize.js";
import { lookupByPhoneNumber } from "./match.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.send("ALL GOOD"));

const port = Number(env.PORT || 8081);

app.get("/debug/normalize", (req, res) => {
  const raw = String(req.query.phone || "");
  const norm = normalizeToE164(raw);
  res.json({ raw, norm, variants: norm ? variants(norm) : [] });
});
app.get("/lookup/min", async (req, res) => {
  try {
    const phone = String(req.query.phone || "");
    if (!phone) return res.status(400).json({ error: "Please provide a phone number :)" });
    const data = await lookupByPhoneNumber(phone);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Lookup failed" });
  }
});
app.listen(port, () =>
  console.log(`Streak side listening on ${env.APP_BASE_URL} (env: ${env.NODE_ENV})`)
);
