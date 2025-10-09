import fetch from "node-fetch";
import { env } from "./env.js";
import type { StreakBox, StreakPerson } from "./types.js";

const AUTH = "Basic " + Buffer.from(env.STREAK_API_KEY + ":").toString("base64");

const API_BASE_V1 = env.STREAK_API_BASE.replace(/\/api\/v2\b/, "/api/v1");
const API_BASE_V2 = env.STREAK_API_BASE.includes("/api/v2")
  ? env.STREAK_API_BASE
  : env.STREAK_API_BASE.replace("/api/v1", "/api/v2");

async function getV1<T>(path: string): Promise<T> {
  const url = `${API_BASE_V1}${path}`;
  const r = await fetch(url, { headers: { Authorization: AUTH } });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Streak V1 GET ${path} failed: ${r.status} ${text.slice(0, 200)}`);
  }
  return r.json() as Promise<T>;
}
async function getV2<T>(path: string): Promise<T> {
  const url = `${API_BASE_V2}${path}`;
  const r = await fetch(url, { headers: { Authorization: AUTH } });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Streak V2 GET ${path} failed: ${r.status} ${text.slice(0, 200)}`);
  }
  return r.json() as Promise<T>;
}
async function safeV1(path: string) { try { return await getV1<any>(path); } catch { return null; } }
async function safeV2(path: string) { try { return await getV2<any>(path); } catch { return null; } }

export async function searchAll(query: string): Promise<any> {
  return getV1<any>(`/search?query=${encodeURIComponent(query)}`);
}
export function normalizeBox(row: any): StreakBox {
  return {
    key: row?.key ?? row?.boxKey,
    name: row?.name,
    pipelineKey: row?.pipelineKey,
    stageKey: row?.stageKey,
    lastUpdatedTimestamp: row?.lastUpdatedTimestamp,
  };
}
export function mapSearchBox(row: any): StreakBox { return normalizeBox(row); }
export function splitSearchResults(raw: any): { contacts: any[]; boxes: any[] } {
  const contacts = Array.isArray(raw?.results?.contacts) ? raw.results.contacts : [];
  const boxes = Array.isArray(raw?.results?.boxes) ? raw.results.boxes : [];
  return { contacts, boxes };
}

export const contactOrg = (row: any): string | undefined =>
  row?.organizationName || row?.organization || undefined;

export function mapSearchContactToPerson(raw: any): StreakPerson {
  const phones = Array.isArray(raw?.phoneNumbers) ? raw.phoneNumbers : [];
  const emails = Array.isArray(raw?.emailAddresses) ? raw.emailAddresses : [];
  const given = String(raw?.givenName || "").trim();
  const family = String(raw?.familyName || "").trim();
  const full = [given, family].filter(Boolean).join(" ");
  const key =
    raw?.key || raw?.contactKey || raw?.id || raw?.personKey || raw?.contact_id || "";
  return {
    key,
    name: full || raw?.name,
    email: emails[0],
    phone: phones.length === 1 ? String(phones[0]) : undefined,
    phones: phones.length > 1 ? phones.map(String) : undefined,
    organization: raw?.organizationName || raw?.organization,
    fields: {},
  };
}

const gmailU = String(env.GMAIL_USER_INDEX ?? "0");
export const boxUrl = (b: { key: string }) =>
  `https://mail.google.com/mail/u/${gmailU}/#box/${encodeURIComponent(b.key)}`;
export const contactUrl = (contactKey: string) =>
  `https://mail.google.com/mail/u/${gmailU}/#streak/contact/${encodeURIComponent(contactKey)}`;

function decodeGlobalId(maybeGlobalId: string): { id?: string } | null {
  try {
    const pad = (-maybeGlobalId.length) % 4;
    const padded = pad ? maybeGlobalId + "=".repeat(pad) : maybeGlobalId;
    const decoded = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    const m = decoded.match(/^[^,]+,~~[^~]+~~(.+)$/);
    if (m) return { id: m[1] };
  } catch {}
  return null;
}

export async function getBoxesForContact(contactKey: string): Promise<StreakBox[]> {
  if (!contactKey) return [];
  const v2 = await safeV2(`/contacts/${encodeURIComponent(contactKey)}/boxes`);
  if (Array.isArray(v2)) return v2.map(normalizeBox);
  const dec = decodeGlobalId(contactKey);
  const keyV1 = dec?.id || contactKey;
  const v1 = await safeV1(`/contacts/${encodeURIComponent(keyV1)}/boxes`);
  const arr1 = Array.isArray(v1) ? v1 : Array.isArray(v1?.results) ? v1.results : Array.isArray(v1?.boxes) ? v1.boxes : [];
  return arr1.map(normalizeBox);
}

export async function getBox(boxKey: string): Promise<any | null> {
  return safeV1(`/boxes/${encodeURIComponent(boxKey)}`);
}

const stageCacheV1 = new Map<string, Record<string, string>>();
const stageCacheV2 = new Map<string, Record<string, string>>();
function str(v: any) { return v == null ? "" : String(v); }

async function getStageMapV1(pipelineKey: string): Promise<Record<string, string>> {
  if (stageCacheV1.has(pipelineKey)) return stageCacheV1.get(pipelineKey)!;
  try {
    const arr = await getV1<Array<{ key: string | number; name: string }>>(`/pipelines/${pipelineKey}/stages`);
    const map: Record<string, string> = {};
    for (const s of arr) map[str(s.key)] = s.name;
    stageCacheV1.set(pipelineKey, map);
    return map;
  } catch {
    const empty: Record<string, string> = {};
    stageCacheV1.set(pipelineKey, empty);
    return empty;
  }
}
async function getStageMapV2(pipelineKey: string): Promise<Record<string, string>> {
  if (stageCacheV2.has(pipelineKey)) return stageCacheV2.get(pipelineKey)!;
  try {
    const res = await getV2<any>(`/pipelines/${pipelineKey}/stages`);
    const arr: any[] = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : [];
    const map: Record<string, string> = {};
    for (const s of arr) map[str(s.key ?? s.id)] = String(s.name ?? "");
    stageCacheV2.set(pipelineKey, map);
    return map;
  } catch {
    const empty: Record<string, string> = {};
    stageCacheV2.set(pipelineKey, empty);
    return empty;
  }
}
export async function getStageNameDirectV1(pipelineKey: string, stageKey: string): Promise<string | undefined> {
  if (!pipelineKey || !stageKey) return undefined;
  try {
    const s = await getV1<any>(`/pipelines/${encodeURIComponent(pipelineKey)}/stages/${encodeURIComponent(stageKey)}`);
    const n = s?.name ?? s?.title ?? "";
    return n ? String(n) : undefined;
  } catch { return undefined; }
}
export async function resolveStageForBox(
  b: Partial<StreakBox>
): Promise<{ pipelineKey?: string; stageKey?: string; stageName?: string }> {
  if (!b?.key) return {};
  let pipelineKey = str(b.pipelineKey);
  let stageKey = str(b.stageKey);

  if (!pipelineKey || !stageKey) {
    const full = await getBox(b.key).catch(() => null);
    pipelineKey = pipelineKey || str(full?.pipelineKey);
    stageKey = stageKey || str(full?.stageKey ?? full?.stage?.key);
  }
  if (!pipelineKey || !stageKey) return { pipelineKey, stageKey };

  const m1 = await getStageMapV1(pipelineKey).catch(() => ({} as Record<string, string>));
  let stageName: string | undefined = m1[str(stageKey)];

  if (!stageName) {
    const m2 = await getStageMapV2(pipelineKey).catch(() => ({} as Record<string, string>));
    stageName = m2[str(stageKey)];
  }
  if (!stageName) {
    stageName = await getStageNameDirectV1(pipelineKey, stageKey);
  }
  return { pipelineKey, stageKey, stageName };
}
function extractEmailMeta(it: any): { subject: string; snippet: string; timestamp: number } {
  const subj = it?.subject ?? it?.title ?? it?.data?.subject ?? it?.entity?.subject ?? "(no subject)";
  const snip = it?.snippet ?? it?.preview ?? it?.data?.snippet ?? it?.entity?.snippet ?? it?.lastMessageSnippet ?? "";
  const ts = Number(it?.timestamp ?? it?.lastUpdatedTimestamp ?? it?.data?.timestamp ?? 0);
  return { subject: String(subj), snippet: String(snip), timestamp: Number.isFinite(ts) ? ts : 0 };
}
export async function getLatestThreadFromTimeline(boxKey: string): Promise<any | null> {
  try {
    const data: any = await getV2<any>(`/boxes/${boxKey}/timeline?limit=10`);
    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    const filtered = items.filter((it) => {
      const t = String(it?.type || it?.entityType || it?.data?.type || "").toLowerCase();
      return t.includes("email") || t.includes("gmail") || t.includes("thread");
    });
    if (!filtered.length) return null;
    filtered.sort((a, b) => extractEmailMeta(b).timestamp - extractEmailMeta(a).timestamp);
    return filtered[0];
  } catch { return null; }
}
export async function getThreadsForBoxV1(boxKey: string): Promise<any[]> {
  const v1 = await safeV1(`/boxes/${boxKey}/threads`);
  return Array.isArray(v1) ? v1 : [];
}
export async function getLastEmailDetails(boxKey: string): Promise<{ subject: string; snippet: string; timestamp: number } | null> {
  const t2 = await getLatestThreadFromTimeline(boxKey);
  if (t2) return extractEmailMeta(t2);
  const v1 = await getThreadsForBoxV1(boxKey);
  if (v1.length) {
    v1.sort((a: any, b: any) => (b.lastUpdatedTimestamp ?? 0) - (a.lastUpdatedTimestamp ?? 0));
    return extractEmailMeta(v1[0]);
  }
  return null;
}
export async function getLastEmailPreview(boxKey: string): Promise<string | null> {
  const d = await getLastEmailDetails(boxKey);
  if (!d) return null;
  const txt = `${d.subject} — ${d.snippet}`.trim();
  return txt || null;
}
export async function getContactFull(anyKey: string): Promise<StreakPerson | null> {
  if (!anyKey) return null;

  const fromV2 = await safeV2(`/contacts/${encodeURIComponent(anyKey)}`);
  if (fromV2 && typeof fromV2 === "object") {
    const row = fromV2;
    const phones = Array.isArray(row?.phoneNumbers) ? row.phoneNumbers.map(String) : [];
    const emails = Array.isArray(row?.emailAddresses) ? row.emailAddresses.map(String) : [];
    const given = String(row?.givenName || "").trim();
    const family = String(row?.familyName || "").trim();
    const full = [given, family].filter(Boolean).join(" ");
    return {
      key: anyKey,
      name: full || row?.name,
      email: emails[0],
      phones: phones.length ? phones : undefined,
      phone: phones.length === 1 ? phones[0] : undefined,
      organization: row?.organizationName || row?.organization,
      fields: {},
    };
  }

  const dec = decodeGlobalId(anyKey);
  const numeric = dec?.id || anyKey;
  const fromV1 = await safeV1(`/contacts/${encodeURIComponent(numeric)}`);
  if (fromV1 && typeof fromV1 === "object") {
    const row = fromV1;
    const phones = Array.isArray(row?.phoneNumbers) ? row.phoneNumbers.map(String) : [];
    const emails = Array.isArray(row?.emailAddresses) ? row.emailAddresses.map(String) : [];
    const given = String(row?.givenName || "").trim();
    const family = String(row?.familyName || "").trim();
    const full = [given, family].filter(Boolean).join(" ");
    return {
      key: anyKey,
      name: full || row?.name,
      email: emails[0],
      phones: phones.length ? phones : undefined,
      phone: phones.length === 1 ? phones[0] : undefined,
      organization: row?.organizationName || row?.organization,
      fields: {},
    };
  }
  return null;
}
