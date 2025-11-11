import express, { Request, Response } from "express";
import { env } from "./env.js";
import { normalizeToE164, variants } from "./normalize.js";
import { lookupByPhone as findMatches } from "./match.js";
import { searchAll, boxUrl, getLastEmailDetails, getContactFull, resolveStageForBox } from "./streak.js";

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => res.send("ALL GOOD"));

const port = Number(env.PORT || 8081);
const SHARED = env.SHARED_SECRET;

app.get("/debug/normalize", (req: Request, res: Response) => {
  const raw = String(req.query.phone || "");
  const norm = normalizeToE164(raw);
  res.json({ raw, norm, variants: norm ? variants(norm) : [] });
});

app.get("/lookup", async (req: Request, res: Response) => {
  try {
    const phone = String(req.query.phone || "");
    if (!phone) return res.status(400).json({ error: "Please provide a phone number :)" });
    const data = await findMatches(phone);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Lookup failed" });
  }
});

async function handleIngest(req: Request, res: Response) {
  try {
    if (SHARED && req.header("x-ringstreak-secret") !== SHARED) return res.sendStatus(401);

    const { from, to } = (req.body ?? {}) as { from?: string; to?: string };
    const phone = from || to;
    if (!phone) return res.status(400).json({ ok: false, error: "from/to required" });

    const resp = await findMatches(String(phone));
    const matches = Array.isArray(resp?.matches) ? resp.matches : [];
    const best: any | undefined = matches[0];
    const box: any | undefined = best?.box;
    let person: any | undefined = best?.contact;
    const contactLink: string | undefined =
      typeof best?.links?.openPerson === "string" ? best.links.openPerson : undefined;

    if (
      person?.key &&
      (!person?.email || !person?.phones || !person?.organization || !String(person.name || "").includes(" "))
    ) {
      const full = await getContactFull(String(person.key)).catch(() => null);
      if (full) {
        person = {
          ...person,
          name: full.name || person.name,
          email: full.email || person.email,
          phones: full.phones || person.phones,
          organization: full.organization || person.organization,
        };
      }
    }

    let stageName: string | undefined;
    if (box?.key) {
      const stage = await resolveStageForBox(box).catch(() => ({} as any));
      stageName = stage?.stageName;
    }

    const last = box ? await getLastEmailDetails(box.key) : null;
    const preview = last
      ? (() => {
          const parts = [last.subject, last.snippet].filter(Boolean).map((v) => String(v));
          const snippet = parts.join(" — ").trim();
          return snippet || null;
        })()
      : null;

    const others = matches.slice(1).map((m: any) => {
      const b = m?.box || {};
      return {
        boxKey: b.key,
        boxName: b.name,
        stageName: b.stageName,
        link: b.key ? boxUrl(b) : undefined,
      };
    });

    const contactPhones: string[] | undefined =
      person?.phones || (person?.phone ? [String(person?.phone)] : undefined);

    const out = {
      ok: true,
      found: Boolean(box),
      phone: resp.normalized || normalizeToE164(String(phone)) || String(phone),
      person: person
        ? {
            key: person.key,
            name: person.name,
            email: person.email,
            organization: person.organization,
            phones: contactPhones,
          }
        : undefined,
      boxKey: box?.key,
      boxName: box?.name,
      stageName,
      link: box ? boxUrl(box) : undefined,
      lastEmailSubject: last?.subject || null,
      lastEmailAt: last?.timestamp ? new Date(Number(last.timestamp)).toISOString() : null,
      preview,
      contactLink,
      others,
    };

    return res.json(out);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "ingest failed" });
  }
}

app.post("/ingest/call", handleIngest);
app.post("/searchfor/call", handleIngest);

app.get("/debug/search", async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || "");
    const r = await searchAll(q);
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "debug search failed" });
  }
});

app.listen(port, () => {
  console.log(`Streak side listening on ${env.APP_BASE_URL} (env: ${env.NODE_ENV})`);
});

export {};
