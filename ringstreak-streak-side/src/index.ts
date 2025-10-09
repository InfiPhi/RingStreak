import express from "express";
import { env } from "./env.js";
import { normalizeToE164, variants } from "./normalize.js";
import { lookupByPhone as findMatches } from "./match.js";
import {
  searchAll, boxUrl, getLastEmailDetails,
  getLastEmailPreview, getBox, getContactFull, resolveStageForBox
} from "./streak.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.send("ALL GOOD"));

const port = Number(env.PORT || 8081);
const SHARED = env.SHARED_SECRET;

app.get("/debug/normalize", (req, res) => {
  const raw = String(req.query.phone || "");
  const norm = normalizeToE164(raw);
  res.json({ raw, norm, variants: norm ? variants(norm) : [] });
});

app.get("/lookup", async (req, res) => {
  try {
    const phone = String(req.query.phone || "");
    if (!phone) return res.status(400).json({ error: "Please provide a phone number :)" });
    const data = await findMatches(phone);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Lookup failed" });
  }
});

async function handleIngest(req: express.Request, res: express.Response) {
  try {
    if (SHARED && req.header("x-ringstreak-secret") !== SHARED) return res.sendStatus(401);
    const { from, to } = req.body || {};
    const phone = from || to;
    if (!phone) return res.status(400).json({ ok: false, error: "from/to required" });

    const resp = await findMatches(String(phone));
    const matches = Array.isArray(resp?.matches) ? resp.matches : [];
    const best = matches[0];
    const box = best?.box as any | undefined;
    let person = best?.contact as any | undefined;

    if (person?.key && (!person?.email || !person?.phones || !person?.organization || !String(person.name || "").includes(" "))) {
      const full = await getContactFull(String(person.key)).catch(() => null);
      if (full) {
        person = {
          ...person,
          name: full.name || person.name,
          email: full.email || person.email,
          phones: full.phones || person.phones,
          organization: full.organization || person.organization
        };
      }
    }

    let stageName: string | undefined;
    if (box?.key) {
      const stage = await resolveStageForBox(box).catch(() => ({} as any));
      stageName = stage?.stageName;
    }

    const last = box ? await getLastEmailDetails(box.key) : null;
    const preview = box ? await getLastEmailPreview(box.key) : null;

    const others = matches.slice(1).map((m: any) => {
      const b = m?.box || {};
      return {
        boxKey: b.key,
        boxName: b.name,
        stageName: b.stageName,
        link: b.key ? boxUrl(b) : undefined,
      };
    });

    const contactPhones = person?.phones || (person?.phone ? [String(person?.phone)] : undefined);

    const out = {
      ok: true,
      found: Boolean(box),
      phone: resp.normalized || normalizeToE164(String(phone)) || String(phone),
      person: person
        ? { key: person.key, name: person.name, email: person.email, organization: person.organization, phones: contactPhones }
        : undefined,
      boxKey: box?.key,
      boxName: box?.name,
      stageName,
      link: box ? boxUrl(box) : undefined,
      lastEmailSubject: last?.subject || null,
      lastEmailAt: last?.timestamp ? new Date(Number(last.timestamp)).toISOString() : null,
      preview,
      others,
    };

    return res.json(out);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "ingest failed" });
  }
}

app.post("/ingest/call", handleIngest);
app.post("/searchfor/call", handleIngest);

app.get("/debug/search", async (req, res) => {
  try {
    const q = String(req.query.q || "");
    const r = await searchAll(q);
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "debug search failed" });
  }
});

app.listen(port, () =>
  console.log(`Streak side listening on ${env.APP_BASE_URL} (env: ${env.NODE_ENV})`)
);
