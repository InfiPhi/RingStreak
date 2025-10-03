import fetch from "node-fetch";
import { env } from "./env.js";
import type { StreakBox, StreakPerson } from "./types.js";
const AUTH = "Basic " + Buffer.from(env.STREAK_API_KEY + ":").toString("base64");

async function get<T>(path: string): Promise<T> {
  const url = `${env.STREAK_API_BASE}${path}`;
  const r = await fetch(url, { headers: { Authorization: AUTH } });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Streak GET ${path} failed: ${r.status} ${text.slice(0, 200)}`);
  }
  return r.json() as Promise<T>;
}

export async function searchAll(query: string): Promise<any> {
  return get<any>(`/search?query=${encodeURIComponent(query)}`);
}

export async function getBoxesForContact(contactKey: string): Promise<StreakBox[]> {
  try {
    return await get<StreakBox[]>(`/contacts/${contactKey}/boxes`);
  } catch {
    return [];
  }
}

const stageCache = new Map<string, Record<string, string>>(); 
export async function getStageMap(pipelineKey: string): Promise<Record<string, string>> {
  if (stageCache.has(pipelineKey)) return stageCache.get(pipelineKey)!;
  try {
    const stages = await get<Array<{ key: string; name: string }>>(`/pipelines/${pipelineKey}/stages`);
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
  return {
    key: raw?.key ?? "",
    name: raw?.givenName ?? raw?.name,
    email: emails[0],
    phone: phones.length === 1 ? String(phones[0]) : undefined,
    phones: phones.length > 1 ? phones.map(String) : undefined,
    organization: raw?.organizationName || raw?.organization,
    fields: {},
  };
}

export const boxUrl = (b: StreakBox) => `https://www.streak.com/p/${b.key}`;
export const contactUrl = (contactKey: string) => `https://www.streak.com/contacts/${contactKey}`;

export function splitSearchResults(raw: any): { contacts: any[]; boxes: any[] } {
  const contacts = Array.isArray(raw?.results?.contacts) ? raw.results.contacts : [];
  const boxes = Array.isArray(raw?.results?.boxes) ? raw.results.boxes : [];
  return { contacts, boxes };
}

export const contactOrg = (row: any): string | undefined =>
  row?.organizationName || row?.organization || undefined;

export function mapSearchBox(row: any): StreakBox {
  return {
    key: row?.key,
    name: row?.name,
    pipelineKey: row?.pipelineKey,
    stageKey: row?.stageKey,
    lastUpdatedTimestamp: row?.lastUpdatedTimestamp,
  };
}
