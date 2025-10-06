import fetch from "node-fetch";
import { env } from "./env.js";
import type { StreakBox, StreakPerson } from "./types.js";

const AUTH = "Basic " + Buffer.from(env.STREAK_API_KEY + ":").toString("base64");

// Support both /api/v1 and /api/v2 bases from a single env var
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

export function mapSearchBox(row: any): StreakBox {
  return normalizeBox(row);
}

export function splitSearchResults(raw: any): { contacts: any[]; boxes: any[] } {
  const contacts = Array.isArray(raw?.results?.contacts) ? raw.results.contacts : [];
  const boxes = Array.isArray(raw?.results?.boxes) ? raw.results.boxes : [];
  return { contacts, boxes };
}

const digitsOnly = (s: string) => String(s || "").replace(/\D+/g, "");
const samePhoneish = (a: string, b: string) => {
  const ad = digitsOnly(a);
  const bd = digitsOnly(b);
  if (!ad || !bd) return false;
  if (ad === bd) return true;
  return ad.slice(-10) === bd.slice(-10);
};

export function normalizeToE164(num?: string | null): string | null {
  if (!num) return null;
  const d = digitsOnly(num);
  if (!d) return null;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return num.startsWith("+") ? num : `+${d}`;
}

export const boxUrl = (b: StreakBox) => `https://www.streak.com/p/${b.key}`;
export const contactUrl = (contactKey: string) => `https://www.streak.com/contacts/${contactKey}`;

export const contactOrg = (row: any): string | undefined =>
  row?.organizationName || row?.organization || undefined;

function decodeGlobalId(maybeGlobalId: string): { type?: string; id?: string } | null {
  try {
    const pad = (-maybeGlobalId.length) % 4;
    const padded = pad ? maybeGlobalId + "=".repeat(pad) : maybeGlobalId;
    const decoded = Buffer.from(
      padded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf-8");
    // e.g. "TeamContact,~~streaklongid~~4984590171717632"
    const m = decoded.match(/^([^,]+),~~[^~]+~~(.+)$/);
    if (m) return { type: m[1], id: m[2] };
  } catch {}
  return null;
}

async function safeGetJsonV1(path: string): Promise<any | null> {
  try { return await getV1<any>(path); } catch { return null; }
}
async function safeGetJsonV2(path: string): Promise<any | null> {
  try { return await getV2<any>(path); } catch { return null; }
}

/**
 * Robustly fetch boxes for a contact row returned by search:
 * - Try v2 with the global key
 * - Fallback to v1 using numeric contactKey (direct or decoded from the global key)
 */
export async function getBoxesForSearchRow(raw: any): Promise<StreakBox[]> {
  const globalKey = raw?.key ? String(raw.key) : null;
  if (globalKey) {
    const v2 = await safeGetJsonV2(`/contacts/${encodeURIComponent(globalKey)}/boxes`);
    const arr2 = Array.isArray(v2) ? v2
      : Array.isArray(v2?.results) ? v2.results
      : Array.isArray(v2?.boxes) ? v2.boxes : [];
    if (arr2.length) return arr2.map(normalizeBox);
  }

  let numeric = raw?.contactKey ? String(raw.contactKey) : (raw?.id ? String(raw.id) : null);
  if (!numeric && globalKey) {
    const dec = decodeGlobalId(globalKey);
    if (dec?.id) numeric = dec.id;
  }
  if (numeric) {
    const v1 = await safeGetJsonV1(`/contacts/${encodeURIComponent(numeric)}/boxes`);
    const arr1 = Array.isArray(v1) ? v1
      : Array.isArray(v1?.results) ? v1.results
      : Array.isArray(v1?.boxes) ? v1.boxes : [];
    if (arr1.length) return arr1.map(normalizeBox);
  }

  return [];
}

export async function getBoxesForContact(contactKey: string): Promise<StreakBox[]> {
  if (!contactKey) return [];
  try {
    const rawV2 = await getV2<any[]>(`/contacts/${encodeURIComponent(contactKey)}/boxes`);
    return Array.isArray(rawV2) ? rawV2.map(normalizeBox) : [];
  } catch {
    try {
      const rawV1 = await getV1<any[]>(`/contacts/${encodeURIComponent(contactKey)}/boxes`);
      return Array.isArray(rawV1) ? rawV1.map(normalizeBox) : [];
    } catch {
      return [];
    }
  }
}

const stageCache = new Map<string, Record<string, string>>();
export async function getStageMap(pipelineKey: string): Promise<Record<string, string>> {
  if (stageCache.has(pipelineKey)) return stageCache.get(pipelineKey)!;
  try {
    const stages = await getV1<Array<{ key: string; name: string }>>(`/pipelines/${pipelineKey}/stages`);
    const map: Record<string, string> = {};
    for (const s of stages) map[s.key] = s.name;
    stageCache.set(pipelineKey, map);
    return map;
  } catch {
    const empty: Record<string, string> = {};
    stageCache.set(pipelineKey, empty);
    return empty;
  }
}

export function mapSearchContactToPerson(raw: any): StreakPerson {
  const phones = Array.isArray(raw?.phoneNumbers) ? raw.phoneNumbers : [];
  const emails = Array.isArray(raw?.emailAddresses) ? raw.emailAddresses : [];
  // Keep whatever key we can; box fetching uses the raw row via getBoxesForSearchRow
  const key =
    raw?.key ||
    raw?.contactKey ||
    raw?.id ||
    raw?.personKey ||
    raw?.contact_id ||
    "";

  return {
    key,
    name: raw?.givenName ?? raw?.name,
    email: emails[0],
    phone: phones.length === 1 ? String(phones[0]) : undefined,
    phones: phones.length > 1 ? phones.map(String) : undefined,
    organization: raw?.organizationName || raw?.organization,
    fields: {},
  };
}

export async function getThreadsForBox(boxKey: string): Promise<any[]> {
  try {
    const threads = await getV1<any[]>(`/boxes/${boxKey}/threads`);
    return Array.isArray(threads) ? threads : [];
  } catch {
    return [];
  }
}

export async function getLatestThreadFromTimeline(boxKey: string): Promise<any | null> {
  try {
    const data: any = await getV2<any>(`/boxes/${boxKey}/timeline?limit=10`);
    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    const threadItems = items.filter((it) =>
      String(it?.type || it?.entityType || "").toLowerCase().includes("thread")
    );
    if (!threadItems.length) return null;
    threadItems.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    return threadItems[0];
  } catch {
    return null;
  }
}

export async function getLastEmailPreview(boxKey: string): Promise<string | null> {
  const t2 = await getLatestThreadFromTimeline(boxKey);
  if (t2) {
    const subj = t2.subject || t2.title || "(no subject)";
    const prev = t2.snippet || t2.preview || t2.lastMessageSnippet || "";
    const txt = `${subj} — ${prev}`.trim();
    return txt || null;
  }

  const v1 = await getThreadsForBox(boxKey);
  if (v1.length) {
    v1.sort((a: any, b: any) => (b.lastUpdatedTimestamp ?? 0) - (a.lastUpdatedTimestamp ?? 0));
    const th = v1[0];
    const subj = th.subject || th.title || "(no subject)";
    const prev = th.snippet || th.preview || th.lastMessageSnippet || "";
    const txt = `${subj} — ${prev}`.trim();
    return txt || null;
  }

  return null;
}

export async function createCallLogOnBox(boxKey: string, notes: string, startISO: string, durationMs: number) {
  const url = `${API_BASE_V2}/boxes/${encodeURIComponent(boxKey)}/meetings`;
  const body = new URLSearchParams();
  body.set("meetingType", "CALL_LOG");
  body.set("notes", notes || "");
  body.set("startTimestamp", String(new Date(startISO).getTime()));
  body.set("duration", String(Number.isFinite(durationMs) ? durationMs : 0));
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: AUTH, "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Streak CALL_LOG failed: ${r.status} ${text.slice(0, 200)}`);
  }
  return r.json();
}
