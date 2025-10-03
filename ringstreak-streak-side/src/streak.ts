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

export function boxUrl(b: StreakBox) {
  return `https://www.streak.com/p/${b.key}`;
}
export function contactUrl(contactKey: string) {
  return `https://www.streak.com/contacts/${contactKey}`;
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
